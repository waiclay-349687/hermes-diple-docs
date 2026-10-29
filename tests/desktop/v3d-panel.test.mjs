// V3-D: the review list (标注清单) can be collapsed into a status rail, resized,
// remembered globally, and turns into a bottom sheet in a narrow page; the rail
// has one tick per annotation (hover preview, click jumps); 上一条 / 下一条未处理.
// Seam: register(ctx) with the SDK stub, as v2d-page. Real painting and
// geometry: tests/e2e/v3d-panel.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, loadModule, makeCtx, tick } from './harness.mjs'

const w = setupDom()
class FakeHighlight {
  constructor(...ranges) {
    this.ranges = ranges
    this.priority = 0
  }
}
globalThis.CSS = { highlights: new Map() }
globalThis.Highlight = FakeHighlight
const React = await import('react')
const { act, createElement } = React
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple-docs')
const sdk = globalThis.__sdk
w.HTMLElement.prototype.scrollIntoView ??= function () {}
const rangeTops = new Map() // range text → top
w.Range.prototype.getBoundingClientRect = function () {
  const top = rangeTops.get(this.toString()) ?? 200
  return { top, bottom: top + 20, left: 10, right: 80, width: 70, height: 20 }
}
w.Range.prototype.getClientRects = function () {
  return [this.getBoundingClientRect()]
}
Object.defineProperty(w.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 })

// ResizeObserver stand-in: tests push widths to the page's observer
const observers = new Set()
globalThis.ResizeObserver = w.ResizeObserver = class {
  constructor(fn) {
    this.fn = fn
    this.els = new Set()
    observers.add(this)
  }
  observe(el) {
    this.els.add(el)
  }
  unobserve(el) {
    this.els.delete(el)
  }
  disconnect() {
    observers.delete(this)
  }
}
const resize = (el, width) =>
  act(async () => {
    for (const o of observers) if (o.els.has(el)) o.fn([{ target: el, contentRect: { width, height: 700 } }])
  })

const DOC = '# 缓存方案\n\n先**更新数据库**，再删除缓存。\n\n第二段说明文字。\n\n第三段也有文字。\n\n第四段收尾。\n'
const PATH = '/work/plan.md'

function item(id, text, line, extra = {}) {
  return { id, path: PATH, anchor: { text, before: '', after: '', line }, text, comment: '', status: 'pending', lost: false, revision: 1, mutation: 1, sentSessions: [], queued: null, createdAt: Number(id.slice(1)), updatedAt: 0, ...extra }
}

function fakeBackend(text = DOC) {
  const b = { text, items: [], version: 0 }
  b.rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    const route = new URL(p, 'http://x').pathname
    if (route === '/file') return { path: PATH, text: b.text, mtime: 1, size: b.text.length }
    if (route === '/review/state') return { exists: true, mtime: 1, itemsVersion: String(b.version) }
    if (route === '/items' && method === 'GET') return { items: b.items.map((i) => ({ ...i })), itemsVersion: String(b.version) }
    if (route === '/items/locate') {
      for (const r of opts.body.results) {
        const it = b.items.find((i) => i.id === r.id)
        if (it && r.lost) it.lost = true
        else if (it) Object.assign(it, { lost: false, anchor: r.anchor })
      }
      return { changed: opts.body.results.length }
    }
    if (route === '/reviews/recent' && method === 'GET') return { reviews: [] }
    if (route === '/reviews/recent') return { ok: true }
    if (route === '/sessions/titles') return { titles: {} }
    if (route === '/settings') return { autoCard: true }
    if (route === '/handoffs/rebroadcast-pending') return { rebroadcast: [] }
    if (route === '/handoffs/unconfirmed') return { handoffs: [] }
    throw Object.assign(new Error(`unhandled ${method} ${p}`), { status: 404 })
  }
  return b
}

