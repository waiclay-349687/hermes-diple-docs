// fix-r6 — the Review sender (real createHandoff) facing an Diple that never settles,
// whose batch carried only some of a hand-off's items. Returns every backend write it
// made, IN ORDER, plus what it told the user. Used by tests/desktop/handoff-r6.test.mjs
// and, as a CLI, by tests/python/test_handoff_r6.py (which replays the writes into the
// real Review routes):
//   node tests/desktop/legacy-partial-writes.mjs '{"ids":["rA","rB"],"variant":"fallback"}'
// → JSON { payload, writes: [{ path, body }], notices, initial } on stdout
//   variant  'answered' — batch.sent then batch.answered, both carrying `carried`
//            'fallback' — batch.sent carrying `carried`, then SETTLE_FALLBACK_MS of silence
//   carried  default: every id but the first (the first was removed from the pending list)
//   submitted  true: the receipt names the batch (submitted at once) instead of queued
import { pathToFileURL } from 'node:url'

import { setupDom, loadEntry } from './harness.mjs'

setupDom()
const { createHandoff } = await loadEntry('diple-docs', 'tests/desktop/fixtures/review-handoff.js')

const tick = () => new Promise((r) => setTimeout(r, 1))

export async function legacyPartialWrites({ ids, variant, carried = ids.slice(1), submitted = false, sessionId = 's1', batchId = 'batchLegacyPartial' }) {
  const events = {}
  const writes = []
  const notices = []
  const timers = []
  let payload
  const write = (path, body, answer = {}) => {
    writes.push({ path, body: JSON.parse(JSON.stringify(body)) })
    return Promise.resolve(answer)
  }
  const h = createHandoff({
    api: {
      createHandoff: async (p) => {
        payload = p
        // an older Diple: a receipt without `settles` (the session was busy: queued)
        queueMicrotask(() => events['plugin.diple.handoff.receipt']({ payload: { v: 1, handoffId: p.handoffId, accepted: ids, ...(submitted ? { batchId } : { queued: true }) } }))
      },
      recordReceipt: (id, p) => write(`/handoffs/${id}/receipt`, p),
      recordSettled: (id, p) => write(`/handoffs/${id}/settled`, p),
      batchSent: (p) => write('/events/batch-sent', p),
      batchAnswered: (p) => write('/events/batch-answered', p),
      cancelHandoff: async () => {},
      unconfirmedHandoffs: async () => ({ handoffs: [] }),
      getHandoff: async () => null,
      rebroadcastHandoff: async () => {}
    },
    onEvent: (k, fn) => (events[k] = fn),
    schedule: (fn, ms) => timers.push({ fn, ms }),
    newId: () => 'h-legacy-partial',
    onSettled: (r) => notices.push(r)
  })
  const items = ids.map((id, i) => ({ id, revision: 1, path: '/work/legacy.md', text: 't' + i, comment: '', anchor: { line: i + 1 } }))
  const initial = await h.send(items, { sessionId, sendNow: true })
  const origins = carried.map((itemId) => ({ origin: { plugin: 'diple-docs', itemId, revision: 1 } }))
  events['plugin.diple.batch.sent']({ payload: { v: 1, batchId, sessionId, items: origins } })
  await tick()
  if (variant === 'fallback') {
    for (const t of timers.splice(0)) if (t.ms === 60000) t.fn()
  } else events['plugin.diple.batch.answered']({ payload: { v: 1, batchId, answered: origins } })
  await tick()
  return { payload, writes, notices, initial }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = await legacyPartialWrites(JSON.parse(process.argv[2]))
  process.stdout.write(JSON.stringify(out))
}
