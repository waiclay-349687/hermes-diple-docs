// The editor under the passage (V3-D2 L #3, the chat's V3-T rule): select →
// 标注, or a card's 编辑意见, opens it right under the words in the document
// pane — the quote on top, the comment box, the foot of the chat's V2.1 editor
// (an icon-only 重新选取原文 on the start side; 保存并发送 and the primary
// 保存 on the end side; no key hints). No room below → above (float.js).
//   Lives in the pane's scroll space (position:absolute in .er-docwrap), so it
//   scrolls with the words; it is placed when it opens and when the page
//   re-measures, never on scroll. Not inside the document (that stays read-only).
//   The box is list.jsx's CommentEditor: the same save / conflict / IME / hold
//   rules as the card's (which is kept only for 原文已变 items, which have no
//   words to sit under).
//
//   <FloatEditor t item index isNew store getRect fallback wrap onDone onSend
//                canSend onReselect itemError registerFlush
//                draft commit onType onDiscard shake />
//     getRect() → the passage's client rect, or null (not painted yet → fallback)
//     scrollTo  the pane's planned scrollTop (a card's 编辑意见 scrolls there first)
//     onDone(saved)   closed (saved / unchanged / Esc)
//   draft  (V3-D3 #2) the item is not stored yet: commit(text) stores it (保存 / ⏎,
//          empty = 划线), onType(text) follows the words, onDiscard() drops it.
//          A click away: empty → dropped, words → kept and the editor shakes
//          (the chat's rule); a selection gesture is not a click away. shake
//          (a number) shakes it from outside (a new 标注 while it has words).
//   Placed before it is shown; nothing in it scrolls the pane (V3-D3 #1).
//   R11: initial (the box's words when it opens: a draft saved while the user typed
//   on continues as the stored one's edit, onContinue(id, words), XR11-03); lost
//   (the passage is gone after a refresh: 保存 waits for 重新选取原文, XR11-02);
//   restored (reopened from the cache, XR11-05); collision { comment } with
//   onCollision('keep' | 'replace' | 'merge') (saved elsewhere meanwhile, XR11-04).
//   R11-J: rewrite { words } — the page put these words in the box (a conflict
//   choice shows the full text it writes, XR11c-01); applied once, cursor at the end.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import { placeFloat } from './float.js'
import { CommentEditor } from './list.jsx'
import { Markdown, Tip } from './ui.jsx'