function fresh({ items = [], stored = {} } = {}) {
  sdk.notifications.length = 0
  sdk.workspaces.clear()
  sdk.pluginDecisions.set({})
  sdk.locale.set('zh')
  sdk.state.focusedStoredSessionId.set('local-s1')
  const backend = fakeBackend()
  backend.items.push(...items)
  const h = makeCtx({ rest: backend.rest })
  for (const [k, v] of Object.entries(stored)) h.store.set(k, JSON.stringify(v))
  h.ctx.setInterval = () => () => {}
  h.ctx.setTimeout = () => () => {}
  h.ctx.registerSettingsPage = () => () => {}
  h.ctx.os = { pickOpenPath: async () => PATH, revealPath: async () => true }
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  return { h, backend }
}

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => tick(0))
}

async function openPage(env) {
  env.h.find('palette', (c) => c.data.id === 'diple-docs.open').data.run()
  await flush()
  const ws = sdk.workspaces.get(`diple-docs:${PATH}`)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(createElement(() => ws.render())))
  await flush()
  const wrap = el.querySelector('.er-docwrap')
  wrap.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 600, width: 600 })
  const scrolls = []
  wrap.scrollTo = (o) => scrolls.push(o)
  return { el, wrap, scrolls, unmount: () => act(async () => root.unmount()).then(() => el.remove()) }
}

const click = async (node) => {
  assert.ok(node, 'element to click')
  await act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await flush()
}
const fire = (node, type) => act(async () => node.dispatchEvent(new w.MouseEvent(type, { bubbles: true })))
const mode = (el) => el.querySelector('.er-body').dataset.erListMode
const painted = (name) => (globalThis.CSS.highlights.get(name)?.ranges ?? []).map((r) => r.toString())
const ITEMS = () => [
  item('r0001', '缓存方案', 1, { status: 'sent', comment: 'a' }),
  item('r0002', '更新数据库', 3, { comment: '先说**为什么**' }),
  item('r0003', '第二段', 5, { status: 'resolved' }),
  item('r0004', '第三段', 7, { status: 'answered', comment: 'b' }),
  item('r0005', '不在文档里的句子', 9, { comment: 'c' })
]

test('the list switch (V3-D2: in the page toolbar): collapse; the unhandled count (待发 + 原文已变 + 已回应, not 已发 / 已解决) while folded', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  assert.equal(mode(page.el), 'open')
  const btn = page.el.querySelector('[data-er-list-toggle]')
  assert.ok(btn.closest('.er-head'), 'the page toolbar')
  assert.equal(btn.getAttribute('aria-label'), '收起标注清单')
  assert.equal(btn.getAttribute('aria-expanded'), 'true')
  await click(btn)
  assert.equal(page.el.querySelector('.er-head [data-er-list-toggle] [data-er-unhandled]').textContent, '3')
  await page.unmount()
})

test('collapse → rail with one tick per annotation, coloured by status; the state is remembered globally', async () => {
  rangeTops.clear()
  rangeTops.set('缓存方案', 100).set('更新数据库', 300).set('第二段', 500).set('第三段', 700).set('第四段收尾。', 900)
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-list-toggle]'))
  assert.equal(mode(page.el), 'rail')
  assert.equal(page.el.querySelector('[data-diple-docs-list]'), null, 'the list is gone')
  const rail = page.el.querySelector('[data-er-rail]')
  assert.ok(rail)
  const ticks = [...rail.querySelectorAll('[data-er-tick]')]
  assert.deepEqual(
    ticks.map((t) => [t.dataset.erTick, t.dataset.erTickStatus]),
    [['r0001', 'sent'], ['r0002', 'pending'], ['r0003', 'resolved'], ['r0004', 'answered'], ['r0005', 'changed']]
  )
  assert.equal(ticks[0].style.top, '10%', 'its place in the document: range top / scroll height')
  assert.equal(ticks[3].style.top, '70%')
  assert.equal(rail.querySelector('[data-er-list-toggle]'), null, 'R11-I: the rail has no expand of its own')
  assert.equal(page.el.querySelector('.er-head [data-er-panel-switch]').getAttribute('aria-label'), '展开标注清单', 'the toolbar switch expands')
  assert.equal(rail.querySelector('[data-er-unhandled]'), null, 'V3-D2-I: the count shows once, on the toolbar switch')
  assert.equal(page.el.querySelectorAll('[data-er-unhandled]').length, 1)
  assert.equal(page.el.querySelector('.er-head [data-er-panel-switch] [data-er-unhandled]').textContent, '3')
  assert.equal(rail.querySelector('.er-rail-top').textContent.trim(), '', 'the rail top: just the two arrows (icons)')
  assert.deepEqual([...rail.querySelectorAll('.er-rail-top button')].map((b) => b.dataset.erNav), ['prev', 'next'])
  assert.deepEqual(JSON.parse(env.h.store.get('listPanel')), { collapsed: true, width: 340, sheetOpen: true })
  await page.unmount()
  // a new page (another file, a restart) opens collapsed
  const env2 = fresh({ items: ITEMS(), stored: { listPanel: { collapsed: true, width: 420, sheetOpen: false } } })
  const page2 = await openPage(env2)
  assert.equal(mode(page2.el), 'rail')
  await click(page2.el.querySelector('.er-head [data-er-panel-switch]'))
  assert.equal(mode(page2.el), 'open')
  assert.equal(page2.el.querySelector('.er-body').style.getPropertyValue('--er-list-w'), '420px', 'the remembered width')
  await page2.unmount()
})

