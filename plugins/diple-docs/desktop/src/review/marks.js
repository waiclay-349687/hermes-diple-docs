// marks: which mark an annotation gets on the original text (V2 design §2.1–2.2).
//
//   markOf(item) → { base, changed, line }
//     base:    'pending'   a 批注 waiting to be sent   — fill + solid 2px underline
//              'highlight' a 划线 (no comment) waiting  — fill only
//              'sent'      handed to the chat           — half fill (+ dashed underline for a 批注)
//              'answered'  the reply addressed it       — sent look in the answer hue, solid underline
//              'resolved'  done                         — no fill, faint dotted line
//     changed: 原文已变 — an overlay (wavy warning line) on top of the base, never a base itself
//     line:    whether the base draws its underline: a 批注 does, a 划线 does not
//              (the same rule as the chat); resolved always shows its dotted line
//
// The looks come from @diple/core MarkLook (shared with the chat); styles.js
// maps them to ::highlight(er-<base>) (fill), er-<base>-line, er-changed.

export const BASES = ['pending', 'highlight', 'sent', 'answered', 'resolved']

export function markOf(item) {
  const status = item?.status
  const base =
    status === 'sent' || status === 'answered' || status === 'resolved'
      ? status
      : String(item?.comment ?? '').trim()
        ? 'pending'
        : 'highlight'
  const line = base === 'resolved' || Boolean(String(item?.comment ?? '').trim())
  return { base, changed: Boolean(item?.lost), line }
}
