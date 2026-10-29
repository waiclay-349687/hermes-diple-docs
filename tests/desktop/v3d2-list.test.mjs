// V3-D2 (L): the list and the editor of Diple Docs.
//   - the page toolbar has the one list switch (no key hint), the list head none
//   - the list's ⋯ menu: 清除全部 / 已解决 / 已发送·已回应 / 原文已变 / 当前筛选, 全部标为
//     已解决, 复制全部为 Markdown; clears ask nothing and offer 撤销 (bulk endpoints)
//   - select → 标注: the editor floats under the passage, the list layout unchanged;
//     a card's 编辑意见 opens it too; a 原文已变 card keeps its own editor
//   - the list head: title + count, nav, ⋯ / filters on one row / send; empty hint
// Seam: register(ctx) with the SDK stub (as v3d-panel); geometry: tests/e2e/v3d2-list.mjs.
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
w.Range.prototype.getBoundingClientRect = function () {
  return { top: 200, bottom: 220, left: 40, right: 140, width: 100, height: 20 }
}
w.Range.prototype.getClientRects = function () {
  return [this.getBoundingClientRect()]
}
Object.defineProperty(w.HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 1000 })
globalThis.ResizeObserver = w.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const DOC = '# 缓存方案\n\n先**更新数据库**，再删除缓存。\n\n第二段说明文字。\n\n第三段也有文字。\n\n第四段收尾。\n'
const PATH = '/work/plan.md'

function item(id, text, line, extra = {}) {
  return { id, path: PATH, anchor: { text, before: '', after: '', line }, text, comment: '', status: 'pending', lost: false, revision: 1, mutation: 1, sentSessions: [], queued: null, createdAt: Number(id.slice(1)), updatedAt: 0, ...extra }
}

function fakeBackend(text = DOC) {
  const b = { text, items: [], version: 0, calls: [], seq: 100 }
  b.rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    const body = opts.body
    b.calls.push({ path: p, method, body })
    const route = new URL(p, 'http://x').pathname
    if (route === '/file') return { path: PATH, text: b.text, mtime: 1, size: b.text.length }
    if (route === '/review/state') return { exists: true, mtime: 1, itemsVersion: String(b.version) }
    if (route === '/items' && method === 'GET') return { items: b.items.map((i) => ({ ...i })), itemsVersion: String(b.version) }
    if (route === '/items' && method === 'POST') {
      const it = item(`r${++b.seq}`, body.anchor.text, body.anchor.line, { anchor: body.anchor, comment: body.comment ?? '' })
      b.items.push(it)
      b.version++
      return { ...it, duplicate: false }
    }
    if (route.startsWith('/items/r') && method === 'PATCH') {
      const it = b.items.find((i) => `/items/${i.id}` === route)
      if (body.op === 'comment') Object.assign(it, { comment: body.comment, revision: it.revision + 1 })
      if (body.op === 'resolve') it.status = 'resolved'
      it.mutation++
      b.version++
      return { ...it }
    }
    if (route === '/items/bulk-delete') {
      const gone = b.items.filter((i) => body.ids.includes(i.id))
      b.items = b.items.filter((i) => !body.ids.includes(i.id))
      b.version++
      return { deleted: gone.map((i) => ({ ...i })) }
    }
    if (route === '/items/bulk-restore') {
      for (const it of body.items) if (!b.items.some((i) => i.id === it.id)) b.items.push({ ...it })
      b.version++
      return { restored: body.items }
    }
    if (route === '/items/bulk-resolve') {
      const changed = []
      for (const i of b.items) if (body.ids.includes(i.id) && i.status !== 'resolved') (i.status = 'resolved'), i.mutation++, changed.push(i.id)
      b.version++
      return { resolved: changed }
    }
    if (route === '/items/locate') {
      for (const r of body.results) {
        const it = b.items.find((i) => i.id === r.id)
        if (it && r.lost) it.lost = true
        else if (it) Object.assign(it, { lost: false, anchor: r.anchor })
      }
      return { changed: body.results.length }
    }
    if (route === '/reviews/recent' && method === 'GET') return { reviews: [] }
    if (route === '/reviews/recent') return { ok: true }
    if (route === '/sessions/titles') return { titles: { 'local-s1': '一个很长很长的会话标题，用来看省略号会不会出现' } }
    if (route === '/settings') return { autoCard: true }
    if (route === '/handoffs/rebroadcast-pending') return { rebroadcast: [] }
    if (route === '/handoffs/unconfirmed') return { handoffs: [] }
    throw Object.assign(new Error(`unhandled ${method} ${p}`), { status: 404 })
  }
  return b
}

