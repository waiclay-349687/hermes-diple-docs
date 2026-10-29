// V3-D2 P1: a review tab opens where Hermes opens a preview (preview-tile.tsx
// existingPreviewAnchor / watchPreviewTileMirror): the first one docks right of
// the main zone, later ones stack as tabs into the review or preview zone.
import test from 'node:test'
import assert from 'node:assert/strict'

import { JSDOM } from 'jsdom'

import { setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'
import { dockFor, readLayoutPanes, REVIEW_MIN_WIDTH } from '../../plugins/diple-docs/desktop/src/review/placement.js'

const RIGHT = { pane: 'workspace', pos: 'right' }
const own = (paneId, at = 0) => ({ paneId, at })

test('dockFor: nothing open → dock right of the main zone (chat stays visible)', () => {
  assert.deepEqual(dockFor({ own: [], layout: ['workspace'], now: 10_000 }), RIGHT)
  assert.deepEqual(dockFor({ own: [], layout: null, now: 10_000 }), RIGHT)
})

test('dockFor: an open review tab wins — stack into its zone', () => {
  const layout = ['workspace', 'preview-tile:t1', 'plugin-workspace:diple-docs:/a.md']
  const d = dockFor({ own: [own('plugin-workspace:diple-docs:/a.md')], layout, now: 10_000 })
  assert.deepEqual(d, { pane: 'plugin-workspace:diple-docs:/a.md', pos: 'center' })
})

test('dockFor: no review tab, a Hermes preview open → stack into the preview zone', () => {
  const d = dockFor({ own: [], layout: ['workspace', 'preview-tile:abc', 'preview-tile:def'], now: 10_000 })
  assert.deepEqual(d, { pane: 'preview-tile:abc', pos: 'center' })
})

test('dockFor: an own tab missing from the layout is skipped, unless it was opened in this pass', () => {
  const stale = own('plugin-workspace:diple-docs:/gone.md', 0)
  assert.deepEqual(dockFor({ own: [stale], layout: ['workspace'], now: 60_000 }), RIGHT, 'a missing anchor would land on main (store.ts adoption)')
  const fresh = own('plugin-workspace:diple-docs:/new.md', 59_900)
  assert.deepEqual(dockFor({ own: [stale, fresh], layout: ['workspace'], now: 60_000 }), { pane: fresh.paneId, pos: 'center' })
})

test('dockFor: layout unreadable → trust own tabs, else right', () => {
  assert.deepEqual(dockFor({ own: [own('plugin-workspace:diple-docs:/a.md')], layout: null, now: 1e9 }), {
    pane: 'plugin-workspace:diple-docs:/a.md',
    pos: 'center'
  })
})

test('readLayoutPanes reads the tab strip ids; no tabs at all → null (unreadable)', () => {
  const d = new JSDOM('<!doctype html><body><div data-tree-tab="workspace"></div><div data-tree-tab="preview-tile:x"></div><div data-pane-host="preview-tile:hidden"></div></body>')
  assert.deepEqual(readLayoutPanes(d.window.document), ['workspace', 'preview-tile:x'])
  assert.equal(readLayoutPanes(new JSDOM('<!doctype html><body></body>').window.document), null)
  assert.equal(readLayoutPanes(undefined), null)
})

test('REVIEW_MIN_WIDTH matches the preview tile', () => assert.equal(REVIEW_MIN_WIDTH, '22rem'))

// --- through register(ctx): every opening path shares the rule ------------------------
const w = setupDom()
const { act } = await import('react')
const plugin = await loadPlugin('diple-docs')
const sdk = globalThis.__sdk
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await act(async () => tick(0))
}

function fresh({ saved, layout = '' } = {}) {
  document.body.innerHTML = layout
  sdk.workspaces.clear()
  sdk.notifications.length = 0
  const rest = async (p) => {
    if (p.startsWith('/reviews/recent')) return { reviews: [{ path: '/w/a.md', lastOpenedAt: 1, openItems: 0, items: 0 }] }
    if (p === '/items/summary') return { counts: {} }
    return {}
  }
  const h = makeCtx({ rest })
  if (saved) h.ctx.storage.set('openTabs', saved)
  h.ctx.setTimeout = (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  }
  h.ctx.setInterval = () => () => {}
  h.ctx.os = { pickOpenPath: async () => '/w/a.md' }
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  return h
}

test('palette open: first review docks right with 22rem; the second stacks into the first', async () => {
  const h = fresh({ layout: '<div data-tree-tab="workspace"></div>' })
  await flush()
  sdk.workspaces.clear()
  const open = h.find('palette', (c) => c.data.id === 'diple-docs.recent.0').data.run
  open()
  const a = sdk.workspaces.get('diple-docs:/w/a.md')
  assert.deepEqual(a.dock, RIGHT)
  assert.equal(a.minWidth, '22rem')
  // second document via the transcript card
  const render = h.find('transcript.directives').data.render
  const el = render({ attrs: { path: '/w/b.md' }, streaming: false })
  // the card's Open button calls rt.openReview (S46); call it straight
  el.props.rt.openReview('/w/b.md')
  assert.deepEqual(sdk.workspaces.get('diple-docs:/w/b.md').dock, { pane: 'plugin-workspace:diple-docs:/w/a.md', pos: 'center' })
  h.dispose()
})

test('an open Hermes preview: the review stacks into the preview zone', async () => {
  const h = fresh({ layout: '<div data-tree-tab="workspace"></div><div data-tree-tab="preview-tile:p1"></div>' })
  await flush()
  sdk.workspaces.clear()
  h.find('palette', (c) => c.data.id === 'diple-docs.recent.0').data.run()
  assert.deepEqual(sdk.workspaces.get('diple-docs:/w/a.md').dock, { pane: 'preview-tile:p1', pos: 'center' })
  h.dispose()
})

test('restoring tabs after a reload: the first docks right, the rest stack into it', async () => {
  const now = Date.now()
  const h = fresh({
    layout: '<div data-tree-tab="workspace"></div>',
    saved: [
      { path: '/w/a.md', at: now },
      { path: '/w/b.md', at: now },
      { path: '/w/c.md', at: now }
    ]
  })
  await flush()
  assert.deepEqual(sdk.workspaces.get('diple-docs:/w/a.md').dock, RIGHT)
  assert.deepEqual(sdk.workspaces.get('diple-docs:/w/b.md').dock, { pane: 'plugin-workspace:diple-docs:/w/a.md', pos: 'center' })
  assert.deepEqual(sdk.workspaces.get('diple-docs:/w/c.md').dock.pos, 'center')
  h.dispose()
})

test('the recent-reviews tab follows the same rule', async () => {
  const h = fresh({ layout: '<div data-tree-tab="workspace"></div>' })
  await flush()
  h.find('palette', (c) => c.data.id === 'diple-docs.recent').data.run()
  const tab = sdk.workspaces.get('diple-docs:recent')
  assert.deepEqual(tab.dock, RIGHT)
  assert.equal(tab.minWidth, '22rem')
  h.find('palette', (c) => c.data.id === 'diple-docs.recent.0').data.run()
  assert.deepEqual(sdk.workspaces.get('diple-docs:/w/a.md').dock, { pane: 'plugin-workspace:diple-docs:recent', pos: 'center' })
  h.dispose()
  void w
})