test('rail ticks: hover shows a preview (quote + comment as Markdown); click jumps there and makes it current', async () => {
  rangeTops.clear()
  rangeTops.set('第三段', 1500)
  const env = fresh({ items: ITEMS(), stored: { listPanel: { collapsed: true, width: 340, sheetOpen: false } } })
  const page = await openPage(env)
  const tickEl = page.el.querySelector('[data-er-tick="r0002"]')
  await fire(tickEl, 'mouseover')
  await flush()
  const pv = page.el.querySelector('[data-er-tick-preview]')
  assert.ok(pv, 'preview open')
  assert.match(pv.textContent, /更新数据库/)
  assert.equal(pv.querySelector('.er-preview-comment strong')?.textContent, '为什么', 'the comment is rendered Markdown')
  assert.match(pv.textContent, /待发/)
  await fire(tickEl, 'mouseout')
  await act(async () => tick(250))
  assert.equal(page.el.querySelector('[data-er-tick-preview]'), null, 'leaves with the pointer')
  await click(page.el.querySelector('[data-er-tick="r0004"]'))
  assert.equal(page.scrolls.length, 1)
  assert.equal(page.scrolls[0].behavior, 'smooth')
  assert.deepEqual(painted('er-active'), ['第三段'], 'current: the deeper fill, no flash')
  assert.equal(mode(page.el), 'rail', 'the list stays collapsed')
  await page.unmount()
})

test('上一条 / 下一条未处理: document order over 待发, 原文已变 and 已回应; skips 已发 and 已解决; wraps', async () => {
  rangeTops.clear()
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  const next = page.el.querySelector('[data-er-nav="next"]')
  const prev = page.el.querySelector('[data-er-nav="prev"]')
  const activeCard = () => page.el.querySelector('.er-card.is-active')?.dataset.erItem
  await click(next)
  assert.equal(activeCard(), 'r0002')
  await click(next)
  assert.equal(activeCard(), 'r0004')
  await click(next)
  assert.equal(activeCard(), 'r0005', 'the 原文已变 one, at its old place')
  await click(next)
  assert.equal(activeCard(), 'r0002', 'wraps')
  await click(prev)
  assert.equal(activeCard(), 'r0005')
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click(next)
  assert.equal(activeCard(), 'r0002', 'from a handled one: the next unhandled after it')
  // on the rail, the same two buttons at its top
  await click(page.el.querySelector('[data-er-list-toggle]'))
  assert.ok(page.el.querySelector('[data-er-rail] [data-er-nav="next"]'))
  await click(page.el.querySelector('[data-er-rail] [data-er-nav="next"]'))
  assert.equal(page.el.querySelector('[data-er-tick].is-active')?.dataset.erTick, 'r0004')
  await page.unmount()
})

test('nothing unhandled: the arrows are disabled', async () => {
  const env = fresh({ items: [item('r0001', '缓存方案', 1, { status: 'sent' })] })
  const page = await openPage(env)
  assert.equal(page.el.querySelector('[data-er-nav="next"]').disabled, true)
  assert.equal(page.el.querySelector('[data-er-unhandled]'), null, 'V3-D2: no count while the list is open')
  await page.unmount()
})

