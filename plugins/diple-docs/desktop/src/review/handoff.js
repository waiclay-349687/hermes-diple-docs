// handoff: the sender side of the hand-off protocol (design §4, ADR 0004).
// This module owns what a hand-off's result MEANS; callers only show it.
//
//   const h = createHandoff({ api, onEvent, schedule: setTimeout-like, newId, peerDisabled,
//                             onItemsChanged, onLate, onSettled, now })
//   h.send(items, { sessionId, sendNow, force, switching }) → Promise<
//        { ok: true, outcome, accepted: [itemId], missed, batchId? }
//      | { ok: false, reason: 'no-session' | 'no-items' | 'peer-disabled' | 'unconfirmed'
//                             | 'timeout' | 'rejected' | 'error' }>
//     outcome — 'added'     in the target session's pending list (加入待发)
//             | 'submitted' added, and the Diple plugin submitted a batch (receipt has
//                           batchId). NOT yet "sent": the turn may still fail (XR-09)
//             | 'queued'    added; the session is busy and it goes out after the answer
//             | 'not-sent'  added, but 直接发送 did not happen (refused / failed; no batchId)
//     missed  — how many handed-over items the receipt did NOT accept
//     timeout — NOT "nothing was sent": no receipt within RECEIPT_TIMEOUT_MS of the
//               broadcast (RECEIPT_SWITCH_TIMEOUT_MS with `switching`: the target is
//               not the session the chat shows, Diple switches to it first and its
//               receipt comes later — R11-G). The receiver may still be working (XR-03). If its receipt
//               arrives later, onLate(result) reports it and the list refreshes.
//     unconfirmed — some of these items are in a recent hand-off that timed out and was
//               never confirmed. h.sendAnyway() is the user's "仍然发送".
//   h.sendAnyway(items, opts) → like send(), but first REPLAYS the unconfirmed hand-off(s)
//               under their own id (the receiver replays its result, it never runs one
//               twice). { ok:false, reason:'replay-missing' } when there is nothing to
//               replay (changed since, unknown): only then may the caller, after a second
//               confirmation, call send(items, { force: true }) for a new hand-off (XR-03).
//   onSettled(result) — the FINAL word on a 'submitted' / 'queued' hand-off made here:
//        { ok: true, outcome: 'sent' | 'returned' | 'unknown', accepted, missed, reason? }
//        'sent'     plugin.diple.handoff.settled delivered:true (or, from an Diple
//                   version without settled, batch.answered / batch.sent + quiet period)
//        'returned' delivered:false — the items are back in the pending list; reason shown
//        'unknown'  nothing conclusive within the fallback window: stop waiting, say so
//   h.peer()            → 'unknown' | 'ok' | 'missing' | 'disabled'
//   h.subscribe(fn)     → unsubscribe (peer state changes)
//   h.retryPeer()       forget a 'missing' verdict (the user installed / enabled Diple)
//   h.resume()          re-broadcast recent hand-offs still waiting for a receipt (page mount)
//
// The receiver cannot be told to stop (it has no cancel channel), so a timed-out
// hand-off is only taken off the rebroadcast list (POST …/cancel); it is not undone.
//
// Events it listens to (all windows receive them; the backend is idempotent):
//   plugin.diple.handoff.receipt  {v:1, handoffId, accepted:[itemId], batchId?, queued?}
//   plugin.diple.handoff.settled  {v:1, handoffId, batchId, delivered, reason?, items?}
//       items (per-item word) only reaches a sender that declared caps:['partial'] in its
//       hand-off payload; an older one is told delivered:false, reason:'partial' (R5)
//   plugin.diple.batch.sent       {v:1, batchId, sessionId, items:[{origin}]}   (intermediate)
//   plugin.diple.batch.answered   {v:1, batchId, answered:[{origin}]}
// The plugin event envelope's session_id is always empty; everything needed
// is inside the payload.
//
// What a receipt, a settled, a batch.sent / batch.answered or the fallback timer
// MEANS — in any order, lost or repeated — is the shared state machine
// `Handoff.senderStep` (packages/core/src/handoff-protocol.js, ADR 0007); this
// module is its adapter (timers, backend, notifications). In short:
//   - an Diple that declares `settles: true` in its receipt is only believed
//     through handoff.settled; while waiting, the backend is polled every
//     SETTLE_POLL_MS and the hand-off is rebroadcast with {settle:true} on a
//     backoff (SETTLE_REBROADCAST_MS, doubling up to SETTLE_PULL_MAX_MS) so the
//     receiver replays its final word; after SETTLE_QUEUED_MS: 'unknown';
//   - an older Diple (no `settles`): batch.answered, or batch.sent followed by
//     SETTLE_FALLBACK_MS of silence, counts as sent (recorded as inferred);
//   - a real settled that arrives after an inferred 'sent' or an 'unknown'
//     corrects it: onSettled({ ..., corrected: true }) (XR3-04);
//   - one batch may carry several hand-offs: its events reach every one (XR3-03).

