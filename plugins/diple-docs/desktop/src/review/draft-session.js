// draft-session: the identity of a draft and the tickets of its async operations
// (R11-H, XR11b-01…06). Pure; page.jsx keeps the live session in state.
//
// A draft session (select → 标注 until 保存 / 放弃):
//   { draftId, anchorVersion, textVersion, words, range|null, anchor, doc, text,
//     line, fallback, lost, restored, collision }
//   draftId        given at creation, never changes (also the cache slot's key)
//   anchorVersion  +1 on every 重新选取原文 and every relocation after a refresh
//   textVersion    +1 on every keystroke (words: what is typed)
//
// Every async operation on it (保存, 保存并发送, the conflict's 保留已有 / 用我的
// 替换 / 合并, the restore bar's actions) takes an immutable TICKET when it starts:
//   ticket(session, intent) → frozen { draftId, anchorVersion, textVersion, words, intent }
// and its answer is judged ONLY against that ticket and the session then current:
//   sameDraft(session, t)  the session is still that draft, at that anchor → the
//                          answer may close the editor, send (intent 'send', with the
//                          id the answer carries), clear the slot, switch the editor
//   otherwise              the item only lands in the list — nothing else happens
//   typedOn(session, t)    the user typed on while it was in flight (the box is not
//                          locked): the new words become an unsaved edit of that item
// One operation per draft at a time: createLocks() — take() is synchronous, a
// second taker gets false; release() in finally.

let counter = 0
export const newDraftId = (now = Date.now()) => `d${now.toString(36)}${(++counter).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export function newDraft({ draftId = newDraftId(), range = null, anchor, doc, fallback = null, words = '', lost = false, restored = false }) {
  return { draftId, anchorVersion: 0, textVersion: 0, words, range, anchor, doc, text: anchor.text, line: anchor.line, fallback, lost, restored, collision: null }
}

// the draft moved to other words (重新选取原文 / a refresh): same draft, new anchor version
export const moveDraft = (d, { range, anchor, doc, fallback = d.fallback, lost = false }) => ({
  ...d,
  anchorVersion: d.anchorVersion + 1,
  range,
  anchor: anchor ?? d.anchor,
  doc,
  text: (anchor ?? d.anchor).text,
  line: (anchor ?? d.anchor).line,
  fallback,
  lost,
  restored: false
})

export const ticket = (d, intent) => Object.freeze({ draftId: d.draftId, anchorVersion: d.anchorVersion, textVersion: d.textVersion, words: d.words, intent })
export const sameDraft = (d, t) => Boolean(d && t && d.draftId === t.draftId && d.anchorVersion === t.anchorVersion)
export const typedOn = (d, t) => Boolean(d && t && d.textVersion !== t.textVersion && d.words !== t.words)

// the cache slot of a draft (kind 'draft'); blank words → no slot (draft-cache drops it)
export const draftSlot = (d) => ({ kind: 'draft', draftId: d.draftId, anchor: d.anchor, words: d.words, sig: d.anchor?.sig ?? null, anchorVersion: d.anchorVersion, textVersion: d.textVersion })
// a slot may be cleared by an answer only while it is no newer than what was sent
export const slotCovered = (t) => (s) => s.kind === 'draft' && (s.anchorVersion ?? 0) === t.anchorVersion && (s.textVersion ?? 0) === t.textVersion

export function createLocks() {
  const held = new Set()
  return {
    take: (id) => (held.has(id) ? false : (held.add(id), true)),
    release: (id) => void held.delete(id),
    has: (id) => held.has(id)
  }
}
