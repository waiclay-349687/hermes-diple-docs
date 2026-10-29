// The review list (标注清单): filter, cards in document order, resolved items
// folded away by default (requirement 03-#3/#10).
//
// Sending (V2.1 #8, after Orca's "Send notes"): one 「发送 N 条 ▾」 at the top
// (N = this file's unsent annotations) and a small 「发送这一条」 on every card;
// both open the same menu (desktop-kit SendMenu): the scope (这一条 / 本文件全部
// 未发送), the target (the current session — the default —, up to 5 recent
// sessions, 加入聊天待发), and 复制给 AI. core SendRequest turns the choice into
// one request; page.sendItems carries it out through the hand-off, unchanged.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CopyText, SendRequest } from '@diple/core'
import { SendMenu } from '@diple/desktop-kit'

import { bulkPlan, copyAll } from './bulk.js'
import { versionOf } from './doc-store.js'
import { markOf } from './marks.js'
import { FILTERS, arrange, displayStatus, exportLine } from './model.js'
import { Button, Markdown, Tip, cx } from './ui.jsx'

// A card takes the focus without scrolling the page (the list is sticky in the
// document's scroll space: a plain focus() scrolls that to the top, V3-D3 #1);
// only the list's own scroll brings it into view.
function focusInList(el, { focus = true, smooth = false } = {}) {
  if (!el) return
  if (focus) el.focus({ preventScroll: true })
  const list = el.closest('.er-items')
  const r = el.getBoundingClientRect?.()
  const b = list?.getBoundingClientRect?.()
  if (!r || !b) return
  const by = r.top < b.top ? r.top - b.top : r.bottom > b.bottom ? Math.min(r.bottom - b.bottom, r.top - b.top) : 0
  if (by) list.scrollTo?.({ top: list.scrollTop + by, behavior: smooth ? 'smooth' : 'auto' })
}

function useSessionTitles(rt, ids) {
  const key = [...new Set(ids)].sort().join(',')
  const [titles, setTitles] = useState({})
  useEffect(() => {
    if (!key) return
    let live = true
    rt.titles(key.split(',')).then((t) => live && setTitles(t))
    return () => {
      live = false
    }
  }, [rt, key])
  return titles
}

