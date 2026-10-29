// highlights: paint annotations with the CSS Custom Highlight API (no DOM changes
// inside the host-rendered Markdown). Several review tabs can be mounted at
// once; each publishes its ranges under its own key and the shared named
// highlights are rebuilt from all of them.
//
//   setRanges(key, entries)   entries: [{ range, mark: markOf(item), active }]
//   clear(key)
//
// The way back from the list does not flash (V2.1 #1): the deeper "current
// item" fill (er-active) says where the words are, and stays.
//
// A draft (V3-D3 #2: 标注 before 保存) is painted alone, as er-draft: the
// current-item fill, nothing else (it is not an annotation yet).
//
// Layers, bottom to top: the base mark (er-<base>), the 原文已变 overlay
// (er-changed), the current item (er-active). A layer
// paints only the properties its rule sets, so the active fill sits over the
// base underline instead of replacing it.

import { BASES } from './marks.js'

const PRIORITY = { changed: 1, active: 2, draft: 2 }
const LINED = ['pending', 'sent', 'answered', 'resolved']
const NAMES = [...BASES.map((b) => `er-${b}`), ...LINED.map((b) => `er-${b}-line`), 'er-changed', 'er-active', 'er-draft']
const byKey = new Map()

const registry = () => {
  const reg = typeof CSS !== 'undefined' ? CSS?.highlights : undefined
  return reg && typeof Highlight === 'function' ? reg : null
}
export const supported = () => registry() !== null

function repaint() {
  const reg = registry()
  if (!reg) return
  const groups = Object.fromEntries(NAMES.map((n) => [n, []]))
  for (const entries of byKey.values()) {
    for (const e of entries) {
      groups[`er-${e.mark?.base}`]?.push(e.range)
      if (e.mark?.line) groups[`er-${e.mark.base}-line`]?.push(e.range)
      if (e.mark?.changed) groups['er-changed'].push(e.range)
      if (e.active) groups['er-active'].push(e.range)
      if (e.draft) groups['er-draft'].push(e.range)
    }
  }
  for (const n of NAMES) {
    if (groups[n].length) {
      const h = new Highlight(...groups[n])
      h.priority = PRIORITY[n.slice(3)] ?? 0
      reg.set(n, h)
    } else reg.delete(n)
  }
}

export function setRanges(key, entries) {
  byKey.set(key, entries)
  repaint()
}

export function clear(key) {
  byKey.delete(key)
  repaint()
}
