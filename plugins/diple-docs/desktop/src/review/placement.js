// Where a review tab opens (V3-D2, ADR 0013): the same rule Hermes uses for a
// file preview. Host source: apps/desktop/src/app/chat/preview-tile.tsx —
// `existingPreviewAnchor` + `watchPreviewTileMirror` (dir 'right' for the first
// preview, 'center' anchored on an existing preview pane after that, minWidth
// '22rem'). Ours, in order:
//   1. one of our tabs is already in the layout → stack into its zone;
//   2. else a Hermes preview tile is open → stack into the preview zone;
//   3. else dock right of the main zone, so the chat stays visible.

export const REVIEW_MIN_WIDTH = '22rem'
export const PREVIEW_PREFIX = 'preview-tile:'
/** A tab opened this recently may not be adopted into the layout yet (a reload
 *  restores several in one pass); it still anchors the next one. */
export const FRESH_MS = 2000

const RIGHT = Object.freeze({ pane: 'workspace', pos: 'right' })

/**
 * @param {{ own: {paneId: string, at: number}[], layout: string[] | null, now: number }} s
 *   own — our open tabs in opening order; layout — pane ids in the host layout,
 *   or null when it cannot be read.
 * @returns {{ pane: string, pos: 'right' | 'center' }}
 */
export function dockFor({ own, layout, now }) {
  if (!layout) return own.length ? { pane: own[0].paneId, pos: 'center' } : { ...RIGHT }
  const inLayout = new Set(layout)
  // A center dock on a pane missing from the tree falls back to the main zone
  // (store.ts adoption) and would cover the chat, so a stale anchor is skipped.
  const mine = own.find((o) => inLayout.has(o.paneId)) ?? own.find((o) => now - o.at < FRESH_MS)
  if (mine) return { pane: mine.paneId, pos: 'center' }
  const preview = layout.find((id) => id.startsWith(PREVIEW_PREFIX))
  if (preview) return { pane: preview, pos: 'center' }
  return { ...RIGHT }
}

/**
 * The host layout's pane ids, read from its DOM. The plugin SDK has no layout
 * query (only `paneVisibility` for a known id), so this is the one place that
 * reads host markup: every docked pane renders a tab chip `[data-tree-tab=<paneId>]`
 * (components/pane-shell/tree/renderer/tree-group.tsx). A zone with a hidden
 * strip renders no chip; preview and plugin tiles are `placement: 'main'`, which
 * always keeps its strip (strip-visibility.ts `stranded`). No chips at all →
 * null: unreadable, and dockFor falls back to our own tabs, else right.
 */
export function readLayoutPanes(doc = globalThis.document) {
  const nodes = doc?.querySelectorAll?.('[data-tree-tab]')
  if (!nodes?.length) return null
  return [...new Set([...nodes].map((n) => n.getAttribute('data-tree-tab')).filter(Boolean))]
}