// A DRAFT (V3-D3 #2: select → 标注, nothing stored yet) passes commit(text) →
// Promise<bool>: 保存 / ⏎ hand the words to it (empty = a 划线), once; a blur
// saves nothing (a click away is the float's to judge), Esc drops it (onDone).
// onType(text) follows the words, so the page can tell an empty draft.
// R11: commit(text) → { ok, id?, stale? }; saved while the user typed on, the
// editor hands over with onContinue(id, words) (XR11-03). initial: the words
// it opens with (an edit carried over from a draft), else the stored comment.
export function CommentEditor({ item, store, t, onDone, itemError, registerFlush, commit = null, onType = null, initial, onContinue = null, initialBase, onSaved, onCancel, rewrite = null }) {
  const [draft, setDraft] = useState(initial ?? item.comment ?? '')
  const committed = useRef(false)
  // The version this edit started from. A refresh while typing does NOT move
  // it: saving over a change made elsewhere (a newer comment, or a resolve)
  // must be a conscious choice (XR-04 / XR2-01).
  const base = useRef(initialBase ?? versionOf(item))
  const [conflict, setConflict] = useState(null) // { comment, resolved } saved elsewhere meanwhile
  const ref = useRef(null)
  const saving = useRef(false)
  const cancelled = useRef(false)
  useEffect(() => {
    const release = store.hold()
    // never scroll: the editor may not be placed yet (V3-D3 #1, the jump to the top)
    ref.current?.focus({ preventScroll: true })
    const len = ref.current?.value.length ?? 0
    ref.current?.setSelectionRange?.(len, len)
    return release
  }, [store])

  // One save in flight at a time; a second caller (the send's flush racing
  // the blur) waits for that one. → true saved / unchanged, false not saved.
  const inflight = useRef(null)
  const save = (refocus, opts) => {
    if (cancelled.current) return Promise.resolve(true)
    if (inflight.current) return inflight.current
    inflight.current = doSave(refocus, opts).finally(() => {
      inflight.current = null
    })
    return inflight.current
  }
  // Before a send from this page (V2-X, the R8 XV-02 class): the typed words first.
  const draftRef = useRef(draft)
  draftRef.current = draft
  useEffect(() => registerFlush?.((intent = 'save') => save(false, { intent })), [registerFlush, draft, conflict])
  // R11-J (XR11c-01): the page wrote the box — a conflict choice shows, at the click, the
  // full text it writes. Shown at once, cursor at the end; a rewrite already there at
  // mount is not one (the editor opens with those words).
  const seenRewrite = useRef(rewrite)
  useLayoutEffect(() => {
    if (!rewrite || rewrite === seenRewrite.current) return
    seenRewrite.current = rewrite
    draftRef.current = rewrite.words
    setDraft(rewrite.words)
    const el = ref.current
    if (!el) return
    el.value = rewrite.words
    el.focus({ preventScroll: true })
    el.setSelectionRange?.(rewrite.words.length, rewrite.words.length)
  }, [rewrite])
  // XR11c-03: the ONE way a save of a stored item ends well — written, unchanged, or the
  // remote already holds these very words (a 409 whose newest is mine). onSaved lets the
  // page clear what this edit was (version-checked); the editor closes unless the user
  // typed on while it was in flight.
  const succeed = (submitted, now, refocus) => {
    base.current = versionOf(now) ?? base.current
    onSaved?.(submitted, now, draftRef.current)
    setConflict(null)
    if (!ref.current || ref.current.value === submitted) onDone(refocus)
    return true
  }

  const doSave = async (refocus, { overwrite = false, intent = 'save' } = {}) => {
    if (saving.current) return false
    const submitted = draftRef.current
    if (commit) {
      if (committed.current) return true // one write per draft (a send's flush after 保存)
      saving.current = true
      const res = await commit(submitted, intent)
      saving.current = false
      if (!res?.ok) return false
      committed.current = true
      // an older draft's answer, or the page took over (opened the stored one)
      if (res.stale || res.handled || !ref.current) return true
      // the box is not locked while saving: words typed meanwhile stay, unsaved, on the stored one
      if (ref.current.value !== submitted && onContinue) {
        onContinue(res.id, ref.current.value)
        return true
      }
      onDone(refocus)
      return true
    }
    const latest = store.get().items.find((x) => x.id === item.id) ?? item
    if (overwrite) base.current = versionOf(latest)
    if (!overwrite && submitted === (latest.comment ?? '') && versionOf(latest) === base.current) return succeed(submitted, latest, refocus) // unchanged
    saving.current = true
    const res = await store.setComment(latest, submitted, {
      base: base.current
    })
    saving.current = false
    if (!res.ok && res.code === 'stale') {
      const now = store.get().items.find((x) => x.id === item.id)
      if (!now) return itemError('unknown-item')
      const resolved = now.status === 'resolved'
      if (!resolved && (now.comment ?? '') === submitted) return succeed(submitted, now, refocus) // someone saved the very same words
      setConflict({ comment: now.comment ?? '', resolved })
      ref.current?.focus({ preventScroll: true })
      return false
    }
    if (!res.ok) return itemError(res.code), false
    return succeed(submitted, res.item ?? latest, refocus)
  }

  return (
    <>
      {conflict !== null ? (
        <div className="er-banner is-info er-conflict" role="alert" data-er-conflict="" onClick={(e) => e.stopPropagation()}>
          <span>{conflict.resolved ? t('review.conflict.resolved') : t('review.conflict.text', conflict.comment || t('review.noComment'))}</span>
          <Button size="xs" data-er-conflict-action="overwrite" onMouseDown={(e) => e.preventDefault()} onClick={() => void save(true, { overwrite: true })}>
            {t('review.conflict.overwrite')}
          </Button>
          <Button
            size="xs"
            variant="ghost"
            data-er-conflict-action="discard"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              cancelled.current = true
              if (onCancel) onCancel()
              else onDone(true)
            }}
          >
            {t('review.conflict.discard')}
          </Button>
        </div>
      ) : null}
      <textarea
        ref={ref}
        className="er-editor desktop-input-chrome"
        value={draft}
        rows={3}
        aria-label={t('review.commentLabel')}
        placeholder={t('review.commentPlaceholder')}
        onChange={(e) => {
          setDraft(e.target.value)
          onType?.(e.target.value)
        }}
        onClick={(e) => e.stopPropagation()}
        onBlur={() => !commit && conflict === null && void save(false)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.nativeEvent?.isComposing || e.isComposing || e.keyCode === 229) return
          if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
            e.preventDefault()
            void save(true)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            cancelled.current = true
            if (onCancel) onCancel()
            else onDone(true)
          }
        }}
      />
    </>
  )
}