function fresh({ items = [], stored = {}, locale = 'zh' } = {}) {
  sdk.notifications.length = 0
  sdk.workspaces.clear()
  sdk.pluginDecisions.set({})
  sdk.locale.set(locale)
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
  Object.defineProperty(wrap, 'clientHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(wrap, 'clientWidth', { configurable: true, get: () => 600 })
  wrap.scrollTo = () => {}
  return { el, wrap, unmount: () => act(async () => root.unmount()).then(() => el.remove()) }
}

const click = async (node) => {
  assert.ok(node, 'element to click')
  await act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await flush()
}
const mode = (el) => el.querySelector('.er-body').dataset.erListMode
const ITEMS = () => [
  item('r0001', '缓存方案', 1, { status: 'sent', comment: 'a', sentSessions: [{ sessionId: 'local-s1', batchId: 'b1' }] }),
  item('r0002', '更新数据库', 3, { comment: '先说**为什么**' }),
  item('r0003', '第二段', 5, { status: 'resolved' }),
  item('r0004', '第三段', 7, { status: 'answered', comment: 'b' }),
  item('r0005', '不在文档里的句子', 9, { comment: 'c' })
]
const setValue = (el, v) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
const key = (el, k, extra = {}) => act(async () => el.dispatchEvent(new w.KeyboardEvent('keydown', { key: k, bubbles: true, ...extra })))

function selectText(root, needle) {
  const walker = document.createTreeWalker(root, 4)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = n.data.indexOf(needle)
    if (i < 0) continue
    const r = document.createRange()
    r.setStart(n, i)
    r.setEnd(n, i + needle.length)
    document.getSelection().removeAllRanges()
    document.getSelection().addRange(r)
    return
  }
  throw new Error(`not found ${needle}`)
}
async function annotate(page, needle) {
  selectText(page.el.querySelector('[data-diple-docs-doc]'), needle)
  await act(async () => window.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'e', code: 'KeyE', metaKey: true, shiftKey: true, bubbles: true })))
  await flush()
}

const bulk = await loadModule('diple-docs', 'plugins/diple-docs/desktop/src/review/bulk.js')
const float = await loadModule('diple-docs', 'plugins/diple-docs/desktop/src/review/float.js')

// --- pure: what each bulk action takes --------------------------------------------------------
test('bulkPlan: the items each clear takes, by display status; the filter one only under a filter', () => {
  const its = ITEMS()
  its[4].lost = true
  const plan = bulk.bulkPlan(its, new Map(), 'all')
  assert.deepEqual(plan.all.map((i) => i.id), ['r0001', 'r0002', 'r0003', 'r0004', 'r0005'])
  assert.deepEqual(plan.resolved.map((i) => i.id), ['r0003'])
  assert.deepEqual(plan.sent.map((i) => i.id), ['r0001', 'r0004'], '已发送 and 已回应')
  assert.deepEqual(plan.changed.map((i) => i.id), ['r0005'])
  assert.deepEqual(plan.resolvable.map((i) => i.id), ['r0001', 'r0002', 'r0004', 'r0005'])
  assert.equal(plan.filtered, null)
  assert.deepEqual(bulk.bulkPlan(its, new Map(), 'sent').filtered.map((i) => i.id), ['r0001'])
})

test('copyAll: every annotation in document order, the original quoted, a blank line, the words', () => {
  const its = [item('r2', 'B 行\n第二行', 5, { comment: '意见 B' }), item('r1', 'A', 1)]
  assert.equal(bulk.copyAll(its, new Map()), '> A\n\n> B 行\n> 第二行\n\n意见 B')
})

