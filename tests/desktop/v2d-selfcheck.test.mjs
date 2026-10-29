// V2-D: load-time SDK self-check (V2 design §10(c)): missing exports are reported
// once and the plugin keeps running degraded, never silently. Seams:
// checkSdk(sdk, env) (what is missing, by feature) and reportSdk(...) (who is told, how often).
import test from 'node:test'
import assert from 'node:assert/strict'

import { checkSdk, markdownRenderer, reportSdk } from '../../plugins/diple-docs/desktop/src/review/selfcheck.js'

class H {}
const FULL = {
  host: { openWorkspace() {}, notify() {} },
  MessageTextContent() {},
  Streamdown() {},
  Button() {},
  Tip() {},
  SegmentedControl() {},
  Switch() {},
  Codicon() {},
  GlyphSpinner() {}
}
const ENV = { CSS: { highlights: new Map() }, Highlight: H }

test('a complete host: nothing missing', () => {
  const r = checkSdk(FULL, ENV)
  assert.deepEqual(r.features, [])
  assert.deepEqual(r.controls, [])
})

test('Markdown is degraded only when BOTH renderers are gone', () => {
  const { MessageTextContent, ...noMtc } = FULL
  assert.deepEqual(checkSdk(noMtc, ENV).features, [], 'Streamdown still renders')
  const { Streamdown, ...none } = noMtc
  assert.deepEqual(checkSdk(none, ENV).features, [{ feature: 'markdown', exports: ['MessageTextContent', 'Streamdown'] }])
})

test('no plugin tabs, no Highlight API: each is its own degraded feature', () => {
  const r = checkSdk({ ...FULL, host: { notify() {} } }, { CSS: undefined, Highlight: undefined })
  assert.deepEqual(
    r.features.map((f) => f.feature),
    ['workspace', 'marks']
  )
  assert.deepEqual(r.features[0].exports, ['host.openWorkspace'])
  assert.deepEqual(r.features[1].exports, ['CSS.highlights'])
})

test('missing UI primitives are listed as controls (plain fallbacks are used), not as features', () => {
  const { Tip, Switch, ...rest } = FULL
  const r = checkSdk(rest, ENV)
  assert.deepEqual(r.features, [])
  assert.deepEqual(r.controls, ['Tip', 'Switch'])
})

const t = (k, ...a) => `${k}(${a.join('|')})`

function env() {
  const store = new Map()
  return {
    notes: [],
    warns: [],
    storage: { get: (k, d) => (store.has(k) ? store.get(k) : d), set: (k, v) => store.set(k, v) },
    store
  }
}

test('reportSdk: a degraded feature is announced once, and logged', () => {
  const e = env()
  const result = checkSdk({ ...FULL, MessageTextContent: undefined, Streamdown: undefined }, ENV)
  const args = { result, notify: (n) => e.notes.push(n), warn: (...a) => e.warns.push(a), storage: e.storage, t }
  reportSdk(args)
  assert.equal(e.notes.length, 1)
  assert.equal(e.notes[0].kind, 'warning')
  assert.match(e.notes[0].message, /review\.selfcheck\.notice/)
  assert.match(e.notes[0].message, /review\.selfcheck\.feature\.markdown/)
  assert.equal(e.warns.length, 1)
  // the same gap on the next load (or the next window): logged, not announced again
  reportSdk(args)
  assert.equal(e.notes.length, 1)
  assert.equal(e.warns.length, 2)
})

test('reportSdk: a different gap is announced again; a healthy host says nothing', () => {
  const e = env()
  const base = { notify: (n) => e.notes.push(n), warn: (...a) => e.warns.push(a), storage: e.storage, t }
  reportSdk({ ...base, result: checkSdk({ ...FULL, Streamdown: undefined, MessageTextContent: undefined }, ENV) })
  reportSdk({ ...base, result: checkSdk({ ...FULL, host: {} }, ENV) })
  assert.equal(e.notes.length, 2)
  reportSdk({ ...base, result: checkSdk(FULL, ENV) })
  assert.equal(e.notes.length, 2)
  assert.equal(e.warns.length, 2)
})

test('reportSdk: only missing controls → logged, no notice', () => {
  const e = env()
  const { Tip, ...rest } = FULL
  reportSdk({ result: checkSdk(rest, ENV), notify: (n) => e.notes.push(n), warn: (...a) => e.warns.push(a), storage: e.storage, t })
  assert.equal(e.notes.length, 0)
  assert.equal(e.warns.length, 1)
})

test('reportSdk: without host.notify it still logs and never throws', () => {
  const e = env()
  reportSdk({ result: checkSdk({ host: {} }, {}), notify: undefined, warn: (...a) => e.warns.push(a), storage: e.storage, t })
  assert.equal(e.warns.length, 1)
})

test('markdownRenderer: the host chat pipeline first, Streamdown when it is missing, plain text last', () => {
  assert.equal(markdownRenderer(FULL), 'MessageTextContent')
  assert.equal(markdownRenderer({ ...FULL, MessageTextContent: undefined }), 'Streamdown')
  assert.equal(markdownRenderer({ host: {} }), null)
  // React.memo / forwardRef components are objects
  assert.equal(markdownRenderer({ MessageTextContent: { $$typeof: Symbol.for('react.memo') } }), 'MessageTextContent')
})
