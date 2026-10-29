// pick: selections and highlights on the review page's two views.
//
//   pickRange({ selection, root, view, text }) → { ok: true, range:{start,end} } | { ok: false, reason }
//        reason: 'empty' | 'outside' | 'unmapped'  ('unmapped': rendered text that could not be
//        matched to the source exactly; the reader is asked to use the source view)
//   paint({ root, view, text, ranges }) → Map<itemId, DOM Range>
//   hitTest(domRanges, node, offset) → itemId | null   (which annotation a click landed on)
//
// Source view DOM contract: every line is an element with data-line-start="<offset>"
// whose only text node is the line's text (no trailing newline).

import { describe, normalize, pickOccurrence, toRendered, toSource } from './md-map.js'
import { indexText } from './dom-text.js'
import { trimRange } from './model.js'

const LINE = '[data-line-start]'

function sourceOffset(root, node, offset) {
  const el = node.nodeType === 1 ? node : node.parentElement
  const line = el?.closest(LINE)
  if (line && root.contains(line)) {
    const base = Number(line.getAttribute('data-line-start'))
    if (node.nodeType === 3) return base + offset
    return offset === 0 ? base : base + (line.textContent?.length ?? 0)
  }
  // a point between line elements (root itself)
  if (node === root) {
    const lines = root.querySelectorAll(LINE)
    const target = node.childNodes[offset]
    for (const l of lines) if (l === target || target?.contains?.(l)) return Number(l.getAttribute('data-line-start'))
    const last = lines[lines.length - 1]
    return last ? Number(last.getAttribute('data-line-start')) + (last.textContent?.length ?? 0) : 0
  }
  return null
}

export function pickRange({ selection, root, view, text }) {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return { ok: false, reason: 'empty' }
  const r = selection.getRangeAt(0)
  if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return { ok: false, reason: 'outside' }
  if (!normalize(selection.toString())) return { ok: false, reason: 'empty' }
  let range = null
  if (view === 'source') {
    const s = sourceOffset(root, r.startContainer, r.startOffset)
    const e = sourceOffset(root, r.endContainer, r.endOffset)
    if (s == null || e == null) return { ok: false, reason: 'outside' }
    range = trimRange(text, s, e)
  } else {
    const idx = indexText(root)
    let ns = idx.offsetOf(r.startContainer, r.startOffset)
    let ne = idx.offsetOf(r.endContainer, r.endOffset)
    if (ns < 0 || ne < 0) return { ok: false, reason: 'outside' }
    while (ns < ne && idx.text[ns] === ' ') ns++
    while (ne > ns && idx.text[ne - 1] === ' ') ne--
    const picked = idx.text.slice(ns, ne)
    if (!picked) return { ok: false, reason: 'empty' }
    const found = toSource(text, picked, describe(idx.text, picked, ns))
    if (!found) return { ok: false, reason: 'unmapped' }
    range = trimRange(text, found.start, found.end)
  }
  return range ? { ok: true, range } : { ok: false, reason: 'empty' }
}

function lineIndex(root) {
  return [...root.querySelectorAll(LINE)].map((el) => ({ el, start: Number(el.getAttribute('data-line-start')) }))
}

function pointInLines(lines, offset) {
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lines[mid].start <= offset) lo = mid
    else hi = mid - 1
  }
  const line = lines[lo]
  if (!line) return null
  const t = line.el.firstChild
  const len = t?.nodeType === 3 ? t.data.length : 0
  const o = Math.max(0, Math.min(offset - line.start, len))
  return t?.nodeType === 3 ? [t, o] : [line.el, 0]
}

export function paint({ root, view, text, ranges }) {
  const out = new Map()
  if (!root || !ranges?.size) return out
  const doc = root.ownerDocument
  if (view === 'source') {
    const lines = lineIndex(root)
    for (const [id, { start, end }] of ranges) {
      const a = pointInLines(lines, start)
      const b = pointInLines(lines, end)
      if (!a || !b) continue
      const r = doc.createRange()
      try {
        r.setStart(a[0], a[1])
        r.setEnd(b[0], b[1])
        out.set(id, r)
      } catch {}
    }
    return out
  }
  const idx = indexText(root)
  for (const [id, { start, end }] of ranges) {
    const want = toRendered(text, start, end)
    if (!want) continue
    const hits = []
    for (let i = idx.text.indexOf(want.text); i !== -1; i = idx.text.indexOf(want.text, i + 1)) hits.push(i)
    const k = pickOccurrence(hits, want, idx.text.length)
    if (k < 0) continue
    const r = idx.rangeFor(hits[k], hits[k] + want.text.length)
    if (r) out.set(id, r)
  }
  return out
}

export function hitTest(domRanges, node, offset) {
  let best = null
  let bestLen = Infinity
  for (const [id, r] of domRanges) {
    try {
      if (r.isPointInRange(node, offset)) {
        const len = r.toString().length
        if (len < bestLen) {
          best = id
          bestLen = len
        }
      }
    } catch {}
  }
  return best
}
