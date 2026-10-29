// fix-r6 — R6 XE6-01 at the Review sender's adapter: with an Diple that never settles,
// what the user is told and what is WRITTEN to the Review backend come from the same
// set of items — the ones the batch events carried. The removed item A is neither shown
// nor recorded as sent, on both legacy paths (batch.answered; batch.sent + quiet period).
//
// legacyPartialWrites is also the JS half of tests/python/test_handoff_r6.py, which
// replays the writes into the real Review routes and reads the list back.
import test from 'node:test'
import assert from 'node:assert/strict'

import { legacyPartialWrites } from './legacy-partial-writes.mjs'

const A = 'r0001'
const B = 'r0002'
const PARTIAL = [
  { itemId: A, delivered: false, reason: 'removed' },
  { itemId: B, delivered: true }
]

for (const variant of ['answered', 'fallback']) {
  test(`XE6-01 (${variant}): the recorded conclusion lists A as not delivered, like the notice`, async () => {
    const { writes, notices } = await legacyPartialWrites({ ids: [A, B], variant })
    const settled = writes.filter((w) => w.path.endsWith('/settled'))
    assert.equal(settled.length, 1, JSON.stringify(writes))
    assert.deepEqual(settled[0].body, {
      v: 1,
      handoffId: 'h-legacy-partial',
      batchId: 'batchLegacyPartial',
      delivered: true,
      inferred: variant === 'answered' ? 'batch.answered' : 'batch.sent',
      items: PARTIAL
    })
    // the notice: from the same word
    assert.deepEqual(notices.at(-1), { ok: true, outcome: 'sent', accepted: [B], missed: 1 })
    // the batch events written carry B only (A is not touched by them)
    for (const w of writes.filter((x) => x.path.includes('/events/'))) {
      const list = w.body.items ?? w.body.answered
      assert.deepEqual(list.map((x) => x.origin.itemId), [B])
    }
  })
}

test('XE6-01: every item carried — the whole hand-off is recorded, with no per-item list', async () => {
  const { writes, notices } = await legacyPartialWrites({ ids: [A, B], variant: 'answered', carried: [A, B] })
  const settled = writes.find((w) => w.path.endsWith('/settled'))
  assert.equal(settled.body.delivered, true)
  assert.ok(!('items' in settled.body))
  assert.deepEqual(notices.at(-1), { ok: true, outcome: 'sent', accepted: [A, B], missed: 0 })
})
