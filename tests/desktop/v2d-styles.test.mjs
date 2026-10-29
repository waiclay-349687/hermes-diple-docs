// V2-D: the plugin's CSS speaks the host's design tokens (V2 design §9, DESIGN.md).
// Seam: REVIEW_CSS, the one stylesheet the plugin injects. These are rules about
// the text of the stylesheet; how it looks is checked by eye on the sandbox
// screenshots (tests/e2e/v2d-review.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadModule } from './harness.mjs'

const { REVIEW_CSS } = await loadModule('diple-docs', 'plugins/diple-docs/desktop/src/review/styles.js')

const rules = (css) => {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  for (let m = re.exec(css); m; m = re.exec(css)) out.push({ sel: m[1].trim(), body: m[2] })
  return out
}
const ALL = rules(REVIEW_CSS.replace(/@media[^{]+\{|@container[^{]+\{|@keyframes[^{]+\{/g, ''))
const rule = (sel) => ALL.filter((r) => r.sel.split(',').map((s) => s.trim()).includes(sel)).map((r) => r.body).join(';')

test('no raw colours: every colour comes from a theme variable', () => {
  assert.doesNotMatch(REVIEW_CSS, /#[0-9a-fA-F]{3,8}\b/)
  assert.doesNotMatch(REVIEW_CSS, /\brgba?\(|\bhsla?\(/)
})

test('radii: host tokens only; a literal radius is at most the 4px icon-button radius', () => {
  for (const m of REVIEW_CSS.matchAll(/border-radius:\s*([^;]+);/g)) {
    const v = m[1].trim()
    if (/^var\(--radius-(xs|sm|md)\b/.test(v)) continue
    const px = /^(\d+(?:\.\d+)?)px$/.exec(v)
    if (px && Number(px[1]) <= 4) continue
    if (v === '50%' || v === '0') continue // the spinner's circle; square text buttons
    assert.fail(`border-radius ${v}`)
  }
  assert.doesNotMatch(REVIEW_CSS, /999px/)
})

test('marks: fill + 2px line, one look per status; 原文已变 is a wavy warning overlay; the current item only deepens the fill', () => {
  const pending = rule('::highlight(er-pending)') + ';' + rule('::highlight(er-pending-line)')
  assert.match(pending, /background-color:[^;]*var\(--ui-accent\)/)
  assert.match(pending, /text-decoration:[^;]*underline[^;]*solid 2px/)
  const plain = rule('::highlight(er-highlight)')
  assert.match(plain, /background-color/)
  assert.doesNotMatch(plain, /text-decoration/, '划线: fill only')
  assert.match(rule('::highlight(er-sent-line)'), /text-decoration:[^;]*dashed/)
  assert.doesNotMatch(rule('::highlight(er-sent)'), /text-decoration/, 'a sent 划线 has no line, as in the chat')
  assert.match(rule('::highlight(er-answered-line)'), /text-decoration:[^;]*solid/)
  assert.match(rule('::highlight(er-resolved-line)'), /text-decoration:[^;]*dotted/)
  assert.equal(rule('::highlight(er-resolved)'), '', 'resolved: no fill')
  const changed = rule('::highlight(er-changed)')
  assert.match(changed, /text-decoration:[^;]*wavy/)
  assert.match(changed, /var\(--ui-yellow\)/)
  assert.doesNotMatch(REVIEW_CSS, /--ui-warning/, 'the host has no --ui-warning token')
  const active = rule('::highlight(er-active)')
  assert.match(active, /background-color/)
  assert.doesNotMatch(active, /text-decoration/, 'keeps the status line underneath')
  assert.equal(rule('::highlight(er-pulse)'), '', 'V2.1 #1: no arrival pulse')
  // ::highlight() ignores text-underline-offset (V2-T P7); do not pretend it works
  for (const r of ALL.filter((r) => r.sel.startsWith('::highlight'))) assert.doesNotMatch(r.body, /text-underline-offset/)
})

test('marks: the sent fill is lighter than the pending fill', () => {
  const pct = (body) => Number(/background-color:[^;]*?(\d+)%/.exec(body)?.[1])
  assert.ok(pct(rule('::highlight(er-sent)')) < pct(rule('::highlight(er-pending)')))
  assert.ok(pct(rule('::highlight(er-active)')) > pct(rule('::highlight(er-pending)')))
})

test('the comment box uses the host input chrome: hairline, inset shadow, accent border + glow on focus', () => {
  const box = rule('.er-editor')
  assert.match(box, /box-shadow:[^;]*var\(--dt-input-inset/)
  assert.match(box, /border:[^;]*1px/)
  const focus = rule('.er-editor.desktop-input-chrome:focus') + rule('.er-editor:focus')
  assert.match(focus, /border-color:[^;]*var\(--ui-accent\)/)
  assert.match(focus, /box-shadow:[^;]*0 0 0 [23]px/)
})

test('floating surfaces use shadow-nous + the --stroke-nous hairline', () => {
  const pick = rule('.er-pickbtn')
  assert.match(pick, /box-shadow:\s*var\(--shadow-nous/)
  assert.match(pick, /var\(--stroke-nous/)
})

test('motion: the pick button fades in from 0.96; everything beyond a fade stops under reduced motion', () => {
  assert.match(REVIEW_CSS, /@keyframes er-pop\s*\{[^}]*scale\(0?\.96\)/)
  assert.match(rule('.er-pickbtn'), /animation:\s*er-pop 120ms/)
  const reduced = /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/.exec(REVIEW_CSS)?.[1] ?? ''
  assert.match(reduced, /animation:\s*none/)
  assert.match(reduced, /transition:\s*none/)
})
