// float: where the editor under the passage goes (V3-D2 L #3, the chat's V3-T
// rule, re-stated here — the chat's code stays in its plugin this round). Pure.
//
//   placeFloat(rect, size, view, { rtl }) → { top, left, side }
//     rect  the passage's box relative to the document pane's visible top-left
//     size  the editor's { width, height }
//     view  the pane: { width, height, scrollTop }
//   Under the passage, its start edge on the passage's start edge (RTL: the right
//   one), kept inside the pane. No room below in the visible pane → above it;
//   neither → the roomier side. top is in the pane's SCROLL space, so the editor
//   scrolls with the words and nothing is measured on scroll (the V2.1 pin rule).
export const GAP = 4
const EDGE = 8

export function placeFloat(rect, size, view, { rtl = false } = {}) {
  const x = rtl ? rect.right - size.width : rect.left
  const left = Math.round(Math.max(EDGE, Math.min(x, view.width - size.width - EDGE)))
  const below = rect.bottom + GAP
  const above = rect.top - GAP - size.height
  const scroll = view.scrollTop ?? 0
  let side
  if (below + size.height <= view.height - EDGE) side = 'bottom'
  else if (above >= EDGE) side = 'top'
  else side = view.height - rect.bottom >= rect.top ? 'bottom' : 'top'
  const top = side === 'bottom' ? below : Math.max(above, -scroll)
  return { top: Math.round(top + scroll), left, side }
}
