// review/ — W2c: review page, review list, anchors, hand-off, auto card.
//
// installReview(ctx, deps) wires everything through ctx; the runtime object
// `rt` it builds is the only thing the React surfaces see.
import * as SDK from '@hermes/plugin-sdk'
import { createElement } from 'react'

import { createDocStore } from './doc-store.js'
import { createHandoff, noticeFor } from './handoff.js'
import { createItemCounts, summaryFetcher } from './item-counts.js'
import { createListPanel } from './list-panel.js'
import { basename } from './page.jsx'
import { ReviewPage } from './page.jsx'
import { isAbsolutePath, isReviewPath } from './paths.js'
import { dockFor, readLayoutPanes, REVIEW_MIN_WIDTH } from './placement.js'
import { checkSdk, reportSdk } from './selfcheck.js'
import { createDraftCache } from './draft-cache.js'
import { REVIEW_CSS } from './styles.js'
import { OpenReviewCard, RecentPage, SettingsPage } from './surfaces.jsx'

const { host } = SDK
const RECENT_ROWS = 5

function atomStore(atom) {
  return {
    get: () => atom?.get?.() ?? null,
    subscribe: (fn) => atom?.listen?.(() => fn()) ?? (() => {})
  }
}

function newId(prefix) {
  const rand = globalThis.crypto?.randomUUID?.().replace(/-/g, '') ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
  return `${prefix}${rand.slice(0, 16)}`
}

