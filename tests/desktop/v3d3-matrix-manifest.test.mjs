// R11 XR11-09: the click matrix is checkable by a machine. The control list
// (tests/desktop/v3d3-controls.mjs) holds every control of design §11 with its usable
// and disabled states; audit() fails a control that was never run, counts a SKIP
// apart (never as a pass) and lets only a `manual` control skip — T3 alone.
// The REST-layer tally sees a doubled POST that the store de-duplicated.
import test from 'node:test'
import assert from 'node:assert/strict'

import { CONTROLS, audit, keyOf, tally } from './v3d3-controls.mjs'

const allPass = () => Object.fromEntries(CONTROLS.filter((c) => !c.manual).flatMap((c) => c.states.map((s) => [keyOf(c.id, s), { result: 'pass' }])))

test('XR11-09 the list has every gap the review named, each with the states it must be clicked in', () => {
  const ids = new Map(CONTROLS.map((c) => [c.id, c.states]))
  const need = {
    'L2-answered': ['on'], 'L2-changed': ['on'],
    'L3-resolve-all': ['on', 'off'], 'L3-clear-filter': ['on'],
    'L3-clear-resolved': ['on', 'off'], 'L3-clear-changed': ['on', 'off'],
    'L4-scope': ['on'], 'L4-current': ['on'], 'L4-recent': ['on'], 'L4-queue': ['on'], 'L4-copy': ['on'],
    C8: ['on'], C9: ['on'], C10: ['on'], C11: ['on'], F6x: ['on'], 'P2-remove': ['on'], P2: ['on'],
    C6: ['on', 'off'], F7: ['on']
  }
  for (const [id, states] of Object.entries(need)) assert.deepEqual(ids.get(id), states, id)
  for (const id of ['T1', 'T2', 'T4', 'S1', 'F1', 'F2', 'F3', 'F4', 'F5a', 'F5b', 'F6', 'L1', 'L3', 'L4', 'C1', 'C2', 'C3', 'C4', 'C5', 'C7', 'D1', 'D2', 'R1', 'R2', 'R3', 'B1', 'H1', 'H2', 'H3', 'P1', 'P3']) assert.ok(ids.has(id), id)
  assert.equal(new Set(CONTROLS.map((c) => c.id)).size, CONTROLS.length, 'no id twice')
  assert.ok(!ids.has('R4'), 'R11-I: the rail has no expand of its own (T4 is the one switch)')
})

test('XR11-09 only T3 is manual, and it says why', () => {
  const manual = CONTROLS.filter((c) => c.manual)
  assert.deepEqual(manual.map((c) => c.id), ['T3'])
  assert.match(manual[0].manual, /Finder/)
})

test('XR11-09 audit: every state run and passed → ok, the one SKIP counted apart', () => {
  const r = audit(allPass())
  assert.equal(r.ok, true, r.problems.join('\n'))
  assert.equal(r.skip, 1)
  assert.equal(r.fail, 0)
  assert.equal(r.pass, CONTROLS.filter((c) => !c.manual).reduce((n, c) => n + c.states.length, 0))
})

test('XR11-09 audit negatives: a control not found, a disabled state not checked, a SKIP, a failure, an unlisted row', () => {
  const missing = allPass()
  delete missing[keyOf('L2-answered')]
  assert.ok(audit(missing).problems.includes('L2-answered@on: never run (missing)'))
  const noOff = allPass()
  delete noOff[keyOf('L3-resolve-all', 'off')]
  assert.equal(audit(noOff).ok, false)
  const skipped = { ...allPass(), [keyOf('P2')]: { result: 'skip', reason: 'palette' } }
  const r = audit(skipped)
  assert.equal(r.ok, false)
  assert.equal(r.skip, 2, 'counted as a skip')
  assert.equal(r.pass + r.fail + 1, Object.keys(allPass()).length + 1)
  assert.ok(r.problems.some((p) => p.startsWith('P2@on: skipped')))
  assert.equal(audit({ ...allPass(), [keyOf('C9')]: { result: 'fail', reason: 'x' } }).ok, false)
  assert.ok(audit({ ...allPass(), 'Z9@on': { result: 'pass' } }).problems.includes('Z9@on: not in the control list'))
  assert.ok(audit({ ...allPass(), [keyOf('T3')]: { result: 'pass' } }).problems.some((p) => p.startsWith('T3@on: manual')))
})

test('XR11-09 tally: user writes only, a de-duplicated double POST still counts 2', () => {
  const e = (method, route) => ({ method, route })
  assert.deepEqual(
    tally([
      e('POST', '/items'), e('POST', '/items'), e('PATCH', '/items/rbdb6b6a41dfa4a7'), e('POST', '/items/restore'), e('POST', '/items/locate'), e('POST', '/items/summary'),
      e('POST', '/events/batch-sent'), e('POST', '/reviews/recent'), e('DELETE', '/reviews/recent'), e('POST', '/handoffs'),
      e('POST', '/handoffs/h1/receipt'), e('POST', '/handoffs/h1/settled'), e('POST', '/handoffs/rebroadcast-pending'), e('POST', '/items/bulk-delete')
    ]),
    { 'POST /items': 2, 'PATCH /items/:id': 1, 'POST /items/restore': 1, 'DELETE /reviews/recent': 1, 'POST /handoffs': 1, 'POST /items/bulk-delete': 1 }
  )
})
