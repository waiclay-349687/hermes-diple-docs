// Small surfaces: the "open review" transcript card, the recent-reviews tab
// and the settings page.
import { useEffect, useState, useSyncExternalStore } from 'react'

import { basename, dirname } from './page.jsx'
import { isAbsolutePath, isReviewPath } from './paths.js'
import { languageOptions } from '@diple/desktop-kit'
import { Button, Choice, Icon, Toggle, cx } from './ui.jsx'

/** ::diple-docs{path="…"} — rendered at the end of an answer that wrote a .md file. */
export function OpenReviewCard({ rt, attrs, streaming }) {
  const t = rt.i18n.useT()
  const path = typeof attrs?.path === 'string' ? attrs.path.trim() : ''
  const valid = isReviewPath(path) && isAbsolutePath(path)
  // V3-D2: counts come from the shared loader (item-counts.js) — one coalesced,
  // retried request for every card on screen, not one GET /items per card.
  const [counts, setCounts] = useState(() => (valid ? rt.itemCounts.peek(path) : null))
  useEffect(() => {
    if (!valid || streaming) return
    setCounts(rt.itemCounts.peek(path))
    return rt.itemCounts.watch(path, setCounts)
  }, [rt, path, valid, streaming])
  const count = counts?.open ?? null
  if (!valid)
    return (
      <div className={cx('er-dcard', 'is-invalid')} data-diple-docs-card="invalid">
        {t('review.card.invalid')}
      </div>
    )
  return (
    <div className="er-dcard" data-diple-docs-card={path}>
      <Icon name="comment-discussion" />
      <div className="er-dcard-main">
        <span className="er-dcard-name" title={path}>
          {t('review.card.title')} · {basename(path)}
        </span>
        <span className="er-dcard-sub" title={path}>
          {count ? `${t('review.card.items', count)} · ` : ''}
          {dirname(path) || t('review.card.hint')}
        </span>
      </div>
      <Button size="sm" disabled={streaming} onClick={() => rt.openReview(path)} data-er-open-review="">
        {t('review.card.open')}
      </Button>
    </div>
  )
}

export function RecentPage({ rt }) {
  const t = rt.i18n.useT()
  const [rows, setRows] = useState(null)
  const load = () =>
    rt.api
      .recentReviews(30)
      .then((r) => setRows(r.reviews ?? []))
      .catch(() => setRows([]))
  useEffect(() => {
    load()
  }, [])
  return (
    <div className="er-page">
      <div className="er-home">
        <div className="er-head-tools">
          <h2>{t('review.home.title')}</h2>
          <span className="er-spacer" style={{ flex: 1 }} />
          <Button size="sm" onClick={() => rt.pickAndOpen()}>
            {t('review.home.open')}
          </Button>
        </div>
        {rows === null ? null : rows.length === 0 ? (
          <div className="er-state">{t('review.home.empty')}</div>
        ) : (
          <div role="list" className="er-home-list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((r) => (
              <div key={r.path} role="listitem" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button type="button" className="er-home-row" onClick={() => rt.openReview(r.path)} title={r.path}>
                  <Icon name="markdown" />
                  <span className="er-dcard-main">
                    <span className="er-dcard-name">{basename(r.path)}</span>
                    <span className="er-dcard-sub">{dirname(r.path)}</span>
                  </span>
                  {r.openItems ? <span className="er-chip">{t('review.home.openItems', r.openItems)}</span> : null}
                </button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`${t('review.home.remove')} ${basename(r.path)}`}
                  onClick={async () => {
                    await rt.forgetRecent(r.path)
                    load()
                  }}
                >
                  {t('review.home.remove')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsPage({ rt }) {
  const t = rt.i18n.useT()
  const s = useSyncExternalStore(rt.settings.subscribe, rt.settings.get)
  return (
    <div className="er-settings" data-diple-docs-settings="">
      <div className="er-settings-hint" data-diple-docs-about="">{t('review.settings.about')}</div>
      {rt.selfcheck?.features?.length ? (
        <div className="er-settings-degraded" role="status" data-diple-docs-degraded="">
          {t(
            'review.selfcheck.settingsLine',
            rt.selfcheck.features.map((f) => t(`review.selfcheck.feature.${f.feature}`)).join(t('review.selfcheck.separator'))
          )}
        </div>
      ) : null}
      <div className="er-settings-row">
        <div>
          <label>{t('review.settings.language')}</label>
        </div>
        <Choice
          id="er-language"
          label={t('review.settings.language')}
          value={s.language}
          onChange={(language) => rt.settings.set({ language })}
          options={languageOptions(t('review.settings.languageAuto'))}
        />
      </div>
      <div className="er-settings-row">
        <div>
          <label htmlFor="er-autocard">{t('review.settings.autoCard')}</label>
          <div className="er-settings-hint">{t('review.settings.autoCardHint')}</div>
        </div>
        <Toggle id="er-autocard" label={t('review.settings.autoCard')} checked={s.autoCard} onChange={(autoCard) => rt.settings.set({ autoCard })} />
      </div>
      <div className="er-settings-hint">{t('review.settings.shortcut')}</div>
      <div className="er-settings-hint" data-er-list-shortcut="">{t('review.settings.listShortcut')}</div>
      <div>
        <Button size="sm" variant="ghost" onClick={() => rt.settings.set({ autoCard: true })}>
          {t('review.settings.reset')}
        </Button>
      </div>
    </div>
  )
}