import { Envelope, Handoff } from '@diple/core'

// The chat plugin's id = its event namespace = its @-prefix (core Envelope).
const CHAT = `plugin.${Envelope.REFERENCE_PREFIX}`
import { handoffItem } from './model.js'

export const RECEIPT_TIMEOUT_MS = 3000
// a send to another session (a recent one): Diple opens that session before it
// answers, so the receipt is often later than RECEIPT_TIMEOUT_MS — wait this long
// before the timeout notice (R11-G)
export const RECEIPT_SWITCH_TIMEOUT_MS = 10000
export const UNCONFIRMED_WINDOW_MS = 10 * 60 * 1000
export const SETTLE_POLL_MS = 5000
export const SETTLE_REBROADCAST_MS = 15000
export const SETTLE_FALLBACK_MS = 60000
export const SETTLE_QUEUED_MS = 10 * 60 * 1000
export const SETTLE_PULL_MAX_MS = 5 * 60 * 1000

const payloadOf = (e) => (e && typeof e === 'object' && 'payload' in e ? e.payload : e)
const hasReviewOrigin = (list) =>
  Array.isArray(list) && list.some((x) => x?.origin?.plugin === 'diple-docs')

/** What a receipt says happened, for a hand-off of `requested` items. */
const readReceipt = Handoff.readReceipt

