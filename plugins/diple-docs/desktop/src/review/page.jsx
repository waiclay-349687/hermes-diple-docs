// The review page: a main-workspace tab with the document on the left and
// its review list (标注清单) on the right. Read-only (requirement 03-#13).
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

import * as highlights from './highlights.js'
import { noticeFor } from './handoff.js'
import { prefersReducedMotion, scrollPlan } from './locate.js'
import { markOf } from './marks.js'
import { versionOf } from './doc-store.js'
import { createLocks, draftSlot, moveDraft, newDraft, sameDraft, slotCovered, ticket, typedOn } from './draft-session.js'
import { ResizeHandle } from '@diple/desktop-kit'

import { PANEL, fitList, listMode } from './list-panel.js'
import { arrange, canSend, docOrder, isQueued, isUnhandled, lineRange, pendingForSend, stepUnhandled } from './model.js'
import { hitTest, paint, pickRange } from './pick.js'
import { Button, Icon, Markdown, Segmented, Spinner, Tip, cx } from './ui.jsx'
import { ReviewList } from './list.jsx'
import { ListToggle, NavButtons, PanelSwitch, StatusRail } from './rail.jsx'
import { UNDO_MS } from './bulk.js'
import { FloatEditor } from './float-editor.jsx'

let pageSeq = 0
const raf = (fn) => (globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 16)))(fn)
const caf = (id) => (globalThis.cancelAnimationFrame ?? clearTimeout)(id)
// the editor of a draft (V3-D3 #2): 标注 before 保存 — not an item, not stored
const DRAFT = '__draft'

export function basename(p) {
  const s = String(p ?? '').replace(/[\\/]+$/, '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i >= 0 ? s.slice(i + 1) : s
}

export function dirname(p) {
  const s = String(p ?? '')
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'))
  return i > 0 ? s.slice(0, i) : ''
}

function useAgo(ms, t) {
  const [, force] = useState(0)
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 10_000)
    return () => clearInterval(id)
  }, [])
  if (!ms) return ''
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 10) return t('review.time.now')
  if (s < 60) return t('review.time.seconds', s)
  return t('review.time.minutes', Math.round(s / 60))
}

function SourceView({ text, flagged }) {
  const lines = useMemo(() => {
    const out = []
    let start = 0
    for (const line of text.split('\n')) {
      out.push({ start, line: line.replace(/\r$/, '') })
      start += line.length + 1
    }
    return out
  }, [text])
  return (
    <div className="er-source">
      {lines.map((l, i) => (
        <div key={i} className={cx('er-line', flagged.has(i + 1) && 'is-flagged')} data-line-start={l.start}>
          {l.line}
        </div>
      ))}
    </div>
  )
}

