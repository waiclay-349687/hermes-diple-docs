// review-model: pure rules of the review list (标注清单) on the page side.
//
//   displayStatus(item)            → 'pending'|'sent'|'answered'|'resolved'|'changed'
//   relocate(doc, items, prior?)   → { ranges: Map<id,{start,end}>, results: [...] }
//        doc / prior: strings or Anchor.prepare() values (one preparation per version, XR2-02)
//        results are only the items whose stored state must change (for POST /items/locate):
//        { id, lost: true } or { id, anchor } (refreshed context/line after the text moved)
//   arrange(items, ranges, filter) → { shown, resolved, counts }
//        shown: document order (located items by position, lost ones by their old line);
//        resolved: collapsed group (only under filter 'all')
//   canSend(item)                  → boolean (not resolved, not changed)
//   pendingForSend(items, ranges)  → items a bulk "add to pending / send" should carry
//   docOrder(items, ranges)        → every item in document order (located by position,
//        lost ones by their old line)
//   isUnhandled(item)              → 待发, 原文已变, or 已回应 — not 已发, not 已解决 (V3-D #3)
//   stepUnhandled(ordered, activeId, dir) → id of the next (+1) / previous (−1) unhandled
//        item after / before activeId in `ordered`, wrapping; null when there is none
//   exportLine(item)               → the line to export, or null for a lost item (B7: its
//        stored line is where it USED to be)
//   trimRange(doc, start, end)     → range without surrounding whitespace, or null
//   lineOf(doc, offset)            → 1-based line
//   lineRange(doc, line)           → { start, end } of a 1-based line's text without its
//        block marker (#, >, -, 1.) and surrounding whitespace, or null (blank / out of range).
//        Where a 原文已变 annotation used to be: the overlay is drawn there.

import { Anchor } from '@diple/core'

export const FILTERS = ['all', 'pending', 'sent', 'answered', 'changed', 'resolved']

export function displayStatus(item) {
  return item.lost ? 'changed' : item.status
}

export function lineOf(doc, offset) {
  let line = 1
  for (let i = 0; i < offset && i < doc.length; i++) if (doc.charCodeAt(i) === 10) line++
  return line
}

export function lineRange(doc, line) {
  if (!Number.isInteger(line) || line < 1) return null
  let start = 0
  for (let n = 1; n < line; n++) {
    const nl = doc.indexOf('\n', start)
    if (nl === -1) return null
    start = nl + 1
  }
  let end = doc.indexOf('\n', start)
  if (end === -1) end = doc.length
  const head = /^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(?:\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)?/.exec(doc.slice(start, end))
  start += head ? head[0].length : 0
  while (end > start && /\s/.test(doc[end - 1])) end--
  return end > start ? { start, end } : null
}

const MARKERS = ['**', '__', '~~', '`', '*', '_']

function count(text, m) {
  let n = 0
  for (let i = text.indexOf(m); i !== -1; i = text.indexOf(m, i + m.length)) n++
  return n
}

/**
 * Trim surrounding whitespace, then pull in an emphasis/code marker that the
 * selection cut in half: selecting "bold, then" out of "**bold**, then" gives
 * "**bold**, then", not "bold**, then".
 */
export function trimRange(doc, start, end) {
  let s = Math.max(0, Math.min(start, end))
  let e = Math.min(doc.length, Math.max(start, end))
  while (s < e && /\s/.test(doc[s])) s++
  while (e > s && /\s/.test(doc[e - 1])) e--
  if (e <= s) return null
  for (const m of MARKERS) {
    const text = doc.slice(s, e)
    const single = m.length === 1 ? count(text, m + m) * 2 : 0
    if ((count(text, m) - single) % 2 === 0) continue
    if (doc.slice(s - m.length, s) === m && doc[s - m.length - 1] !== m[0]) s -= m.length
    else if (doc.slice(e, e + m.length) === m && doc[e + m.length] !== m[0]) e += m.length
  }
  return { start: s, end: e }
}