// Not sent yet, and sendable: a pending annotation, neither resolved nor changed.
const isUnsent = (item) => displayStatus(item) === 'pending'
const MAX_TITLE = 32
const short = (title) => {
  const cs = Array.from(
    String(title ?? '')
      .replace(/\s+/g, ' ')
      .trim()
  )
  return cs.length > MAX_TITLE ? `${cs.slice(0, MAX_TITLE - 1).join('')}…` : cs.join('')
}
const basename = (p) =>
  String(p ?? '')
    .split(/[\\/]/)
    .pop()

/** The one send menu (V2.1 #8): opened from the list (scope: every unsent one) or a card (scope: this one). */
function DocSendMenu({ ctx, scopeItem = null }) {
  const { t, sessionId, titles, recent, bulk, onSend, closeMenu, rt, path } = ctx
  const [scope, setScope] = useState(scopeItem ? 'item' : 'unsent')
  // R11 XR11-10: the menu always opens. 复制给 AI is local (no Diple, no session):
  // usable whenever the scope has something to copy. Only the send targets are
  // disabled — by Diple's state, a send running, or a scope with nothing sendable.
  const copyable = scope === 'item' ? [scopeItem] : bulk
  const sendOff = ctx.sendDisabled || ctx.busy || (scope === 'item' ? !isUnsent(scopeItem) : !bulk.length)
  // the scope's items: a card's own one, or the list's unsent ones (not those already in a pending list)
  const list = bulk.map((it) => ({ id: it.id, unsent: true }))
  if (scopeItem && !list.some((x) => x.id === scopeItem.id)) list.unshift({ id: scopeItem.id, unsent: isUnsent(scopeItem) })
  const byId = new Map([...ctx.allItems].map((it) => [it.id, it]))
  const run = (target) => {
    const req = SendRequest.plan({
      scope: scope === 'item' ? { kind: 'item', id: scopeItem.id } : { kind: 'unsent' },
      target,
      items: list,
      focusedSessionId: sessionId,
      explicit: true
    })
    if (!req.ok)
      return rt.notify({
        kind: 'warning',
        durationMs: 5000,
        message: t(`review.handoff.${req.reason}`)
      })
    const picked = req.itemIds.map((id) => byId.get(id)).filter(Boolean)
    if (req.kind === 'copy') return copy(picked)
    void onSend(picked, { sessionId: req.sessionId, sendNow: req.sendNow })
  }
  const copy = (picked) => {
    const md = CopyText.forAgent({
      title: t('review.copyTitle', basename(path), picked.length),
      entries: picked.map((it) => ({
        label: exportLine(it) == null ? basename(path) : t('review.copyLabel', basename(path), exportLine(it)),
        text: it.text,
        comment: it.comment
      }))
    })
    globalThis.navigator?.clipboard?.writeText?.(md)?.then?.(
      () => rt.notify({ kind: 'success', durationMs: 4000, message: t('review.copiedForAgent', picked.length) }),
      () => {}
    )
  }
  const title = (id) => short(titles[id] || t('review.untitledSession'))
  const targets = SendRequest.targets({ current: sessionId, recent })
  const sections = [
    {
      key: 'scope',
      title: t('review.scopeTitle'),
      items: [
        ...(scopeItem
          ? [
              {
                key: 'scope-item',
                label: t('review.scopeOne'),
                checked: scope === 'item',
                keep: true,
                onSelect: () => setScope('item')
              }
            ]
          : []),
        {
          key: 'scope-unsent',
          label: t('review.scopeAll', bulk.length),
          checked: scope === 'unsent',
          keep: true,
          disabled: !bulk.length,
          onSelect: () => setScope('unsent')
        }
      ]
    },
    {
      key: 'to',
      title: t('review.targetTitle'),
      items: targets.map((tg) =>
        tg.kind === 'queue'
          ? {
              key: 'queue',
              label: t('review.targetQueue'),
              disabled: sendOff,
              onSelect: () => run(tg)
            }
          : tg.current
            ? {
                key: 'current',
                label: t('review.targetCurrent', title(tg.sessionId)),
                default: true,
                disabled: sendOff,
                onSelect: () => run(tg)
              }
            : {
                key: `session:${tg.sessionId}`,
                label: title(tg.sessionId),
                disabled: sendOff,
                onSelect: () => run(tg)
              }
      )
    },
    {
      key: 'copy',
      items: [
        {
          key: 'copy',
          label: t('review.copyForAgent'),
          disabled: !copyable.length,
          onSelect: () => copy(copyable)
        }
      ]
    }
  ]
  return <SendMenu label={t('review.sendMenu')} attrs={{ 'data-er-send-menu': '' }} onClose={closeMenu} sections={sections.filter((sec) => sec.items.length)} />
}

