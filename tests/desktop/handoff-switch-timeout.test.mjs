// R11-G: a send to a recent session (not the one the chat shows). Diple switches to
// that session before it answers, so its receipt comes after RECEIPT_TIMEOUT_MS. With
// `switching` the sender waits up to RECEIPT_SWITCH_TIMEOUT_MS before the timeout
// notice; a receipt after that is still reported late (onLate), as before.
// Deterministic: a fake clock, the receipt delivered at a fixed time.
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadEntry } from './harness.mjs'

const { createHandoff } = await loadEntry('diple-docs', 'tests/desktop/fixtures/review-handoff.js')

function rig() {
  const events = {}
  const timers = []
  const late = []
  const calls = []
  let clock = 0
  const api = {
    createHandoff: async (p) => calls.push(['create', p.handoffId]),
    recordReceipt: async () => {},
    recordSettled: async () => {},
    cancelHandoff: async (id) => calls.push(['cancel', id]),
    unconfirmedHandoffs: async () => ({ handoffs: [] }),
    getHandoff: async () => null,
    replayHandoff: async () => ({ replayed: false }),
    rebroadcastHandoff: async () => ({}),
    rebroadcastPending: async () => {},
    batchSent: async () => ({ touched: [] }),
    batchAnswered: async () => ({ touched: [] })
  }
  const h = createHandoff({
    api,
    onEvent: (k, fn) => (events[k] = fn),
    schedule: (fn, ms) => timers.push({ fn, at: clock + ms, done: false }),
    newId: () => 'hSwitch1',
    now: () => clock,
    onLate: (r) => late.push(r)
  })
  const tick = () => new Promise((r) => setImmediate(r))
  /** Run the clock to `t` ms, firing timers in order; at `receiptAt` the receipt arrives. */
  async function runTo(t, receiptAt) {
    for (;;) {
      const due = timers.filter((x) => !x.done && x.at <= t).sort((a, b) => a.at - b.at)[0]
      if (receiptAt != null && receiptAt <= t && (!due || receiptAt < due.at)) {
        clock = receiptAt
        events['plugin.diple.handoff.receipt']({ payload: { v: 1, handoffId: 'hSwitch1', accepted: ['r0001'], batchId: 'b1', settles: true } })
        receiptAt = null
        await tick()
        continue
      }
      if (!due) break
      clock = due.at
      due.done = true
      await due.fn()
      await tick()
    }
    clock = t
  }
  return { h, late, calls, runTo, tick }
}

const items = [{ id: 'r0001', revision: 1, path: '/w/a.md', text: 'x', comment: 'c', anchor: { line: 1 } }]

test('R11-G: switching, the receipt at 4 s — delivered, no timeout notice', async () => {
  const r = rig()
  let res = null
  const p = r.h.send(items, { sessionId: 's-recent', sendNow: true, switching: true }).then((x) => (res = x))
  await r.tick()
  await r.runTo(3500)
  assert.equal(res, null, 'still waiting at 3.5 s (no "3 秒内没有确认收到")')
  await r.runTo(4500, 4000)
  await p
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.equal(res.outcome, 'submitted')
  assert.deepEqual(res.accepted, ['r0001'])
  assert.equal(r.calls.filter((c) => c[0] === 'cancel').length, 0, 'never cancelled')
  assert.equal(r.late.length, 0)
})

test('R11-G: switching, the receipt at 12 s — timeout at 10 s, then reported late', async () => {
  const r = rig()
  let res = null
  let at = -1
  const p = r.h.send(items, { sessionId: 's-recent', sendNow: true, switching: true }).then((x) => {
    res = x
  })
  await r.tick()
  await r.runTo(9900)
  assert.equal(res, null, 'still waiting just before 10 s')
  await r.runTo(10_000)
  await p
  at = 10_000
  assert.deepEqual(res, { ok: false, reason: 'timeout' }, `the timeout, at ${at} ms`)
  assert.equal(r.h.peer(), 'missing')
  await r.runTo(12_500, 12_000)
  assert.equal(r.late.length, 1, 'the late receipt is reported')
  assert.equal(r.late[0].ok, true)
  assert.deepEqual(r.late[0].accepted, ['r0001'])
})

test('R11-G: the current session keeps the 3 s rule', async () => {
  const r = rig()
  let res = null
  const p = r.h.send(items, { sessionId: 's-current', sendNow: true }).then((x) => (res = x))
  await r.tick()
  await r.runTo(3000)
  await p
  assert.deepEqual(res, { ok: false, reason: 'timeout' })
  await r.runTo(4500, 4000)
  assert.equal(r.late.length, 1, 'a 4 s receipt is late without `switching`')
})