const sameAnchor = (a, b) =>
  a.text === b.text && a.before === b.before && a.after === b.after && a.line === b.line && (a.sig ?? '') === (b.sig ?? '')

/**
 * One relocation pass: the document version (and each earlier one) is prepared
 * ONCE and shared by every item (XR2-02). `doc` / `prior` may be strings or
 * Anchor.prepare() values; callers that relocate the same versions again
 * should pass prepared values.
 */
export function relocate(doc, items, prior = []) {
  const ranges = new Map()
  const results = []
  let P
  try {
    P = Anchor.prepare(doc)
  } catch {
    return { ranges, results: items.filter((it) => !it.lost).map((it) => ({ id: it.id, lost: true })) }
  }
  const found = Anchor.locateMany(P, items.map((it) => it.anchor), { prior })
  items.forEach((item, k) => {
    const hit = found[k]
    if (hit.changed) {
      if (!item.lost) results.push({ id: item.id, lost: true })
      return
    }
    ranges.set(item.id, hit)
    const fresh = Anchor.makeAnchor(P, hit.start, hit.end)
    if (item.lost || !sameAnchor(fresh, item.anchor)) results.push({ id: item.id, anchor: fresh })
  })
  return { ranges, results }
}

function byDocOf(ranges) {
  const pos = (it) => {
    const r = ranges?.get(it.id)
    return r ? [it.anchor.line, r.start] : [it.anchor.line, Number.MAX_SAFE_INTEGER]
  }
  return (a, b) => {
    const [la, sa] = pos(a)
    const [lb, sb] = pos(b)
    const ra = ranges?.get(a.id)
    const rb = ranges?.get(b.id)
    if (ra && rb) return ra.start - rb.start || ra.end - rb.end || a.createdAt - b.createdAt
    return la - lb || sa - sb || a.createdAt - b.createdAt
  }
}

export function docOrder(items, ranges) {
  return [...items].sort(byDocOf(ranges))
}

export function arrange(items, ranges, filter = 'all') {
  const counts = Object.fromEntries(FILTERS.map((f) => [f, 0]))
  for (const it of items) {
    counts.all++
    counts[displayStatus(it)]++
  }
  const byDoc = byDocOf(ranges)
  const sorted = [...items].sort(byDoc)
  if (filter === 'all') {
    return {
      shown: sorted.filter((it) => displayStatus(it) !== 'resolved'),
      resolved: sorted.filter((it) => displayStatus(it) === 'resolved'),
      counts
    }
  }
  return { shown: sorted.filter((it) => displayStatus(it) === filter), resolved: [], counts }
}

export function canSend(item) {
  const s = displayStatus(item)
  return s !== 'resolved' && s !== 'changed'
}

/** Is this item's current revision already sitting in some session's pending list? */
export function isQueued(item) {
  return Boolean(item.queued && item.queued.revision === item.revision && item.status === 'pending')
}

export function pendingForSend(items, ranges) {
  return arrange(items, ranges, 'pending').shown.filter((it) => !isQueued(it))
}

export function isUnhandled(item) {
  if (item.status === 'resolved') return false
  const s = displayStatus(item)
  return s === 'pending' || s === 'changed' || s === 'answered'
}

export function stepUnhandled(ordered, activeId, dir) {
  const n = ordered.length
  if (!n) return null
  const at = ordered.findIndex((it) => it.id === activeId)
  const start = at < 0 ? (dir > 0 ? -1 : n) : at
  for (let k = 1; k <= n; k++) {
    const it = ordered[(((start + dir * k) % n) + n) % n]
    if (isUnhandled(it)) return it.id
  }
  return null
}

export function exportLine(item) {
  return item.lost ? null : (item.anchor?.line ?? null)
}

/** One hand-off item (design §4 payload). A lost item carries no line (B7). */
export function handoffItem(item) {
  const line = exportLine(item)
  return {
    origin: { plugin: 'diple-docs', itemId: item.id, revision: item.revision, path: item.path, ...(line != null ? { line } : {}) },
    text: item.text,
    comment: item.comment ?? ''
  }
}