test('the resize handle: ← widens by 16px and is remembered; Enter collapses', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  const handle = page.el.querySelector('[data-er-resize]')
  assert.equal(handle.getAttribute('role'), 'separator')
  await act(async () => handle.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  assert.equal(page.el.querySelector('.er-body').style.getPropertyValue('--er-list-w'), '356px')
  assert.equal(JSON.parse(env.h.store.get('listPanel')).width, 356)
  await act(async () => page.el.querySelector('[data-er-resize]').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  assert.equal(mode(page.el), 'rail')
  await page.unmount()
})

test('the keybind: 切换标注清单 (⌘⌥B, shown only in Settings › Keyboard) toggles the visible page; 上一条/下一条 can be bound', async () => {
  const env = fresh({ items: ITEMS() })
  const kb = (id) => env.h.find('keybinds', (c) => c.data.id === id)
  assert.deepEqual(kb('diple-docs.toggleList').data.defaults, ['mod+alt+b'])
  assert.deepEqual(kb('diple-docs.nextUnhandled').data.defaults, [])
  assert.deepEqual(kb('diple-docs.prevUnhandled').data.defaults, [])
  const page = await openPage(env)
  await act(async () => kb('diple-docs.toggleList').data.run())
  await flush()
  assert.equal(mode(page.el), 'rail')
  await act(async () => kb('diple-docs.nextUnhandled').data.run())
  await flush()
  assert.equal(page.el.querySelector('[data-er-tick].is-active')?.dataset.erTick, 'r0002')
  await act(async () => kb('diple-docs.toggleList').data.run())
  await flush()
  assert.equal(mode(page.el), 'open')
  await page.unmount()
})

test('V3-D2-I: the list stays beside the document down to a 560px page (a review page docked beside chat); the document keeps ≥ 300px, the list shrinks first (≥ 260px)', async () => {
  const { PANEL, fitList } = await loadModule('diple-docs', 'plugins/diple-docs/desktop/src/review/list-panel.js')
  assert.equal(PANEL.NARROW, 560)
  assert.equal(PANEL.DOC_MIN + PANEL.MIN, PANEL.NARROW, 'the threshold is exactly where the list cannot shrink any more')
  assert.deepEqual(fitList(1100, 340), { narrow: false, width: 340, max: 560 })
  assert.deepEqual(fitList(590, 340), { narrow: false, width: 290, max: 290 }, '590px page: the list gives way, the document keeps 300px')
  assert.deepEqual(fitList(560, 340), { narrow: false, width: 260, max: 260 })
  assert.deepEqual(fitList(559, 340), { narrow: true, width: 260, max: 260 })
  assert.deepEqual(fitList(700, 500), { narrow: false, width: 400, max: 400 })
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  const body = () => page.el.querySelector('.er-body')
  for (const [w, want] of [[590, 290], [600, 300], [720, 340]]) {
    await resize(page.el.querySelector('.er-page'), w)
    await flush()
    assert.equal(mode(page.el), 'open', `${w}px stays beside`)
    assert.equal(body().style.getPropertyValue('--er-list-w'), `${want}px`, `${w}px → list ${want}px`)
    assert.equal(page.el.querySelector('[data-er-resize]')?.getAttribute('aria-valuemax'), String(Math.min(560, w - 300)))
  }
  assert.equal(JSON.parse(env.h.store.get('listPanel') ?? '{"width":340}').width, 340, 'squeezing never rewrites the remembered width')
  await resize(page.el.querySelector('.er-page'), 559)
  await flush()
  assert.equal(mode(page.el), 'sheet')
  await page.unmount()
})

test('narrow page (< 560px): a bottom sheet with its bar, open by default (the V2 layout); folding is remembered apart from the wide collapse', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  await resize(page.el.querySelector('.er-page'), 540)
  await flush()
  assert.equal(mode(page.el), 'sheet')
  const bar = page.el.querySelector('[data-er-sheet-bar]')
  assert.ok(bar)
  assert.equal(page.el.querySelector('.er-body').dataset.erSheet, 'open')
  assert.ok(page.el.querySelector('[data-diple-docs-list]'))
  assert.equal(page.el.querySelector('[data-er-resize]'), null, 'no resize handle in the sheet')
  const toggle = bar.querySelector('[data-er-list-toggle]')
  assert.match(toggle.textContent, /5/)
  await click(toggle)
  assert.equal(page.el.querySelector('.er-body').dataset.erSheet, 'closed')
  assert.equal(page.el.querySelector('[data-diple-docs-list]'), null)
  assert.equal(JSON.parse(env.h.store.get('listPanel')).sheetOpen, false)
  assert.equal(JSON.parse(env.h.store.get('listPanel')).collapsed, false, 'the wide state is untouched')
  await click(page.el.querySelector('[data-er-sheet-bar] [data-er-list-toggle]'))
  assert.equal(page.el.querySelector('.er-body').dataset.erSheet, 'open')
  await resize(page.el.querySelector('.er-page'), 1100)
  await flush()
  assert.equal(mode(page.el), 'open')
  await page.unmount()
})