// --- the toolbar switch ----------------------------------------------------------------------
test('the page toolbar has the one list switch; the list head has none; collapsed it carries the unhandled count', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  const toggles = () => [...page.el.querySelectorAll('[data-er-list-toggle]')]
  assert.equal(toggles().length, 1, 'one switch while the list is open')
  const btn = page.el.querySelector('.er-head [data-er-list-toggle]')
  assert.ok(btn, 'in the page toolbar')
  assert.equal(page.el.querySelector('[data-diple-docs-list] [data-er-list-toggle]'), null)
  assert.equal(btn.getAttribute('aria-label'), '收起标注清单')
  assert.equal(btn.getAttribute('aria-expanded'), 'true')
  assert.ok(btn.querySelector('.codicon-layout-sidebar-right'), 'the usual sidebar glyph')
  assert.equal(btn.querySelector('[data-er-unhandled]'), null, 'no count while open')
  assert.doesNotMatch(page.el.querySelector('.er-head').textContent, /⌘|⌥|Ctrl/)
  await click(btn)
  assert.equal(mode(page.el), 'rail')
  const again = page.el.querySelector('.er-head [data-er-list-toggle]')
  assert.equal(again.getAttribute('aria-label'), '展开标注清单')
  assert.equal(again.querySelector('[data-er-unhandled]').textContent, '3')
  assert.ok(page.el.querySelector('[data-er-rail]'))
  assert.equal(page.el.querySelector('[data-er-rail] [data-er-list-toggle]'), null, 'R11-I: the rail has no expand of its own')
  assert.equal(toggles().length, 1, 'one switch while folded too: the toolbar one')
  assert.equal(page.el.querySelectorAll('[data-er-unhandled]').length, 1, 'V3-D2-I: the count shows once')
  await page.unmount()
})

// --- the ⋯ menu --------------------------------------------------------------------------------
const menuItems = (el) => [...el.querySelectorAll('[data-er-more-menu] [data-er-bulk]')]
const menuItem = (el, k) => el.querySelector(`[data-er-more-menu] [data-er-bulk="${k}"]`)
const isDisabled = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true'

test('⋯: every bulk action with its count; 0 → disabled; 当前筛选 only under a filter', async () => {
  const env = fresh({ items: ITEMS().slice(0, 4) })
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-more]'))
  const labels = Object.fromEntries(menuItems(page.el).map((b) => [b.dataset.erBulk, b.textContent]))
  assert.deepEqual(Object.keys(labels), ['clear-all', 'clear-resolved', 'clear-sent', 'clear-changed', 'resolve-all', 'copy-md'])
  assert.equal(labels['clear-all'], '清除全部（4）')
  assert.equal(labels['clear-resolved'], '清除已解决（1）')
  assert.equal(labels['clear-sent'], '清除已发送/已回应（2）')
  assert.equal(labels['clear-changed'], '清除原文已变（0）')
  assert.equal(labels['resolve-all'], '全部标为已解决（3）')
  assert.equal(labels['copy-md'], '复制全部为 Markdown')
  assert.ok(isDisabled(menuItem(page.el, 'clear-changed')))
  assert.ok(!isDisabled(menuItem(page.el, 'clear-all')))
  await key(page.el.querySelector('[data-er-more-menu]'), 'Escape')
  await flush()
  await click(page.el.querySelector('[data-er-filter="sent"]'))
  await click(page.el.querySelector('[data-er-more]'))
  assert.equal(menuItem(page.el, 'clear-filter').textContent, '清除当前筛选的 1 条')
  await page.unmount()
})

test('清除已解决: no confirm, one bulk call, a toast with 撤销 that restores the same items', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-more]'))
  await click(menuItem(page.el, 'clear-resolved'))
  const del = env.backend.calls.filter((c) => c.path === '/items/bulk-delete')
  assert.equal(del.length, 1)
  assert.deepEqual(del[0].body.ids, ['r0003'])
  assert.deepEqual(del[0].body.expectMutations, { r0003: 1 })
  assert.ok(!env.backend.items.some((i) => i.id === 'r0003'))
  const note = sdk.notifications.at(-1)
  assert.equal(note.message, '已清除 1 条标注')
  assert.equal(note.action.label, '撤销')
  assert.ok(note.durationMs >= 8000, 'about 8 seconds to undo')
  await act(async () => note.action.onClick())
  await flush()
  const restore = env.backend.calls.find((c) => c.path === '/items/bulk-restore')
  assert.deepEqual(restore.body.items.map((i) => i.id), ['r0003'])
  assert.ok(env.backend.items.some((i) => i.id === 'r0003'))
  await page.unmount()
})

test('全部标为已解决 and 复制全部为 Markdown', async () => {
  const env = fresh({ items: ITEMS().slice(0, 2) })
  let copied = null
  globalThis.navigator.clipboard = { writeText: async (t) => void (copied = t) }
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-more]'))
  await click(menuItem(page.el, 'copy-md'))
  assert.equal(copied, '> 缓存方案\n\na\n\n> 更新数据库\n\n先说**为什么**')
  await click(page.el.querySelector('[data-er-more]'))
  await click(menuItem(page.el, 'resolve-all'))
  const call = env.backend.calls.find((c) => c.path === '/items/bulk-resolve')
  assert.deepEqual(call.body.ids, ['r0001', 'r0002'])
  assert.ok(env.backend.items.every((i) => i.status === 'resolved'))
  await page.unmount()
})

