// selfcheck: load-time check of what the host SDK provides (V2 design §10(c)).
// A missing export degrades one feature; the plugin keeps running and says so
// once, instead of failing silently.
//
//   checkSdk(sdk, env = globalThis) → { features: [{ feature, exports }], controls: [name] }
//     features — a capability is gone: 'workspace' (plugin tabs), 'markdown'
//                (both renderers), 'marks' (CSS Custom Highlight API)
//     controls — host UI primitives replaced by plain elements (cosmetic)
//   markdownRenderer(sdk) → 'MessageTextContent' | 'Streamdown' | null (plain text)
//   reportSdk({ result, notify, warn, storage, t })
//     logs any gap (warn) every load; a notice (notify) only for degraded
//     features, and only when this exact gap was not announced before
//     (remembered in plugin storage, so reloads and other windows stay quiet).

const has = (v) => typeof v === 'function' || (typeof v === 'object' && v !== null)

const FEATURES = [
  { feature: 'workspace', exports: ['host.openWorkspace'], ok: (sdk) => typeof sdk?.host?.openWorkspace === 'function' },
  { feature: 'markdown', exports: ['MessageTextContent', 'Streamdown'], ok: (sdk) => has(sdk?.MessageTextContent) || has(sdk?.Streamdown) },
  {
    feature: 'marks',
    exports: ['CSS.highlights'],
    ok: (_sdk, env) => Boolean(env?.CSS?.highlights) && typeof env?.Highlight === 'function'
  }
]
const CONTROLS = ['Button', 'Tip', 'SegmentedControl', 'Switch', 'Codicon', 'GlyphSpinner']

export function checkSdk(sdk, env = globalThis) {
  return {
    features: FEATURES.filter((f) => !f.ok(sdk, env)).map(({ feature, exports }) => ({ feature, exports })),
    controls: CONTROLS.filter((name) => !has(sdk?.[name]))
  }
}

/** Which renderer Markdown uses: the host's chat pipeline, then Streamdown, then plain text (null). */
export function markdownRenderer(sdk) {
  if (has(sdk?.MessageTextContent)) return 'MessageTextContent'
  if (has(sdk?.Streamdown)) return 'Streamdown'
  return null
}

const NOTICE_KEY = 'selfcheck.announced'

export function reportSdk({ result, notify, warn, storage, t }) {
  const { features, controls } = result
  if (!features.length && !controls.length) return
  try {
    warn?.('[diple-docs] host SDK self-check: running degraded', {
      features: features.map((f) => `${f.feature} (${f.exports.join(' / ')})`),
      controls
    })
  } catch {}
  if (!features.length || typeof notify !== 'function') return
  const signature = features.map((f) => f.feature).join(',')
  if (storage?.get?.(NOTICE_KEY, '') === signature) return
  storage?.set?.(NOTICE_KEY, signature)
  const what = features.map((f) => t(`review.selfcheck.feature.${f.feature}`)).join(t('review.selfcheck.separator'))
  try {
    notify({ kind: 'warning', durationMs: 10000, message: t('review.selfcheck.notice', what) })
  } catch {}
}