export function ReviewPage({ rt, path }) {
  const t = rt.i18n.useT()
  const store = useMemo(() => rt.docs.open(path), [rt, path])
  useEffect(() => () => rt.docs.close(path, store), [rt, path, store])
  const state = useSyncExternalStore(store.subscribe, store.get)
  const peer = useSyncExternalStore(rt.handoff.subscribe, rt.handoff.peer)
  const sessionId = useSyncExternalStore(rt.session.subscribe, rt.session.get)
  const [view, setView] = useState(() => rt.prefs.view())
  const [active, setActive] = useState(null)
  const [editing, setEditing] = useState(null) // the card's own editor: 原文已变 items only
  // the editor under the passage (V3-D2 #3): { id, isNew, fallback, scrollTo }
  const [floating, setFloating] = useState(null)
  const flushRef = useRef(null) // the open comment editor's save, for a send
  const registerFlush = useCallback((fn) => {
    flushRef.current = fn
    return () => {
      if (flushRef.current === fn) flushRef.current = null
    }
  }, [])
  const [replaceTarget, setReplaceTarget] = useState(null)
  // V3-D3 #2: select → 标注 opens a draft — nothing stored, not in the list or on
  // the rail — until 保存. R11: it keeps its anchor and the text it was taken in,
  // so a refresh relocates it (XR11-02), and a written one is cached per file
  // until 保存 / 放弃 (XR11-05). R11-H: a draft is a SESSION with an identity, and
  // every async operation on it answers to the ticket it took (draft-session.js).
  //   { draftId, anchorVersion, textVersion, words, range|null, anchor, doc, text, line,
  //     fallback, lost, restored, collision }
  //   lost       the words are gone or ambiguous after a refresh: 保存 waits for 重新选取原文
  //   collision  { id, comment, base, intent }: the passage was saved elsewhere with other words (XR11-04)
  const [draft, setDraftState] = useState(null)
  // the ref is the truth: between a set and the next render (a guard then a switch in one
  // click), and for the words — a keystroke moves words / textVersion here only, so typing
  // re-renders nothing of the page (always spread draftRef.current, never the state)
  const draftRef = useRef(null)
  const setDraft = (d) => {
    draftRef.current = d
    setDraftState(d)
  }
  useEffect(() => () => { draftRef.current = null }, [])
  const draftDom = useRef(null)
  const [shake, setShake] = useState(0)
  const cache = useMemo(() => rt.drafts(path), [rt, path])
  // the restore bar: cached slots whose words are gone (the first one shows)
  const [restoreQueue, setRestoreQueue] = useState([])
  const restore = restoreQueue[0] ?? null
  // one operation per draft at a time (XR11b-06): taken synchronously, released in finally
  const locks = useRef(null)
  locks.current ??= createLocks()
  const [lockedIds, setLockedIds] = useState(() => new Set())
  const lockDraft = (id) => {
    if (!locks.current.take(id)) return false
    setLockedIds((s) => new Set(s).add(id))
    return true
  }
  const unlockDraft = (id) => {
    locks.current.release(id)
    setLockedIds((s) => {
      const n = new Set(s)
      n.delete(id)
      return n
    })
  }
  const [pickAt, setPickAt] = useState(null)
  const [busy, setBusy] = useState(false)
  // R9 XV9-02: one send intent → at most one hand-off. Taken synchronously at
  // the click, before the first await (the comment save), held across the
  // save, the hand-off and its receipt, released in finally.
  const sending = useRef(false)
  const docRef = useRef(null)
  const wrapRef = useRef(null)
  const domRanges = useRef(new Map())
  const keyRef = useRef(`page-${++pageSeq}`)
  const ago = useAgo(state.refreshedAt, t)

  // --- the list's layout (V3-D #1): open / rail / sheet --------------------------------
  // V3-D2: comments are written under the passage, so the list no longer opens
  // for them (the V3-D temporary expand is gone).
  const panel = useSyncExternalStore(rt.listPanel.subscribe, rt.listPanel.get)
  // The page width matters only near the thresholds: `room` stays PANEL.MAX on
  // a wide page, so resizing a wide window re-renders nothing (V3-D2-I).
  const [room, setRoom] = useState(PANEL.MAX)
  const fit = fitList(room + PANEL.DOC_MIN, panel.width)
  const narrow = room < PANEL.MIN
  const { mode, sheet } = listMode({ narrow, collapsed: panel.collapsed, sheetOpen: panel.sheetOpen })
  const modeRef = useRef(mode)
  modeRef.current = mode
  const pageRef = useRef(null)
  const bodyRef = useRef(null)
  const [ticks, setTicks] = useState(() => new Map())
  const measures = useRef(0)
  const [, setMeasured] = useState(0)

  // Tick places: each annotation's top as a share of the document's height.
  // Read only here — after a paint, a content change or a resize, and only
  // while the rail shows — never on scroll (the V2.1 pin perf rule).
  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap || modeRef.current !== 'rail') return
    const box = wrap.getBoundingClientRect()
    const height = Math.max(1, wrap.scrollHeight)
    const lines = Math.max(1, state.text.split('\n').length)
    const next = new Map()
    for (const it of state.items) {
      const r = domRanges.current.get(it.id)
      const rect = r?.getBoundingClientRect?.()
      const pct = rect ? ((rect.top - box.top + wrap.scrollTop) / height) * 100 : ((it.anchor.line - 1) / lines) * 100
      next.set(it.id, Math.round(Math.max(0, Math.min(100, pct)) * 10) / 10)
    }
    measures.current++
    setMeasured(measures.current)
    setTicks((prev) => (prev.size === next.size && [...next].every(([k, v]) => prev.get(k) === v) ? prev : next))
  }, [state])
  const measureRef = useRef(measure)
  measureRef.current = measure

  useEffect(() => {
    const page = pageRef.current
    const wrap = wrapRef.current
    if (typeof ResizeObserver !== 'function' || !page) return
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        if (e.target === page) {
          const width = e.contentRect?.width ?? 0
          if (width > 0) setRoom(Math.max(PANEL.MIN - 1, Math.min(PANEL.MAX, Math.floor(width) - PANEL.DOC_MIN)))
        } else measureRef.current()
      }
    })
    ro.observe(page)
    if (wrap) ro.observe(wrap)
    if (docRef.current) ro.observe(docRef.current)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    rt.handoff.resume()
  }, [rt])

  // --- the draft's life (R11) ---------------------------------------------------------------
  // the draft holds file changes for as long as it lives — also while 重新选取原文 has
  // its editor unmounted (XR11-02); only 刷新 applies one, and the draft follows its words
  const hasDraft = draft != null
  useEffect(() => (hasDraft ? store.hold() : undefined), [hasDraft, store])
  useEffect(() => {
    const d = draftRef.current
    if (!d || state.phase !== 'ready' || d.doc === state.text) return
    const r = store.locate(d.anchor)
    if (r) setDraft(moveDraft(d, { range: r, doc: state.text, anchor: store.anchorFor(r) }))
    else setDraft(moveDraft(d, { range: null, doc: state.text, lost: true }))
  }, [state.text, state.phase, store])
  // a written draft is cached in its own slot until 保存 / 放弃 (XR11-05); an empty one is not
  useEffect(() => {
    const d = draftRef.current
    if (d && d.words.trim()) cache.write(draftSlot(d))
  }, [draft, cache])
  const typeDraft = (words) => {
    const d = draftRef.current
    if (!d) return
    draftRef.current = { ...d, words, textVersion: d.textVersion + 1 }
    cache.write(draftSlot(draftRef.current))
  }
  // reopened: the newest cached draft comes back where its words are; a pending edit of a
  // saved one (XR11b-04) on that item; the rest whose words are gone queue on the restore bar
  const restoreChecked = useRef(false)
  useEffect(() => {
    if (state.phase !== 'ready' || restoreChecked.current) return
    restoreChecked.current = true
    const bar = []
    let opened = false
    for (const s of cache.list()) {
      if (s.kind === 'pending-edit') {
        const it = state.items.find((x) => x.id === s.itemId)
        if (!it) {
          bar.push({ ...s, words: s.text, anchor: s.anchor ?? null })
          continue
        }
        if (opened || draftRef.current) continue // its slot stays for the next open
        opened = true
        setActive(it.id)
        setFloating({ id: it.id, isNew: false, initial: s.text, base: s.baseMutation, pending: s.draftId, restored: true })
        continue
      }
      const r = opened || draftRef.current ? null : store.locate(s.anchor)
      if (!r) {
        bar.push({ ...s, words: s.words })
        continue
      }
      opened = true
      const anchor = store.anchorFor(r)
      setDraft({ ...newDraft({ draftId: s.draftId, range: r, anchor, doc: state.text, words: s.words, restored: true }), anchorVersion: (s.anchorVersion ?? 0) + 1, textVersion: s.textVersion ?? 0 })
      setFloating({ id: DRAFT, isNew: true })
    }
    setRestoreQueue(bar)
  }, [state.phase, state.text, state.items, cache, store])

  // --- highlight paint (re-run when the host's Markdown finishes rendering) ---------------
  const repaint = useCallback(() => {
    const root = docRef.current
    if (!root || state.phase !== 'ready') {
      highlights.clear(keyRef.current)
      domRanges.current = new Map()
      return
    }
    // located annotations at their words; 原文已变 ones at the line they used to be on,
    // carrying only the overlay (that line is not the annotated passage any more)
    const ranges = new Map(state.ranges)
    // the draft's underlay only with its editor open (never a hidden draft, XR11-01)
    if (draft?.range && !draft.lost && draft.doc === state.text && floating?.id === DRAFT) ranges.set(DRAFT, draft.range)
    for (const it of state.items) {
      if (!it.lost || ranges.has(it.id)) continue
      const old = lineRange(state.text, it.anchor?.line)
      if (old) ranges.set(it.id, old)
    }
    domRanges.current = paint({ root, view, text: state.text, ranges })
    draftDom.current = domRanges.current.get(DRAFT) ?? null
    domRanges.current.delete(DRAFT)
    const byId = new Map(state.items.map((it) => [it.id, it]))
    const entries = []
    for (const [id, range] of domRanges.current) {
      const it = byId.get(id)
      if (!it) continue
      const mark = markOf(it)
      entries.push({ range, mark: it.lost ? { base: null, changed: true } : mark, active: id === active })
    }
    if (draftDom.current) entries.push({ range: draftDom.current, mark: null, draft: true })
    highlights.setRanges(keyRef.current, entries)
    root.setAttribute('data-er-painted', String(domRanges.current.size))
  }, [state, view, active, draft, floating])

  // the rail's ticks follow the painted ranges: a new paint of the content (not
  // a new current item) or the rail appearing measures them again
  const paintKey = `${mode}|${view}`
  useLayoutEffect(() => {
    measure()
  }, [measure, paintKey])

  useLayoutEffect(() => {
    repaint()
  }, [repaint])

  useEffect(() => {
    const root = docRef.current
    if (!root || typeof MutationObserver !== 'function') return
    let timer = null
    const mo = new MutationObserver(() => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        repaint()
        measureRef.current()
      }, 60)
    })
    mo.observe(root, { childList: true, subtree: true, characterData: true })
    return () => {
      clearTimeout(timer)
      mo.disconnect()
    }
  }, [repaint])

  useEffect(
    () => () => {
      highlights.clear(keyRef.current)
    },
    []
  )

  // --- selection → floating "Diple" button -----------------------------------------
  useEffect(() => {
    let pointerDown = false
    let timer = null
    const update = () => {
      const root = docRef.current
      const wrap = wrapRef.current
      const sel = document.getSelection()
      if (!root || !wrap || pointerDown || !sel || sel.isCollapsed || sel.rangeCount === 0) return setPickAt(null)
      const r = sel.getRangeAt(0)
      if (!root.contains(r.startContainer) || !root.contains(r.endContainer)) return setPickAt(null)
      const rects = r.getClientRects?.() ?? []
      const last = rects.length ? rects[rects.length - 1] : r.getBoundingClientRect?.()
      const box = wrap.getBoundingClientRect()
      if (!last) return setPickAt(null)
      setPickAt({
        top: Math.max(0, last.bottom - box.top + wrap.scrollTop + 6),
        left: Math.max(8, Math.min(last.right - box.left + wrap.scrollLeft - 40, wrap.clientWidth - 120))
      })
    }
    const onSel = () => {
      clearTimeout(timer)
      timer = setTimeout(update, 120)
    }
    const onDown = (e) => {
      if (e.target?.closest?.('.er-pickbtn')) return
      pointerDown = true
      setPickAt(null)
    }
    const onUp = () => {
      pointerDown = false
      onSel()
    }
    document.addEventListener('selectionchange', onSel)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('pointerup', onUp, true)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSel)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
    }
  }, [])

  // --- actions -------------------------------------------------------------------------
  const itemError = (code) =>
    rt.notify({ kind: 'warning', durationMs: 6000, message: t(`review.itemError.${code}`) === `review.itemError.${code}` ? t('review.itemError.network') : t(`review.itemError.${code}`) })

  const annotateSelection = useCallback(async () => {
    const sel = document.getSelection()
    const root = docRef.current
    if (!root || state.phase !== 'ready') return false
    const picked = pickRange({ selection: sel, root, view, text: state.text })
    if (!picked.ok) {
      rt.notify({ kind: 'info', durationMs: 5000, message: t(`review.pick.${picked.reason}`) })
      return true
    }
    // where the words are now: the editor's place until the new mark is painted
    const selRect = sel?.rangeCount ? sel.getRangeAt(0).getBoundingClientRect?.() : null
    const fallback = selRect ? { top: selRect.top, bottom: selRect.bottom, left: selRect.left, right: selRect.right } : null
    // a draft with words is not dropped by a new 标注: it shakes and stays (the one guard)
    if (replaceTarget !== DRAFT && !holdDraft()) return true
    const open = draftRef.current
    setPickAt(null)
    const anchor = store.anchorFor(picked.range)
    // 重新选取原文 on a draft: only the draft moves (nothing stored); the same draft, a new
    // anchor version (an answer to a ticket taken before is not this draft's any more)
    if (replaceTarget === DRAFT && open) {
      if (locks.current.has(open.draftId)) return true // saving: no re-pick (XR11b-02)
      sel?.removeAllRanges()
      setReplaceTarget(null)
      setDraft(moveDraft(open, { range: picked.range, anchor, doc: state.text, fallback }))
      setFloating({ id: DRAFT, isNew: true, fallback })
      return true
    }
    const target = replaceTarget && state.items.find((it) => it.id === replaceTarget)
    if (target) {
      const res = await store.replace(target, picked.range)
      if (!res.ok) {
        itemError(res.code)
        return true
      }
      sel?.removeAllRanges()
      setReplaceTarget(null)
      setActive(res.item.id)
      return true
    }
    // an editor of a stored annotation still open: its words go in first
    if (floating && floating.id !== DRAFT && flushRef.current && !(await flushRef.current())) return true
    sel?.removeAllRanges()
    // already annotated (the same original at the same line): open that one
    const dup = state.items.find((it) => it.text === anchor.text && it.anchor?.line === anchor.line)
    if (dup) {
      setFloating(null)
      editItem(dup.id)
      return true
    }
    setDraft(newDraft({ range: picked.range, anchor, doc: state.text, fallback }))
    setFloating({ id: DRAFT, isNew: true, fallback })
    return true
  }, [state, view, replaceTarget, store, rt, t, floating])

  // the one way out of a draft that is not 保存: nothing left — underlay, editor, banner,
  // and ITS cache slot (no other: the restore bar's stays, XR11b-05)
  const finishDraft = (d = draftRef.current) => {
    if (!d || draftRef.current?.draftId !== d.draftId) return
    setDraft(null)
    cache.clearIf(d.draftId, slotCovered(ticket(d, 'discard')))
    setFloating((f) => (f?.id === DRAFT ? null : f))
    setReplaceTarget((r) => (r === DRAFT ? null : r))
  }
  const dropDraft = useCallback(() => {
    finishDraft()
    docRef.current?.focus({ preventScroll: true })
  }, [cache])

  // XR11-01: EVERY entry that switches what is being edited — a card, 编辑意见, a double
  // click, Enter, 重选, a rail tick, 上一条 / 下一条, a mark in the document, 标注, the
  // restore bar's 重新选取原文 — asks here first. A written draft (or one being saved)
  // holds: the switch does not happen, its editor is (back) on screen and shakes. An
  // empty one is dropped and the switch goes on.
  // → true: go on
  const holdDraft = () => {
    const d = draftRef.current
    if (!d) return true
    if (!d.words.trim() && !d.collision && !locks.current.has(d.draftId)) {
      finishDraft(d)
      return true
    }
    setReplaceTarget((r) => (r === DRAFT ? null : r))
    setFloating((f) => (f?.id === DRAFT ? f : { id: DRAFT, isNew: true, fallback: d.fallback }))
    setShake((n) => n + 1)
    return false
  }
  // the guard's invariant, whatever path got here: a draft is never hidden while it
  // is not being re-picked (no underlay without its editor)
  useEffect(() => {
    if (draft && floating?.id !== DRAFT && replaceTarget !== DRAFT) setFloating({ id: DRAFT, isNew: true, fallback: draft.fallback })
  }, [draft, floating, replaceTarget])

  // An answer to ticket tk came back with the stored item. Only for the same draft at the
  // same anchor does anything happen beyond the item landing in the list (store.add /
  // setComment reload it): typed on meanwhile → the editor becomes that item's, the new
  // words an unsaved edit kept in the slot as 'pending-edit' (XR11b-04); otherwise the
  // draft closes, its slot is cleared if no newer, and intent 'send' sends THIS item.
  const landDraft = (tk, item) => {
    const d = draftRef.current
    if (!sameDraft(d, tk)) return { ok: true, id: item.id, stale: true }
    setDraft(null)
    setActive(item.id)
    if (typedOn(d, tk)) {
      cache.write({ kind: 'pending-edit', draftId: d.draftId, itemId: item.id, baseMutation: versionOf(item), text: d.words, textVersion: d.textVersion, anchor: d.anchor })
      setFloating({ id: item.id, isNew: false, initial: d.words, base: versionOf(item), pending: d.draftId })
      if (tk.intent === 'send') void sendItems([item], { sessionId, sendNow: true }, 'send', { flush: false })
      return { ok: true, id: item.id }
    }
    cache.clearIf(d.draftId, slotCovered(tk))
    setFloating(null)
    docRef.current?.focus({ preventScroll: true }) // the keys stay with the document
    if (modeRef.current === 'open' || sheet === 'open') rt.focusCard(keyRef.current, item.id, { focus: false })
    if (tk.intent === 'send') void sendItems([item], { sessionId, sendNow: true }, 'send', { flush: false })
    return { ok: true, id: item.id }
  }

  // 保存 / 保存并发送 / ⏎ on a draft: now it is stored (empty → 划线) — one write, under the
  // draft's lock, judged by its ticket (XR11-03, XR11b-01/02).
  // → { ok, id?, stale?, busy? }
  const commitDraft = async (intent = 'save') => {
    const d = draftRef.current
    if (!d) return { ok: false }
    // gone after a refresh, or waiting for the user's choice: 保存 waits
    if (d.lost || !d.range || d.collision || d.doc !== store.get().text || store.anchorFor(d.range).text !== d.anchor.text) {
      setShake((n) => n + 1)
      return { ok: false }
    }
    if (!lockDraft(d.draftId)) return { ok: false, busy: true }
    const tk = ticket(d, intent)
    try {
      const res = await store.add(d.range, tk.words)
      if (!res.ok) {
        if (sameDraft(draftRef.current, tk)) itemError(res.code)
        return { ok: false }
      }
      const theirs = res.item.comment ?? ''
      if (res.item.duplicate && theirs !== tk.words) {
        // XR11-04: saved meanwhile elsewhere. My empty draft: theirs opens. Their 划线: my
        // words go on it (nothing of anyone's is lost). Other words: the user chooses.
        if (!sameDraft(draftRef.current, tk)) return { ok: true, id: res.item.id, stale: true }
        if (!tk.words.trim() && typedOn(draftRef.current, tk)) return landDraft(tk, res.item)
        if (!tk.words.trim()) {
          finishDraft(draftRef.current)
          editItem(res.item.id)
          rt.notify({ kind: 'info', durationMs: 5000, message: t('review.duplicate') })
          return { ok: true, id: res.item.id }
        }
        if (theirs.trim()) {
          setDraft({ ...draftRef.current, collision: { id: res.item.id, comment: theirs, base: versionOf(res.item), intent } })
          return { ok: false }
        }
        const r2 = await store.setComment(res.item, tk.words)
        if (!r2.ok) return sameDraft(draftRef.current, tk) && itemError(r2.code), { ok: false }
        return landDraft(tk, r2.item ?? res.item)
      }
      return landDraft(tk, res.item)
    } finally {
      unlockDraft(d.draftId)
    }
  }
  // the box of the draft shows `words` now, cursor at the end (a programmatic edit: the
  // text version moves, the slot follows). FloatEditor applies `rewrite` once.
  const rewriteDraft = (d, words) => {
    const next = { ...d, words, textVersion: d.textVersion + 1, rewrite: { words } }
    setDraft(next)
    cache.write(draftSlot(next))
    return next
  }
  // XR11-04: the user's choice on the conflict bar; nothing is written before it. Under
  // the same lock and ticket as 保存 (XR11b-03/06).
  // XR11c-01: what you see is what is written. At the click — before any request — the
  // box shows the full text the choice will write (合并: theirs + blank line + mine;
  // 用我的替换: mine; 保留已有: theirs, as the editor of that item). The ticket is taken
  // AFTER that, so its words are the full text sent: words typed on while it is in
  // flight are an edit of that text, and a pending edit is always baseline + typing.
  // Not written (409 / reject) and not typed on: the box is my draft again, the bar up.
  const resolveCollision = async (action) => {
    const d = draftRef.current
    const c = d?.collision
    if (!c || locks.current.has(d.draftId)) return
    if (action === 'keep') {
      if (!lockDraft(d.draftId)) return
      const tk = ticket(d, 'keep')
      try {
        if (sameDraft(draftRef.current, tk)) {
          finishDraft(d)
          editItem(c.id)
        }
      } finally {
        unlockDraft(d.draftId)
      }
      return
    }
    const it = store.get().items.find((x) => x.id === c.id)
    if (!it) return setDraft({ ...d, collision: null }) // deleted meanwhile: 保存 makes it anew
    if (!lockDraft(d.draftId)) return
    const mine = d.words
    const shown = rewriteDraft(d, action === 'merge' ? `${c.comment}\n\n${mine}` : mine)
    const tk = ticket(shown, c.intent ?? 'save')
    try {
      const r = await store.setComment(it, tk.words, { base: c.base })
      const now = draftRef.current
      if (!r.ok) {
        if (!sameDraft(now, tk)) return
        const fresh = r.code === 'stale' ? store.get().items.find((x) => x.id === c.id) : null
        const collision = fresh ? { ...c, comment: fresh.comment ?? '', base: versionOf(fresh) } : c
        // typed on: those words stay in the box; else the box is my draft again
        if (typedOn(now, tk)) setDraft({ ...now, collision })
        else rewriteDraft({ ...now, collision }, mine)
        if (r.code !== 'stale') itemError(r.code)
        return
      }
      if (!sameDraft(now, tk)) return
      // the bar is gone either way; typed on meanwhile → those words are the item's unsaved edit
      draftRef.current = { ...now, collision: null }
      landDraft(tk, r.item ?? it)
    } finally {
      unlockDraft(d.draftId)
    }
  }
  // the restore bar (XR11-05): a cached slot whose words are gone. Each action is about
  // THAT slot only (XR11b-05).
  const restoreAction = async (action) => {
    const c = restore
    if (!c || !lockDraft(c.draftId)) return
    const tk = ticket({ ...c, words: c.words, anchorVersion: c.anchorVersion ?? 0, textVersion: c.textVersion ?? 0 }, action)
    const ownsSlot = (s) => s.draftId === tk.draftId && (s.anchorVersion ?? 0) === tk.anchorVersion && (s.textVersion ?? 0) === tk.textVersion && (s.words ?? s.text) === tk.words
    try {
      if (action === 'copy') {
        await globalThis.navigator?.clipboard?.writeText?.(tk.words)
        const s = cache.get(tk.draftId)
        if (s && ownsSlot(s)) rt.notify({ kind: 'success', durationMs: 3000, message: t('review.restore.copied') })
        return
      }
      if (action === 'discard') {
        cache.clearIf(tk.draftId, ownsSlot)
        setRestoreQueue((q) => q.filter((s) => s.draftId !== tk.draftId))
        return
      }
      // A written active draft holds: no overwrite from the restore bar.
      if (!holdDraft()) return
      const slot = cache.get(tk.draftId)
      if (!slot || !ownsSlot(slot)) return
      setRestoreQueue((q) => q.filter((s) => s.draftId !== tk.draftId))
      const anchor = c.anchor?.text ? c.anchor : { text: tk.words, line: 1 }
      setDraft({ ...newDraft({ draftId: tk.draftId, range: null, anchor, doc: state.text, words: tk.words, lost: true }), anchorVersion: tk.anchorVersion + 1, textVersion: tk.textVersion })
      setReplaceTarget(DRAFT)
      docRef.current?.focus({ preventScroll: true })
    } catch {
      // Clipboard failure is local; never drop the slot.
    } finally {
      unlockDraft(tk.draftId)
    }
  }

  useEffect(() => {
    const page = {
      owns: (sel) => {
        const root = docRef.current
        if (!root || !sel || sel.rangeCount === 0 || sel.isCollapsed) return false
        const r = sel.getRangeAt(0)
        return root.contains(r.startContainer) && root.contains(r.endContainer)
      },
      annotate: () => annotateSelection(),
      visible: () => {
        const el = pageRef.current
        return Boolean(el?.isConnected) && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : true)
      },
      toggleList: () => panelRef.current.toggle(),
      nav: (dir) => panelRef.current.nav(dir)
    }
    return rt.pages.add(page)
  }, [rt, annotateSelection])

  // target: { sessionId, sendNow } — what the send menu picked (V2.1 #8, core
  // SendRequest): send now into a session, or 加入待发 (the focused session's
  // list, not sent). A target picked in the menu is not asked again.
  // mode: 'send' | 'anyway' (replay the unconfirmed hand-off, XR-03) | 'new' (a fresh hand-off,
  // only after the user confirmed twice that the old one has no result)
  const sendItems = async (picked, target, mode = 'send', { flush: shouldFlush = true } = {}) => {
    if (busy || sending.current) return
    sending.current = true
    setBusy(true)
    let res
    let items
    try {
      // A comment still being typed goes in first, and the send carries the
      // saved version (V2-X: the R8 XV-02 class). Not saved → nothing is sent.
      const flush = flushRef.current
      if (shouldFlush && flush && !(await flush())) return
      const now = store.get().items
      items = picked.map((it) => now.find((x) => x.id === it.id) ?? it)
      const to = target?.sessionId ?? sessionId
      // another session than the one the chat shows: Diple switches to it first, so its
      // receipt is later — the hand-off waits longer before saying "no receipt" (R11-G)
      const opts = { sessionId: to, sendNow: Boolean(target?.sendNow), switching: Boolean(to && to !== sessionId) }
      res = mode === 'anyway' ? await rt.handoff.sendAnyway(items, opts) : await rt.handoff.send(items, { ...opts, force: mode === 'new' })
    } finally {
      sending.current = false
      setBusy(false)
    }
    if (res.ok) store.reloadItems()
    const note = noticeFor(t, res)
    if (!res.ok && res.reason === 'unconfirmed')
      note.action = { label: t('review.handoff.sendAnyway'), onClick: () => void sendItems(items, target, 'anyway') }
    if (!res.ok && res.reason === 'replay-missing')
      note.action = { label: t('review.handoff.resendNew'), onClick: () => void sendItems(items, target, 'new') }
    rt.notify(note)
  }

  const bulkError = (code) => (code === 'stale' ? rt.notify({ kind: 'warning', durationMs: 6000, message: t('review.bulk.stale') }) : itemError(code))
  // V3-D2 #2: clears ask nothing; a toast offers 撤销 for UNDO_MS
  const clearItems = async (list) => {
    if (!list.length) return
    const res = await store.removeMany(list)
    if (!res.ok) return bulkError(res.code)
    const ids = new Set(list.map((it) => it.id))
    if (ids.has(active)) setActive(null)
    if (ids.has(floating?.id)) setFloating(null)
    if (ids.has(editing)) setEditing(null)
    rt.notify({
      kind: 'info',
      durationMs: UNDO_MS,
      message: t('review.bulk.cleared', res.count),
      action: { label: t('review.undo'), onClick: () => void res.undo().then((r) => !r.ok && itemError(r.code)) }
    })
  }
  const resolveAll = async (list) => {
    if (!list.length) return
    const res = await store.resolveMany(list)
    if (!res.ok) return bulkError(res.code)
    rt.notify({ kind: 'success', durationMs: 4000, message: t('review.bulk.resolvedN', list.length) })
  }

  const remove = async (item) => {
    const res = await store.remove(item)
    if (!res.ok) return itemError(res.code)
    if (active === item.id) setActive(null)
    rt.notify({
      kind: 'info',
      durationMs: 6000,
      message: t('review.removed'),
      action: { label: t('review.undo'), onClick: () => void res.undo() }
    })
  }

  // From the list back to the words: no scroll when they are already in view,
  // otherwise one smooth scroll that centres them (a jump under reduced
  // motion). Nothing flashes on arrival (V2.1 #1): the deeper current-item
  // fill marks the place and stays while the card is active.
  const scrollToItem = (id) => {
    const r = domRanges.current.get(id)
    const wrap = wrapRef.current
    if (!r || !wrap) return
    const rect = r.getBoundingClientRect?.()
    if (!rect) return
    const plan = scrollPlan({ rect, box: wrap.getBoundingClientRect(), scrollTop: wrap.scrollTop, reduced: prefersReducedMotion() })
    if (plan) wrap.scrollTo?.(plan)
    return plan?.top ?? null
  }

  // 编辑意见 (card button, double click, Enter): under the words when they are in
  // the document; a 原文已变 item has none, so its card keeps its own editor.
  const editItem = (id) => {
    if (id == null) return setEditing(null)
    if (!holdDraft()) return
    if (!domRanges.current.has(id) || state.items.find((it) => it.id === id)?.lost) return setEditing(id)
    setEditing(null)
    setActive(id)
    const to = scrollToItem(id)
    setFloating({ id, isNew: false, scrollTo: to ?? undefined })
  }

  // 上一条 / 下一条未处理 (V3-D #3): document order, wrapping; the focus stays on
  // the button, the card comes into view, the words get the current-item fill.
  const unhandled = state.items.filter(isUnhandled).length
  const nav = (dir) => {
    const id = stepUnhandled(docOrder(state.items, state.ranges), active, dir)
    if (!id || !holdDraft()) return
    setActive(id)
    scrollToItem(id)
    if (modeRef.current === 'open' || sheet === 'open') rt.focusCard(keyRef.current, id, { focus: false })
  }
  // V3-D3 #3: a layout change of the list (toggle, rail, bar, the handle) keeps the
  // reader's place: the first block at the top of the pane stays where it was on
  // screen, however the document re-wraps under its new width. Read only at the
  // change (twice: this layout and the next frame), never on scroll.
  const placeRef = useRef(null)
  const keepPlace = () => {
    const wrap = wrapRef.current
    const root = docRef.current
    if (!wrap || !root) return
    const top = wrap.getBoundingClientRect().top
    for (const el of root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, tr, .er-line')) {
      const r = el.getBoundingClientRect()
      if (r.bottom > top + 1) {
        placeRef.current = { el, y: r.top - top }
        return
      }
    }
  }
  const restorePlace = useCallback(() => {
    const p = placeRef.current
    const wrap = wrapRef.current
    if (!p || !wrap || !p.el.isConnected) return
    const now = p.el.getBoundingClientRect().top - wrap.getBoundingClientRect().top
    if (Math.abs(now - p.y) > 1) wrap.scrollTop += now - p.y
  }, [])
  useLayoutEffect(() => {
    if (!placeRef.current) return
    restorePlace()
    const id = raf(() => {
      restorePlace()
      placeRef.current = null
    })
    return () => caf(id)
  }, [mode, sheet, fit.width, restorePlace])

  const toggleList = () => {
    keepPlace()
    const onToggle = document.activeElement?.closest?.('[data-er-list-toggle]')
    if (narrow) rt.listPanel.set({ sheetOpen: sheet !== 'open' })
    else rt.listPanel.set({ collapsed: mode === 'open' })
    // keep the keyboard on the toggle that replaces this one: there is one per
    // layout (R11-I) — the toolbar switch when wide, the sheet bar's when narrow
    if (onToggle) setTimeout(() => pageRef.current?.querySelector('[data-er-list-toggle]')?.focus({ preventScroll: true }), 0)
  }
  const panelRef = useRef(null)
  panelRef.current = { toggle: toggleList, nav }

  const onDocClick = (e) => {
    const sel = document.getSelection()
    if (sel && !sel.isCollapsed) return
    let node = null
    let offset = 0
    if (document.caretRangeFromPoint) {
      const c = document.caretRangeFromPoint(e.clientX, e.clientY)
      if (c) [node, offset] = [c.startContainer, c.startOffset]
    } else if (document.caretPositionFromPoint) {
      const c = document.caretPositionFromPoint(e.clientX, e.clientY)
      if (c) [node, offset] = [c.offsetNode, c.offset]
    }
    if (!node) return
    const id = hitTest(domRanges.current, node, offset)
    if (id && holdDraft()) {
      setActive(id)
      rt.focusCard(keyRef.current, id)
    }
  }

  // the 重新选取 banner's 取消 (and Esc): a draft comes back as it was
  const cancelReplace = () => {
    const wasDraft = replaceTarget === DRAFT
    setReplaceTarget(null)
    if (wasDraft && draftRef.current) setFloating({ id: DRAFT, isNew: true, fallback: draftRef.current.fallback })
  }

  const changeView = (v) => {
    setView(v)
    rt.prefs.setView(v)
    setPickAt(null)
  }

  // --- render ----------------------------------------------------------------------------
  const name = basename(path)
  const flaggedLines = useMemo(() => {
    const s = new Set()
    if (view === 'source') for (const it of state.items) if (state.ranges.has(it.id)) s.add(it.anchor.line)
    return s
  }, [view, state.items, state.ranges])
  const draftItem = draft ? { id: DRAFT, text: draft.text, comment: draftRef.current?.words ?? '', anchor: { line: draft.line } } : null
  const replaceItem = replaceTarget === DRAFT ? draftItem : replaceTarget && state.items.find((it) => it.id === replaceTarget)
  const floatItem = floating ? (floating.id === DRAFT ? draftItem : state.items.find((it) => it.id === floating.id)) : null
  const floatDraft = floatItem?.id === DRAFT
  const ordered = arrange(state.items, state.ranges, 'all')
  const replaceNo = replaceItem ? [...ordered.shown, ...ordered.resolved].indexOf(replaceItem) + 1 : 0
  const sendDisabled = peer === 'missing' || peer === 'disabled'
  const numbering = new Map([...ordered.shown, ...ordered.resolved].map((it, i) => [it.id, i + 1]))
  const resizer =
    mode === 'open' ? (
      <ResizeHandle
        width={fit.width}
        min={PANEL.MIN}
        max={fit.max}
        def={PANEL.DEF}
        collapseBelow={PANEL.COLLAPSE}
        label={t('review.resizeList')}
        attrs={{ 'data-er-resize': '' }}
        onLive={(px) => {
          if (!placeRef.current) keepPlace() // the place at the drag's start
          bodyRef.current?.style.setProperty('--er-list-w', `${px}px`)
          restorePlace()
        }}
        onCommit={(px) => {
          if (!placeRef.current) keepPlace()
          bodyRef.current?.style.setProperty('--er-list-w', `${px}px`)
          rt.listPanel.set({ width: px })
          // the same width again changes no layout: let the place go after the next frames
          raf(() => raf(() => {
            restorePlace()
            placeRef.current = null
          }))
        }}
        onCollapse={() => {
          keepPlace()
          rt.listPanel.set({ collapsed: true })
        }}
      />
    ) : null
  // the list head's nav (the toolbar has the switch; the sheet bar has its own nav)
  const panelTools = mode === 'open' ? <NavButtons t={t} canNav={unhandled > 0} onNav={nav} /> : null
  const list = (
      <ReviewList
        rt={rt}
        t={t}
        pageKey={keyRef.current}
        state={state}
        store={store}
        active={active}
        editing={editing}
        busy={busy}
        sendDisabled={sendDisabled}
        sessionId={sessionId}
        onActivate={(id) => {
          if (!holdDraft()) return
          setActive(id)
          scrollToItem(id)
        }}
        onEdit={editItem}
        onClear={clearItems}
        onResolveAll={resolveAll}
        onSend={sendItems}
        registerFlush={registerFlush}
        onRemove={remove}
        onReselect={(id) => {
          if (!holdDraft()) return
          setReplaceTarget(id)
          setActive(id)
          docRef.current?.focus({ preventScroll: true })
        }}
        canSend={canSend}
        isQueued={isQueued}
        pendingForSend={pendingForSend}
        itemError={itemError}
        path={path}
        resizer={resizer}
        panelTools={panelTools}
      />
  )

  let docBody
  if (state.phase === 'loading')
    docBody = (
      <div className="er-state" role="status">
        <Spinner />
        {t('review.loading')}
      </div>
    )
  else if (state.phase === 'error')
    docBody = (
      <div className="er-state" role="alert">
        <div className="er-state-title">{t(`review.error.${state.error}`) === `review.error.${state.error}` ? t('review.error.network') : t(`review.error.${state.error}`)}</div>
        <div className="er-head-tools">
          <Button onClick={() => store.load()}>{t('review.retry')}</Button>
          {state.error === 'not-found' ? (
            <Button variant="ghost" onClick={() => rt.forgetRecent(path)}>
              {t('review.forget')}
            </Button>
          ) : null}
        </div>
      </div>
    )
  else if (!state.text.trim()) docBody = <div className="er-state">{t('review.emptyDoc')}</div>
  else
    docBody =
      view === 'source' ? (
        <SourceView text={state.text} flagged={flaggedLines} />
      ) : (
        <Markdown text={state.text} />
      )

  return (
    <div className="er-page" data-diple-docs-page={path} ref={pageRef}>
      <div className="er-head">
        <div className="er-head-title">
          <span className="er-head-name" title={path}>
            {name}
          </span>
          <span className="er-head-dir" title={path}>
            {dirname(path)}
          </span>
        </div>
        <div className="er-head-tools">
          <Tip label={t('review.readOnlyHint')}>
            <span className="er-chip" tabIndex={0}>
              <Icon name="lock" />
              {t('review.readOnly')}
            </span>
          </Tip>
          {state.phase === 'ready' ? <span className="er-sync" aria-live="polite">{state.waiting ? '' : t('review.synced', ago)}</span> : null}
          <Segmented
            label={t('review.viewLabel')}
            value={view}
            onChange={changeView}
            options={[
              { id: 'rendered', label: t('review.viewRendered') },
              { id: 'source', label: t('review.viewSource') }
            ]}
          />
          <Tip label={t('review.refresh')}>
            <Button variant="ghost" size="icon-xs" aria-label={t('review.refresh')} onClick={() => store.refreshNow()}>
              <Icon name="refresh" />
            </Button>
          </Tip>
          {rt.canReveal ? (
            <Tip label={t('review.reveal')}>
              <Button variant="ghost" size="icon-xs" aria-label={t('review.reveal')} onClick={() => rt.reveal(path)}>
                <Icon name="folder-opened" />
              </Button>
            </Tip>
          ) : null}
          {/* V3-D2 #1: the list's one switch, where a reader looks for it (the narrow page has its bar instead) */}
          {mode !== 'sheet' ? <PanelSwitch t={t} open={mode === 'open'} unhandled={unhandled} onToggle={toggleList} /> : null}
        </div>
      </div>
      {state.waiting ? (
        <div className="er-banner is-info" role="status">
          <span>{t('review.waiting')}</span>
          <Button size="xs" onClick={() => store.refreshNow()}>
            {t('review.refreshNow')}
          </Button>
        </div>
      ) : null}
      {state.gone && state.phase === 'ready' ? (
        <div className="er-banner" role="status">
          <span>{t('review.gone')}</span>
        </div>
      ) : null}
      {replaceItem ? (
        <div className="er-banner is-info" role="status">
          <span>{replaceTarget === DRAFT ? t('review.replaceDraftBanner') : t('review.replaceBanner', replaceNo)}</span>
          <Button size="xs" onClick={cancelReplace}>
            {t('review.cancel')}
          </Button>
        </div>
      ) : null}
      {restore ? (
        <div className="er-banner is-info er-restore" role="status" data-er-restore-bar="">
          <span className="er-restore-text">
            {t('review.restore.lost')}
            <q className="er-restore-words">{restore.words}</q>
          </span>
          <Button size="xs" disabled={lockedIds.has(restore.draftId)} data-er-restore-action="copy" onClick={() => restoreAction('copy')}>
            {t('review.restore.copy')}
          </Button>
          <Button size="xs" disabled={lockedIds.has(restore.draftId)} data-er-restore-action="reselect" onClick={() => restoreAction('reselect')}>
            {t('review.reselect')}
          </Button>
          <Button size="xs" variant="ghost" disabled={lockedIds.has(restore.draftId)} data-er-restore-action="discard" onClick={() => restoreAction('discard')}>
            {t('review.restore.discard')}
          </Button>
        </div>
      ) : null}
      {sendDisabled ? (
        <div className="er-banner" role="status" data-er-peer={peer}>
          <span>{t(`review.peerBanner.${peer}`)}</span>
          {peer === 'missing' ? (
            <Button size="xs" onClick={() => rt.handoff.retryPeer()}>
              {t('review.peerRetry')}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div
        className="er-body"
        ref={bodyRef}
        data-er-list-mode={mode}
        data-er-sheet={sheet ?? undefined}
        style={{ '--er-list-w': `${fit.width}px` }}
      >
        <div className="er-docwrap" ref={wrapRef}>
          <div
            className="er-doc"
            ref={docRef}
            data-diple-docs-doc=""
            data-diple-owner="diple-docs"
            data-view={view}
            tabIndex={-1}
            onClick={onDocClick}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && replaceTarget) cancelReplace()
            }}
          >
            {docBody}
          </div>
          {pickAt && (!floating || floatDraft) ? (
            <button
              type="button"
              className="er-pickbtn"
              style={{ top: pickAt.top, left: pickAt.left }}
              title={t('review.annotateButtonTip')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void annotateSelection()}
              data-diple-docs-pick=""
            >
              {t('review.annotateButton')}
            </button>
          ) : null}
          {floatItem ? (
            <FloatEditor
              key={floatDraft ? `${DRAFT}-${draft.draftId}` : floatItem.id}
              t={t}
              item={floatItem}
              index={numbering.get(floatItem.id)}
              isNew={floating.isNew}
              draft={floatDraft}
              commit={(words, intent) => commitDraft(intent).then((r) => ({ ...r, handled: true }))}
              initial={floating.initial}
              initialBase={floating.base}
              saving={floatDraft && lockedIds.has(draft.draftId)}
              lost={floatDraft && Boolean(draft.lost)}
              restored={floatDraft ? Boolean(draft.restored) : Boolean(floating.restored)}
              collision={floatDraft ? draft.collision : null}
              rewrite={floatDraft ? draft.rewrite ?? null : null}
              onCollision={resolveCollision}
              onType={floatDraft ? typeDraft : floating.pending ? (text) => {
                const s = cache.get(floating.pending)
                if (s) cache.write({ ...s, text, textVersion: (s.textVersion ?? 0) + 1 })
              } : null}
              onSaved={(submitted, item, current) => {
                const id = floating.pending
                const s = id && cache.get(id)
                if (!s || s.kind !== 'pending-edit') return
                if (s.text === submitted) cache.clearIf(id, (v) => v.textVersion === s.textVersion && v.text === submitted)
                else cache.write({ ...s, baseMutation: versionOf(item) })
              }}
              onCancel={() => {
                if (floatDraft) dropDraft()
                else {
                  if (floating.pending) {
                    const s = cache.get(floating.pending)
                    if (s) cache.clearIf(s.draftId, (v) => v.kind === 'pending-edit' && v.textVersion === s.textVersion && v.itemId === s.itemId)
                  }
                  setFloating(null)
                }
              }}
              onDiscard={dropDraft}
              shake={floatDraft ? shake : 0}
              store={store}
              wrap={wrapRef}
              getRect={() => (floatDraft ? draftDom.current : domRanges.current.get(floatItem.id))?.getBoundingClientRect?.() ?? null}
              fallback={floating.fallback}
              scrollTo={floating.scrollTo}
              measureKey={`${state.text.length}|${view}|${mode}|${floatDraft ? draft.range?.start ?? 'lost' : state.ranges.get(floatItem.id)?.start ?? ''}`}
              canSend={!sendDisabled && !busy && Boolean(sessionId) && !(floatDraft && (draft.lost || draft.collision))}
              itemError={itemError}
              registerFlush={registerFlush}
              onDone={() => {
                if (floatDraft) return dropDraft() // Esc / × only: commit owns success
                const id = floatItem.id
                setFloating(null)
                setActive(id)
                docRef.current?.focus({ preventScroll: true }) // the keys stay with the document
                if (modeRef.current === 'open' || sheet === 'open') rt.focusCard(keyRef.current, id, { focus: false })
              }}
              onSend={(it) => {
                const id = it.id
                const now = id && store.get().items.find((x) => x.id === id)
                if (now) void sendItems([now], { sessionId, sendNow: true })
              }}
              onReselect={(id) => {
                if (id === DRAFT && locks.current.has(draftRef.current?.draftId)) return
                setFloating(null)
                if (id === DRAFT) {
                  setReplaceTarget(DRAFT)
                  docRef.current?.focus({ preventScroll: true })
                  return
                }
                setReplaceTarget(id)
                setActive(id)
                docRef.current?.focus({ preventScroll: true })
              }}
            />
          ) : null}
        </div>
        {mode === 'rail' ? (
          <StatusRail
            t={t}
            items={docOrder(state.items, state.ranges)}
            numbering={numbering}
            ticks={ticks}
            measures={measures.current}
            active={active}
            canNav={unhandled > 0}
            onNav={nav}
            onJump={(id) => {
              if (!holdDraft()) return
              setActive(id)
              scrollToItem(id)
            }}
          />
        ) : mode === 'sheet' ? (
          <div className="er-sheet">
            <div className="er-sheet-bar" data-er-sheet-bar="">
              <ListToggle t={t} open={sheet === 'open'} unhandled={unhandled} onToggle={toggleList}>
                <span className="er-sheet-title">{t('review.sheetTitle', state.items.length)}</span>
              </ListToggle>
              <span className="er-spacer" />
              <NavButtons t={t} canNav={unhandled > 0} onNav={nav} />
            </div>
            {sheet === 'open' ? list : null}
          </div>
        ) : (
          list
        )}
      </div>
    </div>
  )
}