test('R11-I: one switch per layout, and the keyboard stays on it (toolbar when wide, sheet bar when narrow), never scrolling', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  const calls = []
  const focus = w.HTMLElement.prototype.focus
  w.HTMLElement.prototype.focus = function (opts) {
    calls.push(opts)
    return focus.call(this, opts)
  }
  try {
    const sw = () => page.el.querySelector('.er-head [data-er-panel-switch]')
    sw().focus()
    calls.length = 0
    await click(sw())
    assert.equal(mode(page.el), 'rail')
    assert.equal(page.el.querySelectorAll('[data-er-list-toggle]').length, 1, 'folded: the toolbar switch only')
    assert.equal(document.activeElement, sw(), 'collapse: focus on the toolbar switch')
    await click(sw())
    assert.equal(mode(page.el), 'open')
    assert.equal(document.activeElement, sw(), 'expand: still the toolbar switch')
    assert.ok(calls.length > 0 && calls.every((o) => o?.preventScroll === true), 'refocus never scrolls')
    await resize(page.el.querySelector('.er-page'), 540)
    await flush()
    assert.equal(mode(page.el), 'sheet')
    const bar = () => page.el.querySelector('[data-er-sheet-bar] [data-er-list-toggle]')
    assert.equal(page.el.querySelectorAll('[data-er-list-toggle]').length, 1, 'narrow: the sheet bar switch only')
    bar().focus()
    calls.length = 0
    await click(bar())
    assert.equal(document.activeElement, bar(), 'sheet folded: focus on the sheet bar switch')
    await click(bar())
    assert.equal(document.activeElement, bar(), 'sheet open: still there')
    assert.ok(calls.length > 0 && calls.every((o) => o?.preventScroll === true))
  } finally {
    w.HTMLElement.prototype.focus = focus
  }
  await page.unmount()
})

test('pin perf rule: scrolling the document never measures; a content change does', async () => {
  const env = fresh({ items: ITEMS(), stored: { listPanel: { collapsed: true, width: 340, sheetOpen: false } } })
  const page = await openPage(env)
  const rail = page.el.querySelector('[data-er-rail]')
  const before = Number(rail.dataset.erMeasures)
  assert.ok(before >= 1)
  for (let i = 0; i < 20; i++) await act(async () => page.wrap.dispatchEvent(new w.Event('scroll')))
  await flush()
  assert.equal(Number(rail.dataset.erMeasures), before, 'no measuring on scroll')
  await resize(page.wrap, 500)
  await flush()
  assert.ok(Number(rail.dataset.erMeasures) > before, 'a resize measures again')
  await page.unmount()
})

test('B7: a 原文已变 (lost) annotation is exported without its stale line number', async () => {
  const { handoffItem, exportLine } = await loadModule('diple-docs', 'plugins/diple-docs/desktop/src/review/model.js')
  const lost = item('r0009', 'x', 12, { lost: true })
  assert.equal(exportLine(lost), null)
  assert.equal('line' in handoffItem(lost).origin, false)
  assert.equal(handoffItem(item('r0010', 'y', 4)).origin.line, 4)
})
