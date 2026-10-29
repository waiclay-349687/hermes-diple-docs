// list-panel: how the review list (标注清单) is laid out (V3-D, research B §6.1).
//
//   createListPanel(storage) → { get, set(patch), subscribe }
//     { collapsed, width, sheetOpen } — remembered globally (ctx.storage
//     'listPanel'), not per file: collapsing is a reading habit. A bad stored
//     value falls back to the defaults. The sheet starts open (the V2 layout:
//     the list in the lower 45%); folding it is the new choice, remembered.
//   listMode({ narrow, collapsed, sheetOpen, peek }) → { mode, sheet }
//     mode 'open'  the list beside the document (width: --er-list-w)
//          'rail'  collapsed into the status rail on the document's edge
//          'sheet' a narrow page (< NARROW px): a bottom bar that folds open
//     sheet 'open' | 'closed' (sheet mode only)
//     peek: a temporary expand (a new annotation's comment is being written
//     while the list is collapsed); never stored.
//   fitList(pageWidth, stored) → { narrow, width, max }
//     V3-D2-I: the page is often docked beside chat (half the main area,
//     ~590px in a 1440px window), so the list stays beside the document as
//     long as both fit: the document keeps DOC_MIN, the list gives way first
//     (never under MIN, never rewriting the remembered width); only below
//     DOC_MIN + MIN does the page switch to the bottom sheet.
//   PANEL — the numbers: default / min / max width, the collapse line (0.6 ×
//   min, after Plannotator), the rail width, the document's minimum, the
//   narrow threshold (= DOC_MIN + MIN).

export const PANEL = { DEF: 340, MIN: 260, MAX: 560, COLLAPSE: 156, RAIL: 28, DOC_MIN: 300, NARROW: 560 }
const KEY = 'listPanel'

export function normalizePanel(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const w = Number.isFinite(r.width) ? Math.round(Math.max(PANEL.MIN, Math.min(PANEL.MAX, r.width))) : PANEL.DEF
  return { collapsed: r.collapsed === true, width: w, sheetOpen: r.sheetOpen !== false }
}

export function createListPanel(storage) {
  let value = normalizePanel(storage?.get?.(KEY, null))
  const subs = new Set()
  return {
    get: () => value,
    set(patch) {
      const next = normalizePanel({ ...value, ...patch })
      if (next.collapsed === value.collapsed && next.width === value.width && next.sheetOpen === value.sheetOpen) return
      value = next
      try {
        storage?.set?.(KEY, value)
      } catch {}
      for (const fn of subs) fn()
    },
    subscribe(fn) {
      subs.add(fn)
      return () => subs.delete(fn)
    }
  }
}

export function listMode({ narrow, collapsed, sheetOpen, peek = false }) {
  if (narrow) return { mode: 'sheet', sheet: sheetOpen || peek ? 'open' : 'closed' }
  return { mode: collapsed && !peek ? 'rail' : 'open', sheet: null }
}

export function fitList(pageWidth, stored) {
  const max = Math.max(PANEL.MIN, Math.min(PANEL.MAX, Math.floor(pageWidth) - PANEL.DOC_MIN))
  return { narrow: pageWidth < PANEL.NARROW, width: Math.max(PANEL.MIN, Math.min(stored, max)), max }
}