export function createHandoff({
  api,
  onEvent,
  schedule,
  newId,
  peerDisabled = () => false,
  onItemsChanged = () => {},
  onLate = () => {},
  onSettled = () => {},
  now = () => Date.now()
}) {
  let peer = 'unknown'
  const listeners = new Set()
  const waiting = new Map() // handoffId → resolve(receipt)
  const unconfirmed = new Map() // handoffId → { itemIds, sendNow, at } timed out, no receipt yet
  // handoffId → { state (Handoff.senderStep), since, token } for every hand-off made
  // here (also re-created for one replayed after a reload by sendAnyway)
  const runs = new Map()
  const runFor = (handoffId, { sendNow, itemIds }) => {
    if (!runs.has(handoffId)) runs.set(handoffId, { state: Handoff.senderInit({ sendNow, itemIds }), since: now(), token: 0 })
    while (runs.size > 200) runs.delete(runs.keys().next().value)
    return runs.get(handoffId)
  }

  const validSettled = (p) =>
    p && p.v === 1 && typeof p.handoffId === 'string' && p.handoffId && typeof p.delivered === 'boolean'

  /** Feed one event to a hand-off's machine; run its effects. → the `result` effect, if any. */
  function feed(handoffId, event) {
    const run = runs.get(handoffId)
    if (!run) return null
    // the first real final word (the machine believes the first one too): with a per-item
    // list it says which of the handed-over items really went out (R4 XE4-02, R5)
    if (event.type === 'settled' && !event.inferred && typeof event.delivered === 'boolean' && !run.word) run.word = event
    const step = Handoff.senderStep(run.state, event)
    run.state = step.state
    // only the items that went out count as sent — also when the final word beat the
    // receipt (the receipt's result is then already final, R5). The word: the real one,
    // else the one the machine inferred from an Diple that never settles — the SAME
    // word its `record` effect writes to the backend (R6 XE6-01)
    const narrow = (r) => {
      const word = run.word ?? (run.state.inferred ? run.state.word : null)
      if (!r?.ok || r.outcome !== 'sent' || !word) return r
      const out = new Set(Handoff.itemOutcomes(word, r.accepted).filter((x) => x.delivered).map((x) => x.itemId))
      const accepted = r.accepted.filter((id) => out.has(id))
      return { ...r, accepted, missed: r.missed + (r.accepted.length - accepted.length) }
    }
    let result = null
    for (const eff of step.effects) {
      if (eff.type === 'result') result = narrow(eff.result)
      else if (eff.type === 'wait') wait(handoffId, run, eff)
      else if (eff.type === 'record') {
        const batchId = run.state.batchId
        const body = { v: 1, handoffId, ...(batchId ? { batchId } : {}), delivered: eff.delivered, ...(eff.reason ? { reason: eff.reason } : {}), inferred: eff.inferred, ...(eff.items ? { items: eff.items } : {}) }
        api.recordSettled?.(handoffId, body)
          ?.then(() => onItemsChanged())
          ?.catch(() => {})
      } else if (eff.type === 'final') {
        const base = run.state.base
        const { accepted, missed } = narrow({ ok: true, outcome: eff.outcome, accepted: base.accepted, missed: base.missed })
        onSettled({ ok: true, outcome: eff.outcome, accepted, missed, ...(eff.reason ? { reason: eff.reason } : {}), ...(eff.corrected ? { corrected: true } : {}) })
      }
    }
    return result
  }

  /** Waiting for the final word: poll the backend, pull from the receiver, arm the fallback. */
  function wait(handoffId, run, { queued, settles, rearm }) {
    const token = ++run.token
    const live = () => runs.get(handoffId) === run
    const pending = () => live() && run.state.phase === 'settling'
    // the fallback: a legacy receiver's quiet period, else "unknown" (still correctable)
    const ms = rearm ? SETTLE_FALLBACK_MS : settles || queued ? SETTLE_QUEUED_MS : SETTLE_FALLBACK_MS
    schedule(() => {
      if (pending() && run.token === token) feed(handoffId, { type: 'fallback' })
    }, ms)
    if (rearm) return
    // poll the backend (another window may have recorded it) — also after a conclusion this
    // window drew itself, so a real answer can still correct it
    const correctable = () => live() && !run.state.real && now() - run.since < SETTLE_QUEUED_MS + SETTLE_FALLBACK_MS
    const poll = () => {
      if (!correctable()) return
      api
        .getHandoff?.(handoffId)
        ?.then((h) => {
          const st = h?.settled
          if (st && !st.inferred && typeof st.delivered === 'boolean') feed(handoffId, { type: 'settled', ...st })
        })
        ?.catch(() => {})
      schedule(poll, SETTLE_POLL_MS)
    }
    schedule(poll, SETTLE_POLL_MS)
    // pull: ask the receiver to replay its final word (a receiver declaring settles keeps it)
    let gap = SETTLE_REBROADCAST_MS
    const pull = () => {
      if (!pending()) return
      api.rebroadcastHandoff?.(handoffId, { settle: true })?.catch?.(() => {})
      if (!settles) return // an older Diple: once is enough
      gap = Math.min(gap * 2, SETTLE_PULL_MAX_MS)
      schedule(pull, gap)
    }
    schedule(pull, SETTLE_REBROADCAST_MS)
  }

  const itemIdsOf = (origins) => (origins ?? []).map((x) => x?.origin?.itemId).filter((x) => typeof x === 'string')
  /** Every hand-off still waiting that a batch event belongs to (by batchId, or a queued one by its items). */
  const waitingFor = (batchId, origins) => {
    const ids = new Set((origins ?? []).map((x) => x?.origin?.itemId).filter(Boolean))
    const out = []
    for (const [id, run] of runs) {
      const st = run.state
      if (st.phase !== 'settling') continue
      if (st.batchId ? st.batchId === batchId : st.base.accepted.some((x) => ids.has(x))) out.push(id)
    }
    return out
  }

  const setPeer = (p) => {
    if (p === peer) return
    peer = p
    for (const fn of [...listeners]) fn(peer)
  }
  const effectivePeer = () => (peerDisabled() ? 'disabled' : peer)

  onEvent(`${CHAT}.handoff.receipt`, (e) => {
    const r = payloadOf(e)
    if (!r || r.v !== 1 || typeof r.handoffId !== 'string') return
    setPeer('ok')
    const resolve = waiting.get(r.handoffId)
    waiting.delete(r.handoffId)
    api
      .recordReceipt(r.handoffId, r)
      .then(() => onItemsChanged())
      .catch(() => {}) // a receipt for a hand-off another profile/window made: not ours
    if (resolve) return resolve(r)
    const late = unconfirmed.get(r.handoffId)
    if (late) {
      unconfirmed.delete(r.handoffId)
      runFor(r.handoffId, late)
      const res = feed(r.handoffId, { type: 'receipt', receipt: r })
      if (res) onLate(res)
    }
  })
  onEvent(`${CHAT}.handoff.settled`, (e) => {
    const p = payloadOf(e)
    if (!validSettled(p)) return
    setPeer('ok')
    const body = { v: 1, handoffId: p.handoffId, delivered: p.delivered }
    if (typeof p.batchId === 'string' && p.batchId) body.batchId = p.batchId
    if (typeof p.reason === 'string' && p.reason && !p.delivered) body.reason = p.reason
    const items = Array.isArray(p.items) ? p.items.filter((x) => x && typeof x.itemId === 'string' && typeof x.delivered === 'boolean') : null
    if (items?.length) body.items = items.map((x) => ({ itemId: x.itemId, delivered: x.delivered, ...(typeof x.reason === 'string' && !x.delivered ? { reason: x.reason } : {}) }))
    api
      .recordSettled?.(p.handoffId, body)
      .then(() => onItemsChanged())
      .catch(() => {}) // another profile's hand-off
    feed(p.handoffId, { type: 'settled', ...body }) // a hand-off made elsewhere has no run: recorded only
  })
  onEvent(`${CHAT}.batch.sent`, (e) => {
    const p = payloadOf(e)
    if (p?.v !== 1 || !hasReviewOrigin(p.items)) return
    // intermediate: the batch was expanded into the turn; the turn may still fail
    const carried = itemIdsOf(p.items)
    for (const id of waitingFor(p.batchId, p.items)) feed(id, { type: 'sent', batchId: p.batchId, carried })
    api.batchSent(p).then((r) => r?.touched?.length && onItemsChanged()).catch(() => {})
  })
  onEvent(`${CHAT}.batch.answered`, (e) => {
    const p = payloadOf(e)
    if (p?.v !== 1 || !hasReviewOrigin(p.answered)) return
    // proof of delivery only from an Diple without settled (the machine decides)
    // the batch's items (batch.sent) say what went out; without them the answered ones
    // (maybe fewer: an unsent item is never shown as sent, a sent one may be shown unsent)
    const carried = itemIdsOf(Array.isArray(p.items) ? p.items : p.answered)
    for (const id of waitingFor(p.batchId, p.answered)) feed(id, { type: 'answered', batchId: p.batchId, carried })
    api.batchAnswered(p).then((r) => r?.touched?.length && onItemsChanged()).catch(() => {})
  })

  /** Unconfirmed hand-offs holding any of these items: this window's timeouts, plus
   *  the backend's list (other windows, before a reload). → [{ handoffId, itemIds }] */
  const unconfirmedFor = async (ids) => {
    const t = now()
    const out = new Map()
    for (const [id, u] of unconfirmed) {
      if (t - u.at > UNCONFIRMED_WINDOW_MS) unconfirmed.delete(id)
      else if (ids.some((x) => u.itemIds.includes(x))) out.set(id, { handoffId: id, itemIds: u.itemIds, sendNow: u.sendNow })
    }
    try {
      const r = await api.unconfirmedHandoffs?.()
      for (const h of r?.handoffs ?? [])
        if (Array.isArray(h.itemIds) && ids.some((x) => h.itemIds.includes(x)) && !out.has(h.handoffId)) out.set(h.handoffId, h)
    } catch {
      // an older backend without the route: this window's memory is all we have
    }
    return [...out.values()]
  }
  const overlapsUnconfirmed = async (ids) => (await unconfirmedFor(ids)).length > 0

  /** Wait for the receipt of a broadcast hand-off (RECEIPT_TIMEOUT_MS from now; longer
   *  while the target session is being switched to). */
  const receiptOf = (handoffId, switching = false) =>
    new Promise((resolve) => {
      waiting.set(handoffId, resolve)
      schedule(() => {
        if (waiting.delete(handoffId)) resolve(null)
      }, switching ? RECEIPT_SWITCH_TIMEOUT_MS : RECEIPT_TIMEOUT_MS)
    })

  /** "Send anyway": replay the earlier hand-off(s) under their own id first (XR-03). */
  async function sendAnyway(items, { sessionId, sendNow = false, switching = false } = {}) {
    if (!items?.length) return { ok: false, reason: 'no-items' }
    if (peerDisabled()) return { ok: false, reason: 'peer-disabled' }
    const itemIds = items.map((it) => it.id)
    const olds = await unconfirmedFor(itemIds)
    if (!olds.length) return send(items, { sessionId, sendNow, force: true, switching })
    let res = null
    for (const old of olds) {
      let r
      let first = null // the replayed receipt may beat the HTTP answer
      waiting.set(old.handoffId, (x) => (first = x))
      try {
        r = await api.replayHandoff(old.handoffId)
      } catch {
        r = { replayed: false, reason: 'error' }
      }
      if (!r?.replayed && !first) waiting.delete(old.handoffId)
      const meta = { sendNow: old.sendNow ?? sendNow, itemIds: old.itemIds }
      let got
      if (first) got = first
      else if (r?.receipt) got = r.receipt
      else if (r?.replayed) {
        got = await receiptOf(old.handoffId, switching)
        if (!got) return { ok: false, reason: 'timeout' } // still unconfirmed; stays on the list
      } else return { ok: false, reason: 'replay-missing' }
      unconfirmed.delete(old.handoffId)
      runFor(old.handoffId, meta)
      const one = feed(old.handoffId, { type: 'receipt', receipt: got }) ?? readReceipt(got, meta)
      res ??= one
    }
    return res
  }

  async function send(items, { sessionId, sendNow = false, force = false, switching = false } = {}) {
    if (!items?.length) return { ok: false, reason: 'no-items' }
    if (!sessionId) return { ok: false, reason: 'no-session' }
    if (peerDisabled()) return { ok: false, reason: 'peer-disabled' }
    const itemIds = items.map((it) => it.id)
    if (!force && (await overlapsUnconfirmed(itemIds))) return { ok: false, reason: 'unconfirmed' }
    const handoffId = newId()
    // caps: this sender reads a per-item settled (R5 XE5-02); without it Diple reports a
    // partly carried hand-off as not delivered
    const payload = { v: 1, handoffId, targetSessionId: sessionId, sendNow: Boolean(sendNow), caps: [Handoff.CAP_PARTIAL], items: items.map(handoffItem) }
    runFor(handoffId, { sendNow: Boolean(sendNow), itemIds }) // a settled may beat the receipt
    let first = null // a receipt that beat the save round trip
    waiting.set(handoffId, (r) => (first = r))
    try {
      await api.createHandoff(payload)
    } catch {
      waiting.delete(handoffId)
      return { ok: false, reason: 'error' }
    }
    // The clock starts once the hand-off is out (saved + broadcast), not before.
    const r = first ?? (await receiptOf(handoffId, switching))
    if (!r) {
      unconfirmed.set(handoffId, { itemIds, sendNow: Boolean(sendNow), at: now() })
      api.cancelHandoff(handoffId).catch(() => {}) // stop rebroadcasting it; cannot recall it
      setPeer('missing')
      return { ok: false, reason: 'timeout' }
    }
    return feed(handoffId, { type: 'receipt', receipt: r }) ?? readReceipt(r, { sendNow, itemIds })
  }

  return {
    send,
    sendAnyway,
    peer: effectivePeer,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    retryPeer: () => setPeer('unknown'),
    resume: () => api.rebroadcastPending().catch(() => {})
  }
}