export function installReview(ctx, deps) {
  const { api, settings, i18n } = deps
  const notify = (n) => host?.notify?.(n)
  const t = (k, ...a) => i18n.t(k, ...a)
  const schedule = (fn, ms) => (ctx.setInterval ? ctx.setInterval(fn, ms) : ((id) => () => clearInterval(id))(setInterval(fn, ms)))
  const later = (fn, ms) => {
    if (ctx.setTimeout) return ctx.setTimeout(fn, ms)
    const id = setTimeout(fn, ms)
    id?.unref?.()
    return () => clearTimeout(id)
  }

  const style = document.createElement('style')
  style.setAttribute('data-diple-docs-style', '')
  style.textContent = REVIEW_CSS
  document.head.appendChild(style)
  ctx.onDispose?.(() => style.remove())

  // load-time self-check (design §10(c)): say once what is degraded, then keep running
  const selfcheck = checkSdk(SDK)
  reportSdk({ result: selfcheck, notify, warn: (...a) => console.warn(...a), storage: ctx.storage, t })

  // --- open documents (one store per path, shared by tabs of the same file) -----------
  const docs = new Map()
  const docRegistry = {
    open(path) {
      let entry = docs.get(path)
      if (!entry) {
        const store = createDocStore({
          api,
          path,
          schedule,
          isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
        })
        entry = { store, refs: 0 }
        docs.set(path, entry)
        store.start()
      }
      entry.refs++
      return entry.store
    },
    close(path, store) {
      const entry = docs.get(path)
      if (!entry || entry.store !== store) return
      if (--entry.refs <= 0) {
        store.stop()
        docs.delete(path)
      }
    }
  }
  // the transcript cards' counts: one coalesced, retried request (V3-D2)
  const itemCounts = createItemCounts({
    fetch: summaryFetcher(api),
    later,
    isVisible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden'
  })
  ctx.onDispose?.(() => itemCounts.dispose())
  const refreshAllItems = () => {
    for (const { store } of docs.values()) store.reloadItems()
    itemCounts.invalidate()
  }
  ctx.onDispose?.(() => {
    for (const { store } of docs.values()) store.stop()
    docs.clear()
  })

  // --- hand-off sender ---------------------------------------------------------------------
  const decisions = host?.pluginDecisions
  const handoff = createHandoff({
    api,
    onEvent: (type, fn) => ctx.onEvent(type, fn),
    schedule: later,
    newId: () => newId('h'),
    peerDisabled: () => decisions?.get?.()?.annotation === false,
    onItemsChanged: refreshAllItems,
    // a receipt that arrived after the 3 s timeout: say what actually happened (XR-03)
    onLate: (res) => {
      if (!res.ok) return
      const note = noticeFor(t, res)
      notify({ ...note, message: t('review.handoff.late', note.message) })
    },
    // the final word on a submitted / queued hand-off (XR-09): 已发送, back to pending, or unknown
    onSettled: (res) => {
      refreshAllItems()
      notify(noticeFor(t, res))
    }
  })

  // --- pages (⌘⇧E finds the one that owns the selection) ---------------------------------
  const pages = new Set()
  const focusers = new Map()
  const annotationFromSelection = () => {
    const sel = document.getSelection()
    for (const p of pages) if (p.owns(sel)) return p.annotate()
    return null
  }

  const sessionAtom = host?.state?.focusedStoredSessionId ?? host?.state?.activeSessionId
  const session = atomStore(sessionAtom)

  const titleCache = new Map()
  const titles = async (ids) => {
    const missing = ids.filter((id) => !titleCache.has(id))
    if (missing.length) {
      try {
        const r = await api.sessionTitles(missing)
        for (const id of missing) titleCache.set(id, r?.titles?.[id] ?? '')
      } catch {}
    }
    return Object.fromEntries(ids.map((id) => [id, titleCache.get(id) ?? '']))
  }

  // The send menu's recent sessions (V2.1 #8): the host's persisted list when
  // the SDK offers it (most recently active first, hidden ones skipped), else
  // the sessions this file's annotations went to. Ids only; titles via titles().
  const recentSessions = async ({ fallback = [] } = {}) => {
    const list = typeof host?.listPersistedSessions === 'function' ? host.listPersistedSessions : null
    if (list) {
      try {
        const profile = host.state?.profile?.get?.() || 'default'
        const r = await list(null, { profile, limit: 30 })
        const rows = (r?.sessions ?? []).filter((s) => s && s.id && !s.hidden && !s.archived && !s.is_internal_child && s.source !== 'cron')
        rows.sort((a, b) => (b.last_active ?? 0) - (a.last_active ?? 0))
        for (const s of rows) if (s.title && !titleCache.has(s.id)) titleCache.set(s.id, s.title)
        return rows.map((s) => s.id)
      } catch {}
    }
    return [...new Set(fallback.filter(Boolean))]
  }

  // the list's layout (V3-D): collapsed / width / sheet, global across files
  const listPanel = createListPanel(ctx.storage)
  // 切换标注清单 / 上一条 / 下一条未处理 from a keybind: the visible review page
  const visiblePage = () => [...pages].find((p) => p.visible?.())
  // a written draft per file, until 保存 or 放弃 (R11 XR11-05)
  const drafts = (path) => createDraftCache(ctx.storage, path)
  const prefs = {
    view: () => (ctx.storage.get('view', 'rendered') === 'source' ? 'source' : 'rendered'),
    setView: (v) => ctx.storage.set('view', v)
  }

  const rt = {
    api,
    i18n,
    settings,
    notify,
    later,
    selfcheck,
    handoff,
    session,
    prefs,
    drafts,
    listPanel,
    itemCounts,
    docs: docRegistry,
    titles,
    recentSessions,
    canReveal: typeof ctx.os?.revealPath === 'function',
    reveal: (path) => ctx.os?.revealPath?.(path),
    pages: {
      add(page) {
        pages.add(page)
        return () => pages.delete(page)
      }
    },
    registerFocus(key, fn) {
      focusers.set(key, fn)
      return () => focusers.get(key) === fn && focusers.delete(key)
    },
    focusCard: (key, id, opts) => focusers.get(key)?.(id, opts),
    openSession: (id) => {
      if (typeof host?.openSession === 'function') host.openSession(id).catch(() => notify({ kind: 'warning', durationMs: 5000, message: t('review.handoff.error') }))
    },
    openReview,
    pickAndOpen,
    forgetRecent: async (path) => {
      await api.forgetReview(path).catch(() => {})
      refreshRecent()
    }
  }

  // --- opening a review tab -----------------------------------------------------------------
  function openReview(path) {
    const p = typeof path === 'string' ? path.trim() : ''
    if (!isReviewPath(p)) {
      notify({ kind: 'warning', durationMs: 6000, message: t('review.unsupported', basename(p) || p) })
      return false
    }
    if (!isAbsolutePath(p)) {
      notify({ kind: 'warning', durationMs: 6000, message: t('review.notAbsolute') })
      return false
    }
    if (typeof host?.openWorkspace !== 'function') {
      notify({ kind: 'error', message: t('review.noWorkspace') })
      return false
    }
    const id = `diple-docs:${p}`
    if (!openTabs.has(id)) {
      const close = openTile(id, {
        title: basename(p),
        render: () => createElement(ReviewPage, { rt, path: p }),
        onClose: () => {
          openTabs.delete(id)
          if (!disposing) saveTabs()
        }
      })
      openTabs.set(id, { path: p, close })
      saveTabs()
    } else {
      host.revealPane?.(paneIdOf(id))
    }
    later(refreshRecent, 1500)
    return true
  }

  // Every tab we open (a document, the recent list) lands by one rule — the
  // Hermes preview's (placement.js): stack into our zone or the preview zone,
  // else dock right of the chat. Restore, recent rows and cards all come here.
  const paneIdOf = (id) => `plugin-workspace:${id}` // sdk/index.ts openWorkspace
  const ownTiles = new Map() // paneId → opened at (ms), in opening order
  function openTile(id, { onClose, ...options }) {
    const paneId = paneIdOf(id)
    const dock = dockFor({
      own: [...ownTiles].filter(([pid]) => pid !== paneId).map(([pid, at]) => ({ paneId: pid, at })),
      layout: readLayoutPanes(),
      now: Date.now()
    })
    ownTiles.set(paneId, Date.now())
    return host.openWorkspace(id, {
      ...options,
      dock,
      minWidth: REVIEW_MIN_WIDTH,
      onClose: () => {
        ownTiles.delete(paneId)
        onClose?.()
      }
    })
  }

  // Review tabs survive a reload / app restart: the host does not persist plugin panes.
  const TAB_TTL_MS = 24 * 3600 * 1000
  const openTabs = new Map()
  let disposing = false
  function saveTabs() {
    ctx.storage.set('openTabs', [...openTabs.values()].map((x) => ({ path: x.path, at: Date.now() })))
  }
  ctx.onDispose?.(() => {
    disposing = true
    for (const { close } of openTabs.values()) close?.()
    openTabs.clear()
  })
  function restoreTabs() {
    const saved = ctx.storage.get('openTabs', [])
    if (!Array.isArray(saved)) return
    for (const x of saved) if (x && typeof x.path === 'string' && Date.now() - (x.at ?? 0) < TAB_TTL_MS) openReview(x.path)
  }

  async function pickAndOpen() {
    const pick = ctx.os?.pickOpenPath
    if (typeof pick !== 'function') {
      notify({ kind: 'error', message: t('review.noWorkspace') })
      return
    }
    const path = await pick({
      title: t('review.pickTitle'),
      defaultPath: host?.state?.cwd?.get?.() || undefined,
      filters: [{ name: t('review.pickFilter'), extensions: ['md', 'markdown'] }]
    })
    if (path) openReview(path)
  }

  function openRecentTab() {
    if (typeof host?.openWorkspace !== 'function') return notify({ kind: 'error', message: t('review.noWorkspace') })
    const id = 'diple-docs:recent'
    if (ownTiles.has(paneIdOf(id))) return host.revealPane?.(paneIdOf(id))
    openTile(id, {
      title: t('review.home.title'),
      render: () => createElement(RecentPage, { rt })
    })
  }

  // --- registrations (labels re-registered on a language change) ---------------------------
  const PALETTE = SDK.PALETTE_AREA ?? 'palette'
  const tracked = () => {
    const list = []
    return {
      register(c) {
        const d = ctx.register(c)
        list.push(typeof d === 'function' ? d : () => {})
      },
      push: (d) => list.push(typeof d === 'function' ? d : () => {}),
      clear: () => {
        for (const d of list.splice(0)) d()
      }
    }
  }
  const labelled = tracked()
  const recentRows = tracked()
  let recent = []

  const addFromCommand = () => {
    if (annotationFromSelection() === null) notify({ kind: 'info', durationMs: 4000, message: t('review.pick.outside') })
  }

  function registerLabelled() {
    labelled.clear()
    labelled.register({
      id: 'open',
      area: PALETTE,
      data: {
        id: 'diple-docs.open',
        label: t('review.openCommand'),
        keywords: ['review', 'markdown', 'md', 'annotate', 'diple', 'quanpi', 'pizhu', 'biaozhu', '圈批', '批注', '标注', '文档'], // i18n-allow: search keywords in both languages
        run: () => void pickAndOpen()
      }
    })
    labelled.register({
      id: 'recent',
      area: PALETTE,
      data: {
        id: 'diple-docs.recent',
        label: t('review.recentCommand'),
        keywords: ['recent', 'review', 'markdown', 'zuijin', '最近', '审阅'], // i18n-allow: search keywords
        run: openRecentTab
      }
    })
    labelled.register({
      id: 'add',
      area: SDK.KEYBINDS_AREA ?? 'keybinds',
      data: {
        id: 'diple-docs.add',
        label: t('review.addCommand'),
        category: t('review.keybindCategory'),
        // No default: ⌘⇧E belongs to the Diple plugin's action (first registration wins and
        // contributed actions cannot pass a chord on). The page listens for ⌘⇧E itself when
        // the selection is inside a review document; this action lets users bind a second key.
        defaults: [],
        run: addFromCommand
      }
    })
    // ⌘⌥B: free in the host's defaults (actions.ts, contrib/controller.tsx) and in
    // the Diple plugin (⌘⇧E, ⌘⇧↩); VS Code's 切换次侧栏. Shown only in Settings ›
    // Keyboard and our settings page, never on the page (V2.1 #3).
    labelled.register({
      id: 'toggle-list',
      area: SDK.KEYBINDS_AREA ?? 'keybinds',
      data: { id: 'diple-docs.toggleList', label: t('review.toggleListCommand'), category: t('review.keybindCategory'), defaults: ['mod+alt+b'], run: () => visiblePage()?.toggleList() }
    })
    labelled.register({
      id: 'prev-unhandled',
      area: SDK.KEYBINDS_AREA ?? 'keybinds',
      data: { id: 'diple-docs.prevUnhandled', label: t('review.prevUnhandled'), category: t('review.keybindCategory'), defaults: [], run: () => visiblePage()?.nav(-1) }
    })
    labelled.register({
      id: 'next-unhandled',
      area: SDK.KEYBINDS_AREA ?? 'keybinds',
      data: { id: 'diple-docs.nextUnhandled', label: t('review.nextUnhandled'), category: t('review.keybindCategory'), defaults: [], run: () => visiblePage()?.nav(1) }
    })
    labelled.register({
      id: 'add-palette',
      area: PALETTE,
      data: {
        id: 'diple-docs.add',
        action: 'diple-docs.add',
        label: t('review.addCommand'),
        keywords: ['diple', 'docs', 'quanpi', '圈批', '文档'], // i18n-allow: search keywords
        run: addFromCommand
      }
    })
    if (typeof host?.navigate === 'function' && typeof SDK.pluginSettingsHref === 'function') {
      labelled.register({
        id: 'settings-palette',
        area: PALETTE,
        data: {
          id: 'diple-docs.settings',
          label: t('review.settingsCommand'),
          keywords: ['settings', 'annotation review', '设置'], // i18n-allow: search keywords
          run: () => host.navigate(SDK.pluginSettingsHref('diple-docs:main'))
        }
      })
    }
    if (typeof ctx.registerSettingsPage === 'function') {
      labelled.push(
        ctx.registerSettingsPage({
          id: 'main',
          title: t('review.settings.title'),
          icon: 'comment-discussion',
          render: () => createElement(SettingsPage, { rt })
        })
      )
    }
    registerRecentRows()
  }

  function registerRecentRows() {
    recentRows.clear()
    recent.slice(0, RECENT_ROWS).forEach((r, i) => {
      recentRows.register({
        id: `recent-${i}`,
        area: PALETTE,
        data: {
          id: `diple-docs.recent.${i}`,
          label: t('review.recentRow', basename(r.path)),
          detail: () => r.path,
          keywords: ['recent', 'review', basename(r.path), '最近审阅'], // i18n-allow: search keywords
          run: () => openReview(r.path)
        }
      })
    })
  }

  async function refreshRecent() {
    try {
      const r = await api.recentReviews(RECENT_ROWS)
      const next = r.reviews ?? []
      if (JSON.stringify(next.map((x) => x.path)) !== JSON.stringify(recent.map((x) => x.path))) {
        recent = next
        registerRecentRows()
      }
    } catch {}
  }

  registerLabelled()
  void refreshRecent()
  later(restoreTabs, 0)
  i18n.onLocaleChange?.(() => registerLabelled())
  let lastLang = settings.get().language
  settings.subscribe((s) => {
    if (s.language !== lastLang) {
      lastLang = s.language
      registerLabelled()
    }
  })
  ctx.onDispose?.(() => {
    labelled.clear()
    recentRows.clear()
  })

  // the "open review" card in answers
  ctx.register({
    id: 'card',
    area: SDK.TRANSCRIPT_DIRECTIVE_AREA ?? 'transcript.directives',
    data: {
      name: 'diple-docs',
      render: ({ attrs, streaming }) => createElement(OpenReviewCard, { rt, attrs, streaming })
    }
  })

  // mirror the card switch to the backend, where the agent hook reads it
  const pushSettings = () => api.putSettings({ autoCard: settings.get().autoCard }).catch(() => {})
  void pushSettings()
  let lastCard = settings.get().autoCard
  settings.subscribe((s) => {
    if (s.autoCard !== lastCard) {
      lastCard = s.autoCard
      void pushSettings()
    }
  })

  // ⌘⇧E on a review page. The host dispatches ⌘⇧E to the Diple plugin's action in the
  // capture phase; this bubble listener adds the annotation here when the selection sits in a
  // review document (Diple ignores selections outside chat messages).
  const onKey = (e) => {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey || e.altKey) return
    if ((e.code !== 'KeyE' && String(e.key).toLowerCase() !== 'e') || e.isComposing) return
    const target = e.target
    if (target?.closest?.('textarea, input, [contenteditable="true"]')) return
    const sel = document.getSelection()
    for (const p of pages) {
      if (p.owns(sel)) {
        e.preventDefault()
        void p.annotate()
        return
      }
    }
  }
  if (ctx.addEventListener) ctx.addEventListener(window, 'keydown', onKey)
  else {
    window.addEventListener('keydown', onKey)
    ctx.onDispose?.(() => window.removeEventListener('keydown', onKey))
  }

  return rt
}