// --- the list head and the empty list --------------------------------------------------------
test('the list head: title + count + nav + ⋯ on one row, the filters on one row, then the send button with the target', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  const head = page.el.querySelector('.er-list-head')
  const rows = [...head.children].filter((c) => !c.matches('[data-er-resize]'))
  assert.equal(rows.length, 3)
  assert.ok(rows[0].querySelector('[data-er-list-count]'), 'the count next to the title')
  assert.equal(rows[0].querySelector('[data-er-list-count]').textContent, '5')
  assert.ok(rows[0].querySelector('[data-er-nav="next"]') && rows[0].querySelector('[data-er-more]'))
  assert.ok(rows[1].matches('.er-filters'))
  assert.ok(rows[2].querySelector('[data-er-send-menu-open]'))
  const target = rows[2].querySelector('.er-target')
  assert.match(target.getAttribute('title'), /一个很长很长的会话标题/, 'the full name on hover')
  await page.unmount()
})

test('an empty list says how to start: select words, then 标注', async () => {
  const env = fresh()
  const page = await openPage(env)
  const st = page.el.querySelector('[data-diple-docs-list] .er-state')
  assert.match(st.textContent, /选中文字.*标注/)
  assert.ok(isDisabled(page.el.querySelector('[data-er-more]')), 'nothing to manage yet')
  await page.unmount()
})

// --- the editor under the passage ------------------------------------------------------------
test('标注: the editor floats under the passage (quote, box, 保存), not in a card; Enter saves; the card becomes current', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  const ed = page.el.querySelector('[data-er-float-editor]')
  assert.ok(ed, 'floating editor')
  assert.equal(ed.closest('[data-er-item]'), null)
  assert.equal(ed.closest('[data-diple-docs-doc]'), null, 'not inside the read-only document')
  assert.match(ed.querySelector('.er-float-quote').textContent, /第二段/)
  assert.ok(ed.querySelector('[data-er-float-save]'))
  const box = ed.querySelector('textarea.er-editor')
  assert.equal(document.activeElement, box)
  assert.equal(page.el.querySelectorAll('.er-editor').length, 1, 'one editor')
  // placed under the passage (range bottom 220 + gap), in the wrap's scroll space
  assert.ok(parseFloat(ed.style.top) >= 220, ed.style.top)
  await setValue(box, '这里要补充')
  await key(box, 'Enter')
  await flush()
  assert.equal(page.el.querySelector('[data-er-float-editor]'), null)
  const added = env.backend.items.at(-1)
  assert.equal(added.comment, '这里要补充')
  assert.ok(page.el.querySelector(`[data-er-item="${added.id}"]`).classList.contains('is-active'))
  await page.unmount()
})

test('collapsed: 标注 keeps the rail (no temporary expand)', async () => {
  const env = fresh({ stored: { listPanel: { collapsed: true, width: 340, sheetOpen: true } } })
  const page = await openPage(env)
  await annotate(page, '第二段')
  assert.ok(page.el.querySelector('[data-er-float-editor]'))
  assert.equal(mode(page.el), 'rail')
  await key(page.el.querySelector('[data-er-float-editor] textarea'), 'Escape')
  await flush()
  assert.equal(page.el.querySelector('[data-er-float-editor]'), null)
  assert.equal(mode(page.el), 'rail')
  await page.unmount()
})

