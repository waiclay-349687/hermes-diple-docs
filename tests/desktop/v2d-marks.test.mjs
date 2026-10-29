// V2-D: how annotations are marked on the original text (CSS Custom Highlight API).
// Seams: markOf(item) (which mark an annotation gets) and highlights.setRanges
// (what is registered in CSS.highlights). The registry is a stand-in Map;
// Chromium's real painting is checked in tests/e2e/v2d-review.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'

class FakeHighlight {
  constructor(...ranges) {
    this.ranges = ranges
    this.priority = 0
  }
}
globalThis.CSS = { highlights: new Map() }
globalThis.Highlight = FakeHighlight

const { markOf } = await import('../../plugins/diple-docs/desktop/src/review/marks.js')
const highlights = await import('../../plugins/diple-docs/desktop/src/review/highlights.js')

const reg = () => globalThis.CSS.highlights
const rangesOf = (name) => reg().get(name)?.ranges ?? []

test('markOf: a comment waiting to be sent is a 批注 mark; without a comment it is a 划线', () => {
  assert.deepEqual(markOf({ status: 'pending', comment: '为什么？' }), { base: 'pending', changed: false, line: true })
  assert.deepEqual(markOf({ status: 'pending', comment: '' }), { base: 'highlight', changed: false, line: false })
  assert.deepEqual(markOf({ status: 'pending', comment: '   ' }), { base: 'highlight', changed: false, line: false })
})

test('markOf: sent / answered / resolved keep their own mark; as in the chat, only a 批注 has a line (resolved: always its dotted one)', () => {
  for (const status of ['sent', 'answered']) {
    assert.deepEqual(markOf({ status, comment: 'x' }), { base: status, changed: false, line: true })
    assert.deepEqual(markOf({ status, comment: '' }), { base: status, changed: false, line: false })
  }
  assert.deepEqual(markOf({ status: 'resolved', comment: '' }), { base: 'resolved', changed: false, line: true })
})

test('markOf: 原文已变 is an overlay on top of the status, not a status of its own', () => {
  assert.deepEqual(markOf({ status: 'sent', comment: 'x', lost: true }), { base: 'sent', changed: true, line: true })
  assert.deepEqual(markOf({ status: 'pending', comment: '', lost: true }), { base: 'highlight', changed: true, line: false })
})

test('setRanges: each mark goes into its own named highlight; the overlay and the current item stack above', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  const c = { id: 'c' }
  const d = { id: 'd' }
  highlights.setRanges('page-1', [
    { range: a, mark: { base: 'pending', changed: false, line: true }, active: true },
    { range: b, mark: { base: 'sent', changed: false, line: true } },
    { range: c, mark: { base: 'answered', changed: true, line: false } },
    { range: d, mark: { base: 'highlight', changed: false, line: false } }
  ])
  assert.deepEqual(rangesOf('er-pending'), [a])
  assert.deepEqual(rangesOf('er-pending-line'), [a])
  assert.deepEqual(rangesOf('er-sent-line'), [b])
  assert.equal(reg().has('er-answered-line'), false, 'a 划线 has no line')
  assert.deepEqual(rangesOf('er-highlight'), [d])
  assert.deepEqual(rangesOf('er-sent'), [b])
  assert.deepEqual(rangesOf('er-answered'), [c])
  assert.deepEqual(rangesOf('er-changed'), [c])
  assert.deepEqual(rangesOf('er-active'), [a])
  assert.equal(reg().has('er-resolved'), false, 'empty layers are not registered')
  const base = reg().get('er-pending').priority
  assert.ok(reg().get('er-changed').priority > base)
  assert.ok(reg().get('er-active').priority > reg().get('er-changed').priority)
  highlights.clear('page-1')
  assert.equal(reg().size, 0)
})

test('setRanges: two mounted pages share the named highlights; clearing one keeps the other', () => {
  const a = { id: 'a' }
  const b = { id: 'b' }
  highlights.setRanges('p1', [{ range: a, mark: { base: 'pending', changed: false } }])
  highlights.setRanges('p2', [{ range: b, mark: { base: 'pending', changed: false } }])
  assert.deepEqual(rangesOf('er-pending'), [a, b])
  highlights.clear('p1')
  assert.deepEqual(rangesOf('er-pending'), [b])
  highlights.clear('p2')
})

test('V2.1 #1: no arrival pulse — the module has none, and nothing named er-pulse is ever drawn', () => {
  assert.equal(highlights.pulse, undefined)
  assert.equal(reg().has('er-pulse'), false)
})

test('without the Highlight API nothing throws (the self-check reports it)', () => {
  const saved = globalThis.CSS
  globalThis.CSS = undefined
  try {
    highlights.setRanges('x', [{ range: {}, mark: { base: 'pending', changed: false } }])
    highlights.clear('x')
  } finally {
    globalThis.CSS = saved
  }
})
