// doc-store: one open document and its review list, kept fresh.
//
//   const doc = createDocStore({ api, path, schedule, isVisible })
//   doc.get()            → state snapshot (stable identity between changes)
//   doc.subscribe(fn)    → unsubscribe
//   doc.start() / doc.stop()      polling every 2 s (paused while the window is hidden)
//   doc.hold()           → release()   while held (someone is writing a comment), a file
//                                     change is NOT applied; the page shows "file changed"
//                                     and applies it on release or on refreshNow()
//   doc.refreshNow()     apply a waiting file change immediately
//   doc.reloadItems()    re-read the list (after an event or an edit elsewhere)
//   doc.anchorFor(range) → { text, line, … } (what add() would store; nothing sent)
//   doc.locate(anchor)   → { start, end } in the text shown now, or null (gone / ambiguous):
//                        a draft follows its words through a refresh (R11 XR11-02)
//   doc.add(range, comment?) / replace(item, range) / setComment(item, text, { base }?)
//                        edits carry expectMutation (versionOf(item)); any concurrent user
//                        operation elsewhere, resolve included → { ok:false, code:'stale' }
//   doc.resolve(item) / reopen(item) / remove(item) → { undo }
//   doc.removeMany(items) → { ok, count, undo }   doc.resolveMany(items)   (V3-D2: one
//                        transaction each; an item changed elsewhere → 'stale', nothing done)
//   every mutation returns { ok, item?, code? } and never throws.
//
// state = {
//   phase: 'loading' | 'ready' | 'error',
//   error,                 // code of the last load error ('not-found', 'unsupported-suffix', …)
//   text, mtime,           // the document as currently shown
//   items, ranges,         // list + located ranges (Map id → {start,end})
//   waiting,               // a newer file version exists but is held back
//   gone,                  // the file disappeared (list stays usable)
//   refreshedAt            // ms of the last applied file version
// }

import { Anchor } from '@diple/core'

import { errorCode } from '../shared/api.js'
import { relocate } from './model.js'

export const POLL_MS = 2000

/** The edit token of an item: `mutation` (XR2-01); an older backend only has `revision`. */
export const versionOf = (item) => (typeof item?.mutation === 'number' ? item.mutation : item?.revision)
const tokens = (items) => Object.fromEntries(items.filter((it) => typeof it.mutation === 'number').map((it) => [it.id, it.mutation]))
const expect = (item, base = versionOf(item)) =>
  typeof item?.mutation === 'number' ? { expectMutation: base } : { expectRevision: base }