/** The notification for a send() result (or a late receipt), in the reader's language. */
export function noticeFor(t, res) {
  if (!res.ok) return { kind: 'warning', durationMs: 7000, message: t(`review.handoff.${res.reason}`) }
  const n = res.accepted.length
  const why = () => {
    const known = res.reason && t(`review.handoff.why.${res.reason}`)
    return known && known !== `review.handoff.why.${res.reason}` ? known : res.reason || t('review.handoff.why.none')
  }
  const main = {
    added: ['success', t('review.handoff.added', n)],
    submitted: ['info', t('review.handoff.submitted', n)],
    sent: ['success', t('review.handoff.sent', n)],
    queued: ['info', t('review.handoff.queued', n)],
    'not-sent': ['warning', t('review.handoff.notSent', n)],
    returned: ['warning', res.outcome === 'returned' ? t('review.handoff.returned', n, why()) : ''],
    unknown: ['warning', t('review.handoff.unknown', n)]
  }[res.outcome]
  const [kind, text] = main
  const full = res.missed > 0 ? `${text} ${t('review.handoff.partial', res.missed)}` : text
  const message = res.corrected ? t('review.handoff.corrected', full) : full
  return { kind: res.missed > 0 && kind === 'success' ? 'info' : kind, durationMs: kind === 'success' ? undefined : 8000, message }
}