export function FloatEditor({ t, item, index, isNew, store, getRect, fallback, wrap, scrollTo, measureKey, onDone, onSend, canSend, onReselect, itemError, registerFlush, draft = false, commit = null, onType = null, onDiscard = null, shake = 0, initial, onContinue = null, lost = false, restored = false, collision = null, onCollision = null, saving = false, initialBase, onSaved, onCancel, rewrite = null }) {
  const ref = useRef(null)
  const typed = useRef(initial ?? item.comment ?? '')
  const doShake = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.removeAttribute('data-shake')
    void el.offsetWidth // restart the animation
    el.setAttribute('data-shake', '')
    setTimeout(() => el.isConnected && el.removeAttribute('data-shake'), 320)
    el.querySelector('textarea')?.focus({ preventScroll: true })
  }, [])
  useEffect(() => {
    if (shake) doShake()
  }, [shake, doShake])
  // a click away from a draft: the chat's rule (a selection gesture is not one)
  useEffect(() => {
    if (!draft) return
    const doc = ref.current?.ownerDocument
    if (!doc) return
    const onClick = (e) => {
      const el = ref.current
      const target = e.target
      if (!el || el.contains(target) || target?.closest?.('[data-diple-docs-pick]')) return
      const sel = doc.getSelection?.()
      if (sel && !sel.isCollapsed) return
      if (typed.current.trim()) doShake()
      else onDiscard?.()
    }
    doc.addEventListener('click', onClick, true)
    return () => doc.removeEventListener('click', onClick, true)
  }, [draft, onDiscard, doShake])
  // the page wrote the box (a conflict choice, XR11c-01): the click-away guard follows.
  // Only a rewrite that arrives after mount counts (a remount opens with the words already).
  const seenRewrite = useRef(rewrite)
  useLayoutEffect(() => {
    if (!rewrite || rewrite === seenRewrite.current) return
    seenRewrite.current = rewrite
    typed.current = rewrite.words
  }, [rewrite])
  const follow = useCallback(
    (text) => {
      typed.current = text
      onType?.(text)
    },
    [onType]
  )
  const [place, setPlace] = useState(null)
  const save = useRef(null)
  const flush = useCallback(
    (fn) => {
      save.current = fn
      const off = registerFlush?.(fn)
      return () => {
        if (save.current === fn) save.current = null
        off?.()
      }
    },
    [registerFlush]
  )

  const measure = useCallback(() => {
    const el = ref.current
    const pane = wrap.current
    if (!el || !pane) return
    const box = pane.getBoundingClientRect()
    // no passage to sit under (lost, or not painted yet with no fallback): the top of the view
    const r = getRect() ?? fallback ?? { top: box.top + 12, bottom: box.top + 12, left: box.left + 16, right: box.left + 16 }
    const top = scrollTo ?? pane.scrollTop
    const shift = top - pane.scrollTop // where the words will be once the pane got there
    const rel = { top: r.top - box.top - shift, bottom: r.bottom - box.top - shift, left: r.left - box.left, right: r.right - box.left }
    const rtl = (el.ownerDocument.defaultView?.getComputedStyle?.(el)?.direction ?? 'ltr') === 'rtl'
    const p = placeFloat(rel, { width: el.offsetWidth || 320, height: el.offsetHeight || 170 }, { width: pane.clientWidth || box.width, height: pane.clientHeight || box.height, scrollTop: top }, { rtl })
    setPlace((cur) => (cur && cur.top === p.top && cur.left === p.left && cur.side === p.side ? cur : p))
  }, [getRect, fallback, wrap, scrollTo])

  useLayoutEffect(() => {
    measure()
  }, [measure, measureKey])
  // the passage of a new annotation is painted after this mounts: once more after the paint
  useEffect(() => {
    const id = setTimeout(measure, 80)
    return () => clearTimeout(id)
  }, [measure, measureKey])

  // the box takes the focus once the editor is placed (a focus() before that can be
  // lost, and the click that opened it may have left the focus on the page)
  const placed = place != null
  useEffect(() => {
    if (!placed) return
    const box = ref.current?.querySelector('textarea')
    if (box && box.ownerDocument.activeElement !== box) {
      box.focus({ preventScroll: true })
      box.setSelectionRange?.(box.value.length, box.value.length)
    }
  }, [placed])

  const done = (saved) => onDone(saved)
  // × is Esc: this edit is dropped (a new annotation stays, as a 划线)
  const cancel = () => ref.current?.querySelector('textarea')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  const keep = (e) => e.preventDefault() // a foot button keeps the focus in the box (no blur save first)
  const run = async (send) => {
    const ok = save.current ? await save.current(send ? 'send' : 'save') : true
    if (ok && send && !draft) onSend(item)
  }

  return (
    <div
      ref={ref}
      className="er-float"
      role="dialog"
      aria-label={isNew ? t('review.float.new') : t('review.editComment')}
      data-er-float-editor=""
      data-item-id={draft ? undefined : item.id}
      data-er-draft={draft ? '' : undefined}
      data-side={place?.side ?? 'bottom'}
      style={place ? { top: place.top, left: place.left } : { visibility: 'hidden', top: 0, left: 0 }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="er-float-head">
        <span className="er-index er-float-index">{index ?? '+'}</span>
        <span className="er-float-title">{isNew ? t('review.float.new') : t('review.editComment')}</span>
        <span className="er-spacer" />
        <Tip label={t('review.float.close')}>
          <button type="button" className="er-icon-btn" data-er-float-close="" aria-label={t('review.float.close')} onMouseDown={keep} onClick={cancel}>
            <i className="codicon codicon-close" aria-hidden="true" />
          </button>
        </Tip>
      </div>
      {saving ? <div className="er-float-note" role="status" data-er-saving="">{t('review.savingDraft')}</div> : null}
      {lost ? (
        <div className="er-float-note is-warn" role="status" data-er-draft-lost="">
          {t('review.draftLost')}
        </div>
      ) : restored ? (
        <div className="er-float-note" role="status" data-er-restored="">
          {t(draft ? 'review.restore.restored' : 'review.restore.editRestored')}
        </div>
      ) : null}
      <div className="er-quote er-float-quote">
        <Markdown text={item.text} />
      </div>
      {collision ? (
        <div className="er-banner is-info er-conflict" role="alert" data-er-collision="">
          <span>{t('review.collision.text', collision.comment)}</span>
          <span className="er-conflict-actions">
            {['keep', 'replace', 'merge'].map((a) => (
              <button key={a} type="button" className="er-sbtn" data-er-collision-action={a} disabled={saving} onMouseDown={keep} onClick={() => onCollision?.(a)}>
                {t(`review.collision.${a}`)}
              </button>
            ))}
          </span>
        </div>
      ) : null}
      <CommentEditor item={item} store={store} t={t} itemError={itemError} registerFlush={flush} onDone={() => done(true)} commit={draft ? commit : null} onType={follow} initial={initial} onContinue={onContinue} initialBase={initialBase} onSaved={onSaved} onCancel={onCancel} rewrite={rewrite} />
      <div className="er-float-foot">
        <Tip label={t('review.reselectTip')}>
          <button type="button" className="er-icon-btn" data-er-float-reselect="" disabled={saving} aria-label={`${t('review.reselect')} — ${t('review.reselectTip')}`} onMouseDown={keep} onClick={async () => {
            // a draft keeps its words in the page and only moves its original (nothing stored)
            if (!draft && save.current && !(await save.current())) return
            onReselect(item.id)
          }}>
            <i className="codicon codicon-replace" aria-hidden="true" />
          </button>
        </Tip>
        <span className="er-float-actions">
          <button type="button" className="er-sbtn" data-er-float-send="" disabled={!canSend || saving || lost || Boolean(collision)} onMouseDown={keep} onClick={() => run(true)}>
            {t('review.float.saveSend')}
          </button>
          <button type="button" className="er-pbtn" data-er-float-save="" disabled={saving || lost || Boolean(collision)} onMouseDown={keep} onClick={() => run(false)}>
            {t('review.float.save')}
          </button>
        </span>
      </div>
    </div>
  )
}