test('a card\'s 编辑意见 opens the floating editor under its words; a 原文已变 card edits in place', async () => {
  const its = ITEMS()
  const env = fresh({ items: its })
  const page = await openPage(env)
  const card = page.el.querySelector('[data-er-item="r0002"]')
  await click(card)
  await click([...card.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  const ed = page.el.querySelector('[data-er-float-editor]')
  assert.ok(ed)
  assert.equal(card.querySelector('textarea'), null)
  assert.equal(ed.querySelector('textarea').value, '先说**为什么**')
  await key(ed.querySelector('textarea'), 'Escape')
  await flush()
  const lost = page.el.querySelector('[data-er-item="r0005"]')
  assert.equal(lost.dataset.erLocated, 'false')
  await click(lost)
  await click([...lost.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  assert.ok(lost.querySelector('textarea.er-editor'), 'the card keeps its editor for 原文已变')
  assert.equal(page.el.querySelector('[data-er-float-editor]'), null)
  await page.unmount()
})

test('placeFloat: under the passage; no room below → above; RTL keeps the start edge', () => {
  const vp = { top: 0, height: 600, width: 600, scrollTop: 0 }
  assert.deepEqual(float.placeFloat({ top: 100, bottom: 120, left: 40, right: 140 }, { width: 320, height: 160 }, vp), { top: 124, left: 40, side: 'bottom' })
  assert.deepEqual(float.placeFloat({ top: 500, bottom: 520, left: 40, right: 140 }, { width: 320, height: 160 }, vp), { top: 336, left: 40, side: 'top' })
  assert.deepEqual(float.placeFloat({ top: 100, bottom: 120, left: 400, right: 580 }, { width: 320, height: 160 }, vp, { rtl: true }), { top: 124, left: 260, side: 'bottom' })
  assert.equal(float.placeFloat({ top: 100, bottom: 120, left: 500, right: 590 }, { width: 320, height: 160 }, vp).left, 272, 'kept inside')
  assert.equal(float.placeFloat({ top: 100, bottom: 120, left: 40, right: 140 }, { width: 320, height: 160 }, { ...vp, scrollTop: 300 }).top, 424, 'scroll space')
})

// --- R11-K: how a menu closes decides where focus goes ----------------------------------------
const press = (node) => act(async () => node.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true, cancelable: true })))

for (const [name, trigger, menuSel] of [
  ['⋯', '[data-er-more]', '[data-er-more-menu]'],
  ['发送', '[data-er-send-menu-open]', '[data-er-send-menu]']
]) {
  test(`R11-K ${name} menu: a press outside closes it and leaves focus alone; Esc or a pick gives it back to the trigger`, async () => {
    const env = fresh({ items: ITEMS() })
    const page = await openPage(env)
    const doc = page.el.querySelector('[data-diple-docs-doc]')
    const btn = () => page.el.querySelector(trigger)
    await click(btn())
    assert.ok(page.el.querySelector(menuSel), 'open')
    assert.ok(page.el.querySelector(menuSel).contains(document.activeElement), 'focus in the menu')
    // a drag-select starts in the document: the menu goes, focus is not pulled back
    selectText(doc, '第二段')
    await press(doc)
    document.activeElement.blur()
    await flush()
    assert.equal(page.el.querySelector(menuSel), null, 'closed')
    assert.notEqual(document.activeElement, btn(), 'focus not pulled back to the trigger')
    assert.equal(String(document.getSelection()), '第二段', 'the selection is untouched')
    // Esc (focus on <body>, outside the menu) closes it and gives focus back
    await click(btn())
    document.activeElement.blur()
    await key(document.body, 'Escape')
    await flush()
    assert.equal(page.el.querySelector(menuSel), null)
    assert.equal(document.activeElement, btn(), 'Esc: back to the trigger')
    // a pick: back to the trigger
    await click(btn())
    const pick = name === '⋯' ? menuItem(page.el, 'copy-md') : page.el.querySelector(`${menuSel} [data-send-item]:not(:disabled):not([role="menuitemradio"])`)
    await click(pick)
    assert.equal(page.el.querySelector(menuSel), null)
    assert.equal(document.activeElement, btn(), 'a pick: back to the trigger')
    await page.unmount()
  })
}

test('R11-K a draft open and the ⋯ menu over it: Esc closes the menu only, the draft stays with its text', async () => {
  const env = fresh({ items: ITEMS() })
  const page = await openPage(env)
  await annotate(page, '第三段也有')
  const box = page.el.querySelector('[data-er-float-editor] textarea')
  assert.ok(box)
  await setValue(box, '还没写完')
  await click(page.el.querySelector('[data-er-more]'))
  assert.ok(page.el.querySelector('[data-er-more-menu]'))
  await key(box, 'Escape', { cancelable: true })
  await flush()
  assert.equal(page.el.querySelector('[data-er-more-menu]'), null, 'the menu closed')
  assert.ok(page.el.querySelector('[data-er-float-editor]'), 'the draft is still there')
  assert.equal(page.el.querySelector('[data-er-float-editor] textarea').value, '还没写完')
  // the next Esc is the draft's
  await key(page.el.querySelector('[data-er-float-editor] textarea'), 'Escape', { cancelable: true })
  await flush()
  assert.equal(page.el.querySelector('[data-er-float-editor]'), null)
  await page.unmount()
})
