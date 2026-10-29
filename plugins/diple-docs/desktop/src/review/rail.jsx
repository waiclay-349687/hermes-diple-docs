// The status rail (页边状态条, V3-D #2, research B §6.1/U1): what is left of the
// review list when it is collapsed. Top: 上一条 / 下一条未处理 only — the
// toolbar switch (PanelSwitch) is the one expand, with the unhandled count on
// it (V3-D2-I; R11-I dropped the rail's own expand: two buttons doing one
// thing). Below: one tick per annotation, placed at its
// share of the document's height (like a scrollbar's overview ruler) and
// coloured by its status with the marks' own tokens (MarkLook).
//   Hover / focus a tick → a preview (status, quote and comment as Markdown).
//   Click a tick → onJump(id): scroll there, make it current.
// Ticks are positioned in percent, so scrolling the document moves nothing
// here and nothing is measured on scroll (the V2.1 pin perf rule); the page
// re-measures only on content changes and resizes (data-er-measures counts).
import { useEffect, useRef, useState } from 'react'

import { displayStatus } from './model.js'
import { Markdown, Tip, cx } from './ui.jsx'

export function NavButtons({ t, canNav, onNav }) {
  return (
    <>
      <Tip label={t('review.prevUnhandled')}>
        <button type="button" className="er-icon-btn" data-er-nav="prev" aria-label={t('review.prevUnhandled')} disabled={!canNav} onClick={() => onNav(-1)}>
          <i className="codicon codicon-chevron-up" aria-hidden="true" />
        </button>
      </Tip>
      <Tip label={t('review.nextUnhandled')}>
        <button type="button" className="er-icon-btn" data-er-nav="next" aria-label={t('review.nextUnhandled')} disabled={!canNav} onClick={() => onNav(1)}>
          <i className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
      </Tip>
    </>
  )
}

/** The page toolbar's list switch (V3-D2 #1): the usual sidebar glyph, the
 *  unhandled count only while the list is folded away. No key hint (⌘⌥B is
 *  shown in Settings only). While the list is a rail this is its only expand
 *  (R11-I): the rail carries no switch of its own. */
export function PanelSwitch({ t, open, unhandled, onToggle }) {
  const label = open ? t('review.listCollapse') : t('review.listExpand')
  return (
    <Tip label={label}>
      <button type="button" className={cx('er-panel-switch', !open && 'is-folded')} data-er-list-toggle="" data-er-panel-switch="" aria-label={label} aria-expanded={open} onClick={onToggle}>
        <i className={cx('codicon', open ? 'codicon-layout-sidebar-right' : 'codicon-layout-sidebar-right-off')} aria-hidden="true" />
        {!open && unhandled > 0 ? (
          <span className="er-unhandled" data-er-unhandled="" aria-hidden="true">
            {unhandled}
          </span>
        ) : null}
      </button>
    </Tip>
  )
}

/** The sheet bar's switch (narrow windows only, where the toolbar has no
 *  PanelSwitch, so it is the one switch there). It carries the unhandled
 *  count itself (V3-D2-I: shown once per page). R11-I: the rail no longer
 *  uses it — the toolbar switch is the rail's expand. */
export function ListToggle({ t, open, unhandled, onToggle, children }) {
  const label = open ? t('review.listCollapse') : t('review.listExpand')
  return (
    <Tip label={label}>
      <button type="button" className="er-list-toggle" data-er-list-toggle="" aria-label={label} aria-expanded={open} onClick={onToggle}>
        <i className="codicon codicon-comment-discussion" aria-hidden="true" />
        {children}
        {unhandled == null ? null : (
          <span className="er-unhandled" data-er-unhandled="" aria-hidden={children ? undefined : 'true'}>
            {unhandled}
          </span>
        )}
      </button>
    </Tip>
  )
}

function Preview({ t, item, index, pct }) {
  const status = displayStatus(item)
  return (
    <div className="er-preview" role="tooltip" data-er-tick-preview={item.id} style={{ top: `${pct}%`, transform: `translateY(-${pct}%)` }}>
      <div className="er-card-top">
        <span className="er-index">{index}</span>
        <span className={cx('er-status', `er-status-${status}`)}>{t(`review.status.${status}`)}</span>
      </div>
      <div className="er-quote er-preview-quote">
        <Markdown text={item.text} />
      </div>
      <div className={cx('er-preview-comment', !item.comment && 'is-empty')}>{item.comment ? <Markdown text={item.comment} /> : t('review.noComment')}</div>
    </div>
  )
}

export function StatusRail({ t, items, numbering, ticks, measures, active, canNav, onNav, onJump }) {
  const [hover, setHover] = useState(null)
  const hideTimer = useRef(null)
  useEffect(() => () => clearTimeout(hideTimer.current), [])
  const show = (id) => {
    clearTimeout(hideTimer.current)
    setHover(id)
  }
  const hide = () => {
    clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setHover(null), 150)
  }
  const hovered = hover ? items.find((it) => it.id === hover) : null
  return (
    <aside className="er-rail" aria-label={t('review.railLabel')} data-er-rail="" data-er-measures={measures}>
      <div className="er-rail-top">
        <NavButtons t={t} canNav={canNav} onNav={onNav} />
      </div>
      <div className="er-rail-track" onMouseOut={hide}>
        {items.map((it) => {
          const pct = ticks.get(it.id)
          if (pct == null) return null
          const status = displayStatus(it)
          return (
            <button
              key={it.id}
              type="button"
              className={cx('er-tick', `er-tick-${status}`, active === it.id && 'is-active')}
              style={{ top: `${pct}%` }}
              data-er-tick={it.id}
              data-er-tick-status={status}
              aria-label={`${numbering.get(it.id)}. ${t(`review.status.${status}`)} · ${it.text.slice(0, 60)}`}
              onMouseOver={() => show(it.id)}
              onFocus={() => show(it.id)}
              onBlur={hide}
              onClick={() => {
                setHover(null)
                onJump(it.id)
              }}
            />
          )
        })}
        {hovered && ticks.get(hovered.id) != null ? (
          <div onMouseOver={() => show(hovered.id)}>
            <Preview t={t} item={hovered} index={numbering.get(hovered.id)} pct={ticks.get(hovered.id)} />
          </div>
        ) : null}
      </div>
    </aside>
  )
}