function ItemCard({ item, index, ctx }) {
  const { t, rt, active, editing, onActivate, onEdit, store, busy, sendDisabled, sessionId, titles } = ctx
  const status = displayStatus(item)
  const mark = markOf(item)
  // 原文已变 is shown next to the status it overlays, not instead of it
  const chips = item.lost ? [item.status, 'changed'] : [status]
  const isActive = active === item.id
  const isEditing = editing === item.id
  const unsent = isUnsent(item)
  // the trigger always opens the menu (复制给 AI needs nothing); the tip names why sending cannot
  const blockTip = sendDisabled
    ? t('review.sendDisabledTip')
    : !unsent
      ? t(status === 'resolved' || status === 'changed' ? 'review.sendOneBlocked' : 'review.sendOneSent')
      : !ctx.canTarget
        ? t('review.handoff.no-session')
        : ''
  const lineLabel = item.lost ? t('review.oldLine', item.anchor.line) : t('review.line', item.anchor.line)
  const sessions = item.sentSessions ?? []

  const act = async (fn) => {
    const res = await fn()
    if (res && !res.ok) ctx.itemError(res.code)
  }

  return (
    <div
      className={cx('er-card', isActive && 'is-active', status === 'resolved' && 'is-resolved')}
      role="listitem"
      tabIndex={0}
      data-er-item={item.id}
      data-er-status={status}
      data-er-mark={mark.base}
      data-er-changed={String(mark.changed)}
      data-er-located={String(!item.lost)}
      aria-label={`${index}. ${t(`review.status.${status}`)} · ${lineLabel} · ${item.text.slice(0, 80)}`}
      onClick={() => onActivate(item.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' && status !== 'resolved') {
          e.preventDefault()
          onActivate(item.id)
          onEdit(item.id)
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          ctx.onRemove(item)
        }
      }}
    >
      <div className="er-card-top">
        <span className="er-index">{index}</span>
        {chips.map((s) => (
          <span key={s} className={cx('er-status', `er-status-${s}`)}>
            {t(`review.status.${s}`)}
          </span>
        ))}
        {ctx.isQueued(item) ? (
          <Tip label={t(item.queued?.batchId ? 'review.awaitingTip' : 'review.queuedTip')}>
            <span className="er-chip" data-er-awaiting={item.queued?.batchId ? '' : undefined}>
              {t(item.queued?.batchId ? 'review.awaiting' : 'review.queued')}
            </span>
          </Tip>
        ) : null}
        <span className="er-line-no">{lineLabel}</span>
        <span className="er-send-one-wrap" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Tip label={blockTip || t('review.sendOne')}>
            <span className="er-send-one-tip">
              <button
                type="button"
                className="er-send-one"
                data-er-send-one=""
                data-send-menu-trigger=""
                aria-haspopup="menu"
                aria-expanded={ctx.menuFor === item.id}
                aria-label={blockTip ? `${t('review.sendOne')} — ${blockTip}` : t('review.sendOne')}
                onClick={() => ctx.toggleMenu(item.id)}
              >
                <i className="codicon codicon-send" aria-hidden="true" />
              </button>
            </span>
          </Tip>
          {ctx.menuFor === item.id ? <DocSendMenu ctx={ctx} scopeItem={item} /> : null}
        </span>
      </div>
      {item.lost ? (
        // the way out is on the card itself, not behind a click (XR-05: edits around repeated
        // passages make annotations 原文已变 more often than a user expects)
        <div className="er-hint er-hint-changed">
          <span>{t('review.changedHint')}</span>
          {!isActive ? (
            <Tip label={t('review.reselectTip')}>
              <Button
                size="xs"
                variant="secondary"
                data-er-reselect=""
                onClick={(e) => {
                  e.stopPropagation()
                  onActivate(item.id)
                  ctx.onReselect(item.id)
                }}
              >
                {t('review.reselect')}
              </Button>
            </Tip>
          ) : null}
        </div>
      ) : null}
      <div className="er-quote" data-er-mark={mark.base}>
        <Markdown text={item.text} />
      </div>
      {isEditing ? (
        <CommentEditor
          item={item}
          store={store}
          t={t}
          itemError={ctx.itemError}
          registerFlush={ctx.registerFlush}
          onDone={(refocus) => {
            onEdit(null)
            if (refocus) ctx.focusCard(item.id)
          }}
        />
      ) : (
        <div
          className={cx('er-comment', !item.comment && 'is-empty')}
          onDoubleClick={() => status !== 'resolved' && onEdit(item.id)}
        >
          {item.comment || t('review.noComment')}
        </div>
      )}
      {sessions.length ? (
        <div className="er-sessions">
          <span>{t('review.sentTo')}</span>
          {sessions.map((s) => {
            const title = titles[s.sessionId] || t('review.untitledSession')
            return (
              <button
                key={s.batchId || s.sessionId}
                type="button"
                className="er-session"
                title={t('review.openSession', title)}
                onClick={(e) => {
                  e.stopPropagation()
                  rt.openSession(s.sessionId)
                }}
              >
                {title}
              </button>
            )
          })}
        </div>
      ) : null}
      {isActive ? (
        <div className="er-actions" onClick={(e) => e.stopPropagation()}>
          {item.lost ? (
            <>
              <Tip label={t('review.reselectTip')}>
                <Button size="xs" onClick={() => ctx.onReselect(item.id)}>
                  {t('review.reselect')}
                </Button>
              </Tip>
              {/* no words to sit under: a changed item keeps the card's own editor (V3-D2 #3) */}
              {!isEditing && item.status !== 'resolved' ? (
                <Button size="xs" variant="ghost" onClick={() => onEdit(item.id)}>
                  {t('review.editComment')}
                </Button>
              ) : null}
            </>
          ) : status === 'resolved' ? (
            <Button size="xs" data-er-action="reopen" onClick={() => act(() => store.reopen(item))}>
              {t('review.reopen')}
            </Button>
          ) : (
            <>
              {!isEditing ? (
                <Button size="xs" variant="ghost" onClick={() => onEdit(item.id)}>
                  {t('review.editComment')}
                </Button>
              ) : null}
              <Button size="xs" variant="ghost" data-er-action="resolve" onClick={() => act(() => store.resolve(item))}>
                {t('review.resolve')}
              </Button>
            </>
          )}
          <span className="er-spacer" />
          <Button size="xs" variant="ghost" data-er-action="remove" onClick={() => ctx.onRemove(item)}>
            {t('review.remove')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

const LIST = '__list'
const MORE = '__more'

// The list's ⋯ (V3-D2 #2): clear by state, resolve all, copy all. Clears ask
// nothing: the page offers 撤销 for UNDO_MS instead (the chat's 全部清空).
function MoreMenu({ ctx, filter }) {
  const { t, state, menuFor, toggleMenu, closeMenu, rt } = ctx
  const plan = bulkPlan(state.items, state.ranges, filter)
  const n = plan.all.length
  const clear = (key, label, list) => ({
    key,
    label,
    disabled: list.length === 0,
    attrs: { 'data-er-bulk': key },
    onSelect: () => void ctx.onClear(list)
  })
  const sections = [
    {
      key: 'clear',
      items: [
        clear('clear-all', t('review.bulk.clearAll', n), plan.all),
        clear('clear-resolved', t('review.bulk.clearResolved', plan.resolved.length), plan.resolved),
        clear('clear-sent', t('review.bulk.clearSent', plan.sent.length), plan.sent),
        clear('clear-changed', t('review.bulk.clearChanged', plan.changed.length), plan.changed),
        ...(plan.filtered ? [clear('clear-filter', t('review.bulk.clearFilter', plan.filtered.length), plan.filtered)] : [])
      ]
    },
    {
      key: 'resolve',
      items: [
        {
          key: 'resolve-all',
          label: t('review.bulk.resolveAll', plan.resolvable.length),
          disabled: plan.resolvable.length === 0,
          attrs: { 'data-er-bulk': 'resolve-all' },
          onSelect: () => void ctx.onResolveAll(plan.resolvable)
        }
      ]
    },
    {
      key: 'copy',
      items: [
        {
          key: 'copy-md',
          label: t('review.bulk.copyAll'),
          disabled: n === 0,
          attrs: { 'data-er-bulk': 'copy-md' },
          onSelect: () =>
            globalThis.navigator?.clipboard?.writeText?.(copyAll(state.items, state.ranges))?.then?.(
              () => rt.notify({ kind: 'success', durationMs: 4000, message: t('review.bulk.copied', n) }),
              () => {}
            )
        }
      ]
    }
  ]
  return (
    <span className="er-send-menu-wrap er-more-wrap">
      <Tip label={t('review.more')}>
        <button
          type="button"
          className="er-icon-btn"
          data-er-more=""
          data-send-menu-trigger=""
          aria-label={t('review.more')}
          aria-haspopup="menu"
          aria-expanded={menuFor === MORE}
          disabled={n === 0}
          onClick={() => toggleMenu(MORE)}
        >
          <i className="codicon codicon-ellipsis" aria-hidden="true" />
        </button>
      </Tip>
      {menuFor === MORE ? <SendMenu label={t('review.more')} attrs={{ 'data-er-more-menu': '' }} onClose={closeMenu} sections={sections} /> : null}
    </span>
  )
}

export function ReviewList(props) {
  const { rt, t, state, active, sessionId, busy, sendDisabled } = props
  const [filter, setFilter] = useState('all')
  const [showResolved, setShowResolved] = useState(false)
  const listRef = useRef(null)
  const arranged = arrange(state.items, state.ranges, filter)
  const { counts } = arranged
  const all = [...state.items]
  const titles = useSessionTitles(rt, [...all.flatMap((it) => (it.sentSessions ?? []).map((s) => s.sessionId)), sessionId].filter(Boolean))
  const sessionTitle = sessionId ? titles[sessionId] || t('review.untitledSession') : ''
  const bulk = props.pendingForSend(state.items, state.ranges)
  const order = arrange(state.items, state.ranges, 'all')
  const numbering = new Map([...order.shown, ...order.resolved].map((it, i) => [it.id, i + 1]))
  let { shown, resolved } = arranged
  // A card whose comment is being written stays in the list even if another
  // window resolved it (or the filter no longer matches): the draft then meets
  // the conflict notice instead of vanishing into the folded group (XR2-01).
  const editingItem = props.editing ? state.items.find((it) => it.id === props.editing) : null
  if (editingItem && !shown.includes(editingItem)) {
    resolved = resolved.filter((it) => it !== editingItem)
    shown = [...shown, editingItem].sort((a, b) => numbering.get(a.id) - numbering.get(b.id))
  }

  const focusCard = (id) => {
    setTimeout(() => focusInList(listRef.current?.querySelector(`[data-er-item="${id}"]`)), 0)
  }
  // opts.focus === false: bring the card into view without taking the focus
  // (上一条 / 下一条未处理 keeps the focus on its button)
  useEffect(() => rt.registerFocus(props.pageKey, (id, opts) => {
    if (resolved.some((it) => it.id === id)) setShowResolved(true)
    if (filter !== 'all' && !shown.some((it) => it.id === id)) setFilter('all')
    setTimeout(() => {
      const el = listRef.current?.querySelector(`[data-er-item="${id}"]`)
      focusInList(el, { focus: opts?.focus !== false, smooth: true })
    }, 30)
  }))

  // the send menu: which one is open (LIST, or a card's id), and what it can target
  const [menuFor, setMenuFor] = useState(null)
  const [recent, setRecent] = useState([])
  const sentTo = all.flatMap((it) => (it.sentSessions ?? []).map((s) => s.sessionId))
  const sentKey = [...new Set(sentTo)].join(',')
  useEffect(() => {
    if (!menuFor || !rt.recentSessions) return
    let live = true
    rt.recentSessions({ fallback: sentKey ? sentKey.split(',') : [] }).then((ids) => live && setRecent(ids))
    return () => {
      live = false
    }
  }, [rt, menuFor, sentKey])
  const recentShown = recent.filter((id) => id !== sessionId).slice(0, SendRequest.RECENT_MAX)
  const menuTitles = useSessionTitles(rt, recentShown)
  const canTarget = Boolean(sessionId) || recentShown.length > 0 || sentTo.length > 0
  const toggleMenu = (id) => setMenuFor((cur) => (cur === id ? null : id))
  // focus goes back to the trigger only after Esc, a pick or Tab; a press outside (or
  // a scroll) leaves it where the user put it, so a drag-select there carries on
  const closeMenu = (reason) => {
    const was = menuFor
    setMenuFor(null)
    if (reason !== 'escape' && reason !== 'select' && reason !== 'tab') return
    setTimeout(() => {
      const sel = was === LIST ? '[data-er-send-menu-open]' : was === MORE ? '[data-er-more]' : `[data-er-item="${was}"] [data-er-send-one]`
      listRef.current?.closest('.er-list')?.querySelector(sel)?.focus?.({ preventScroll: true })
    }, 0)
  }
  const ctx = {
    ...props,
    titles: { ...titles, ...menuTitles },
    focusCard,
    recent: recentShown,
    bulk,
    allItems: all,
    menuFor,
    toggleMenu,
    closeMenu,
    canTarget,
    filter
  }
  // XR11-10: open whenever there is something to copy; the targets inside say what cannot be sent
  const sendBlocked = bulk.length === 0
  const blockTip = sendDisabled ? t('review.sendDisabledTip') : !canTarget ? t('review.handoff.no-session') : ''

  const onListKey = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const cards = [...(listRef.current?.querySelectorAll('.er-card') ?? [])]
    const i = cards.indexOf(document.activeElement)
    if (i < 0) return
    e.preventDefault()
    focusInList(cards[Math.max(0, Math.min(cards.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))])
  }

  return (
    <aside className="er-list" aria-label={t('review.listLabel')} data-diple-docs-list="">
      {props.resizer ?? null}
      <div className="er-list-head">
        <div className="er-list-title">
          <span className="er-list-name">{t('review.listTitle')}</span>
          <span className="er-count" data-er-list-count="">
            {all.length}
          </span>
          <span className="er-list-tools">
            {props.panelTools ?? null}
            <MoreMenu ctx={ctx} filter={filter} />
          </span>
        </div>
        <div className="er-filters" role="tablist" aria-label={t('review.listTitle')}>
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={cx('er-filter', filter === f && 'is-active')}
              data-er-filter={f}
              onClick={(e) => {
                setFilter(f)
                e.currentTarget.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
              }}
            >
              {t(`review.filter.${f}`)}
              <b>{counts[f]}</b>
            </button>
          ))}
        </div>
        <div className="er-bulk">
          <span className="er-send-menu-wrap">
            <Tip label={blockTip}>
              <span>
                <Button
                  size="xs"
                  disabled={sendBlocked}
                  data-er-send-menu-open=""
                  data-send-menu-trigger=""
                  aria-haspopup="menu"
                  aria-expanded={menuFor === LIST}
                  onClick={() => toggleMenu(LIST)}
                >
                  {t('review.sendCount', bulk.length)}
                  <i className="codicon codicon-chevron-down" aria-hidden="true" />
                </Button>
              </span>
            </Tip>
            {menuFor === LIST ? <DocSendMenu ctx={ctx} /> : null}
          </span>
          <span className="er-target" title={sessionId ? t('review.target', sessionTitle) : ''}>
            {sessionId ? t('review.target', sessionTitle) : t('review.noTarget')}
          </span>
        </div>
      </div>
      <div className="er-items" role="list" ref={listRef} onKeyDown={onListKey}>
        {state.items.length === 0 ? (
          <div className="er-state">
            <div className="er-state-title">{t('review.emptyList')}</div>
            <div>{t('review.emptyListHint')}</div>
          </div>
        ) : shown.length === 0 && (filter !== 'all' || resolved.length === 0) ? (
          <div className="er-state">{t('review.emptyFilter')}</div>
        ) : null}
        {shown.map((it) => (
          <ItemCard key={it.id} item={it} index={numbering.get(it.id)} ctx={ctx} />
        ))}
        {filter === 'all' && resolved.length ? (
          <>
            <button
              type="button"
              className="er-group"
              aria-expanded={showResolved}
              data-er-resolved-toggle=""
              onClick={() => setShowResolved((v) => !v)}
            >
              <span aria-hidden="true">{showResolved ? '▾' : '▸'}</span>
              {t('review.resolvedGroup', resolved.length)}
            </button>
            {showResolved ? resolved.map((it) => <ItemCard key={it.id} item={it} index={numbering.get(it.id)} ctx={ctx} />) : null}
          </>
        ) : null}
      </div>
    </aside>
  )
}