export function createDocStore({ api, path, schedule, isVisible = () => true, now = () => Date.now() }) {
  let state = {
    phase: 'loading',
    error: null,
    text: '',
    mtime: null,
    items: [],
    ranges: new Map(),
    waiting: false,
    gone: false,
    refreshedAt: 0,
    itemsVersion: null
  }
  const listeners = new Set()
  // Earlier versions of the document, newest first: an anchor taken in one of
  // them can be carried through the edit even among identical copies (XR-05).
  // Kept PREPARED (Anchor.prepare): each version's line index, fingerprint and
  // alignment are computed once, not once per item per pass (XR2-02).
  const PRIOR_VERSIONS = 4
  let prior = []
  let current = null // the prepared version of state.text
  const preparedOf = (text) => {
    if (current?.doc !== text) current = Anchor.prepare(text)
    return current
  }
  const remember = (prepared) => {
    if (!prepared || prior[0] === prepared) return
    prior = [prepared, ...prior.filter((p) => p !== prepared && p.sig !== prepared.sig)].slice(0, PRIOR_VERSIONS)
  }
  let holds = 0
  let stopPoll = null
  let polling = false
  let disposed = false

  const set = (patch) => {
    state = { ...state, ...patch }
    for (const fn of [...listeners]) fn(state)
  }

  const syncLocations = (results) => {
    if (results.length && !state.gone) api.applyLocations(path, results).catch(() => {})
  }

  const placeItems = (text, items) => {
    const { ranges, results } = relocate(preparedOf(text), items, prior)
    syncLocations(results)
    // reflect what we just told the backend, without waiting for the round trip
    const lost = new Set(results.filter((r) => r.lost).map((r) => r.id))
    const fresh = new Map(results.filter((r) => r.anchor).map((r) => [r.id, r.anchor]))
    const shown = items.map((it) =>
      lost.has(it.id) ? { ...it, lost: true } : fresh.has(it.id) ? { ...it, lost: false, anchor: fresh.get(it.id) } : it
    )
    return { ranges, items: shown }
  }

  async function loadFile() {
    const f = await api.readFile(path)
    return { text: f.text, mtime: f.mtime }
  }

  async function loadItems() {
    const r = await api.listItems(path)
    return { items: r.items ?? [], itemsVersion: r.itemsVersion ?? null }
  }

  // Every file read takes a ticket; only the newest read may be shown (XR-06).
  // List reads too (fix-r5 audit): a late older list never replaces a newer one.
  let fileTicket = 0
  let itemsTicket = 0

  /** Show a file version: the previous one is remembered so anchors can be carried over. */
  const showFile = (file, items) => {
    if (state.phase === 'ready' && state.text !== file.text) remember(preparedOf(state.text))
    return { text: file.text, mtime: file.mtime, ...placeItems(file.text, items) }
  }

  async function load() {
    const ticket = ++fileTicket
    ++itemsTicket
    try {
      const [file, list] = await Promise.all([loadFile(), loadItems()])
      if (disposed || ticket !== fileTicket) return
      set({
        phase: 'ready',
        error: null,
        gone: false,
        waiting: false,
        refreshedAt: now(),
        itemsVersion: list.itemsVersion,
        ...showFile(file, list.items)
      })
    } catch (err) {
      if (disposed || ticket !== fileTicket) return
      const code = errorCode(err)
      let items = state.items
      try {
        items = (await loadItems()).items
      } catch {}
      set({ phase: 'error', error: code, gone: code === 'not-found', items, ranges: new Map() })
    }
  }

  /**
   * Read the file and show it — unless someone is writing a comment (hold) by
   * the time the read RETURNS: then it only raises `waiting`, and release()
   * reads again. `force` is the user's explicit "refresh now".
   */
  async function applyFile({ force = false } = {}) {
    const ticket = ++fileTicket
    try {
      const file = await loadFile()
      if (disposed || ticket !== fileTicket) return
      if (holds > 0 && !force) {
        if (file.mtime !== state.mtime || file.text !== state.text) {
          if (!state.waiting) set({ waiting: true })
        }
        return
      }
      set({ waiting: false, gone: false, phase: 'ready', error: null, refreshedAt: now(), ...showFile(file, state.items) })
    } catch (err) {
      if (!disposed && ticket === fileTicket) set({ waiting: false, gone: errorCode(err) === 'not-found' })
    }
  }

  async function reloadItems() {
    const ticket = ++itemsTicket
    try {
      const list = await loadItems()
      if (disposed || ticket !== itemsTicket) return
      if (state.phase === 'ready') set({ itemsVersion: list.itemsVersion, ...placeItems(state.text, list.items) })
      else set({ itemsVersion: list.itemsVersion, items: list.items })
    } catch {}
  }

  async function poll() {
    if (polling || disposed || !isVisible()) return
    polling = true
    try {
      const s = await api.reviewState(path)
      if (disposed) return
      if (!s.exists) {
        if (!state.gone) set({ gone: true })
      } else if (state.phase === 'error' && state.gone) {
        await load()
      } else if (state.phase === 'ready' && s.mtime !== state.mtime) {
        if (holds > 0) {
          if (!state.waiting) set({ waiting: true })
        } else await applyFile()
      } else if (state.gone) set({ gone: false })
      if (s.itemsVersion !== state.itemsVersion) await reloadItems()
    } catch {
      // transient; the next tick retries
    } finally {
      polling = false
    }
  }

  const mutate = async (fn) => {
    try {
      const item = await fn()
      await reloadItems()
      return { ok: true, item }
    } catch (err) {
      await reloadItems()
      return { ok: false, code: errorCode(err) }
    }
  }

  const anchorFor = (range) => Anchor.makeAnchor(preparedOf(state.text), range.start, range.end)

  return {
    path,
    get: () => state,
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    load,
    start() {
      if (stopPoll || disposed) return
      load()
      stopPoll = schedule(() => void poll(), POLL_MS)
    },
    stop() {
      disposed = true
      stopPoll?.()
      stopPoll = null
      listeners.clear()
    },
    poll,
    hold() {
      holds++
      let released = false
      return () => {
        if (released) return
        released = true
        holds = Math.max(0, holds - 1)
        if (holds === 0 && state.waiting) void applyFile()
      }
    },
    holding: () => holds > 0,
    refreshNow: () => applyFile({ force: true }),
    reloadItems,
    // the anchor an add() of this range would store (V3-D3: a draft finds the
    // annotation already on its words — same original at the same line — itself)
    anchorFor,
    locate(anchor) {
      if (state.phase !== 'ready' || !anchor?.text) return null
      const r = Anchor.locate(preparedOf(state.text), anchor, { prior })
      return r && !r.changed && Number.isInteger(r.start) ? { start: r.start, end: r.end } : null
    },
    add: (range, comment = '') => mutate(() => api.addItem(path, anchorFor(range), comment)),
    // Every edit names the version it was made against; the backend answers
    // 'stale' (409) instead of letting the last writer win (XR-04). The token is
    // `mutation`, which EVERY user operation moves — resolve and reopen too —
    // so an editor opened before another window resolved the item conflicts
    // instead of silently reopening it (XR2-01). `revision` stays the content
    // version the Diple plugin carries in origin.revision.
    replace: (item, range) => mutate(() => api.updateItem(item.id, { op: 'replace', anchor: anchorFor(range), ...expect(item) })),
    setComment: (item, comment, { base = versionOf(item) } = {}) =>
      mutate(() => api.updateItem(item.id, { op: 'comment', comment, ...expect(item, base) })),
    resolve: (item) => mutate(() => api.updateItem(item.id, { op: 'resolve', ...expect(item) })),
    reopen: (item) => mutate(() => api.updateItem(item.id, { op: 'reopen', ...expect(item) })),
    async remove(item) {
      const r = await mutate(() => api.deleteItem(item.id))
      return { ...r, undo: () => mutate(() => api.restoreItem(item)) }
    },
    // V3-D2 bulk: one transaction each; an item edited elsewhere since the list was
    // read makes the whole call 'stale' (nothing happens)
    async removeMany(items) {
      const expected = tokens(items)
      let gone = []
      const r = await mutate(async () => {
        gone = (await api.bulkDelete(path, items.map((it) => it.id), expected)).deleted ?? []
      })
      return { ...r, count: gone.length, undo: () => mutate(() => api.bulkRestore(gone)) }
    },
    resolveMany: (items) =>
      mutate(() => api.bulkResolve(path, items.map((it) => it.id), tokens(items)))
  }
}
