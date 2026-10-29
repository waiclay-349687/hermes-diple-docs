// V3-D3 #2: 标注 opens a DRAFT — nothing is written, the list and the rail stay as
// they are — until 保存 (empty → 划线, words → 批注). Esc / a click away drop an
// empty draft without a trace; a draft with words survives a click away (the
// editor shakes, as the chat's) and a new 标注 elsewhere. 重新选取原文 on a draft
// only moves the draft. An already annotated passage opens its annotation.
// Seam: register(ctx) with the SDK stub (as v3d2-list); geometry and scroll: tests/e2e/v3d3-*.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'

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
      const dup = b.items.find((i) => i.text === body.anchor.text && i.anchor.line === body.anchor.line)
      if (dup) return { ...dup, duplicate: true }
      const it = item(`r${++b.seq}`, body.anchor.text, body.anchor.line, { anchor: body.anchor, comment: body.comment ?? '' })
      b.items.push(it)
      b.version++
      return { ...it, duplicate: false }
    }
    if (route.startsWith('/items/r') && method === 'PATCH') {
      const it = b.items.find((i) => `/items/${i.id}` === route)
      if (body.op === 'comment') Object.assign(it, { comment: body.comment, revision: it.revision + 1 })
      it.mutation++
      b.version++
      return { ...it }
    }
    if (route === '/items/locate') return { changed: 0 }
    if (route === '/reviews/recent' && method === 'GET') return { reviews: [] }
    if (route === '/reviews/recent') return { ok: true }
    if (route === '/sessions/titles') return { titles: {} }
    if (route === '/settings') return { autoCard: true }
    if (route === '/handoffs/rebroadcast-pending') return { rebroadcast: [] }
    if (route === '/handoffs/unconfirmed') return { handoffs: [] }
    if (route === '/handoffs' && method === 'POST') return { ok: true }
    if (route.startsWith('/handoffs/')) return { ok: true }
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
  // a shake is counted when it starts: its attribute lives 320 ms of wall time, which a loaded run can outlast
  let shook = 0
  const mo = new w.MutationObserver((rs) => { for (const r of rs) if (r.oldValue === null) shook++ })
  mo.observe(el, { subtree: true, attributes: true, attributeFilter: ['data-shake'], attributeOldValue: true })
  const root = createRoot(el)
  await act(async () => root.render(createElement(() => ws.render())))
  await flush()
  const wrap = el.querySelector('.er-docwrap')
  wrap.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600, left: 0, right: 600, width: 600 })
  Object.defineProperty(wrap, 'clientHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(wrap, 'clientWidth', { configurable: true, get: () => 600 })
  wrap.scrollTo = () => {}
  return { el, wrap, shakes: () => shook, unmount: async () => { if (!el.isConnected) return; mo.disconnect(); await act(async () => root.unmount()); el.remove() } }
}

const click = async (node) => {
  assert.ok(node, 'element to click')
  await act(async () => {
    node.dispatchEvent(new w.MouseEvent('pointerdown', { bubbles: true }))
    node.dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }))
    node.dispatchEvent(new w.MouseEvent('pointerup', { bubbles: true }))
    node.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  })
  await flush()
}
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
// the writes of annotations (the page's own settings / recent rows are not)
const posts = (env) => env.backend.calls.filter((c) => c.method !== 'GET' && c.path.startsWith('/items') && !c.path.startsWith('/items/locate'))
const editor = (page) => page.el.querySelector('[data-er-float-editor]')
const shaken = (page) => { const n = page.shakes(); const s = n > (page.seen ?? 0); page.seen = n; return s }
const cards = (page) => page.el.querySelectorAll('[data-er-item]').length
const drafted = () => [...(CSS.highlights.get('er-draft')?.ranges ?? [])].map((r) => r.toString())

test('标注 opens a draft: nothing written, no card, no tick; the words carry the draft underlay; Esc drops it without a trace', async () => {
  const env = fresh({ stored: { listPanel: { collapsed: false, width: 340, sheetOpen: true } } })
  const page = await openPage(env)
  await annotate(page, '第二段')
  const ed = editor(page)
  assert.ok(ed, 'the editor is open')
  assert.ok(ed.hasAttribute('data-er-draft'), 'as a draft')
  assert.match(ed.querySelector('.er-float-quote').textContent, /第二段/)
  assert.deepEqual(posts(env), [], 'no request before 保存')
  assert.equal(env.backend.items.length, 0)
  assert.equal(cards(page), 0, 'not in the list')
  assert.deepEqual(drafted(), ['第二段'], 'the draft underlay marks the words')
  assert.equal(document.activeElement, ed.querySelector('textarea'))
  await key(ed.querySelector('textarea'), 'Escape')
  await flush()
  assert.equal(editor(page), null)
  assert.deepEqual(posts(env), [])
  assert.equal(cards(page), 0)
  assert.deepEqual(drafted(), [], 'no underlay left')
  await page.unmount()
})

test('a blur alone saves nothing; an empty draft clicked away is dropped silently', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  const box = editor(page).querySelector('textarea')
  await act(async () => box.dispatchEvent(new w.FocusEvent('blur', { bubbles: false })))
  await act(async () => box.dispatchEvent(new w.FocusEvent('focusout', { bubbles: true })))
  await flush()
  assert.ok(editor(page), 'a blur keeps the draft')
  assert.deepEqual(posts(env), [])
  await click(page.el.querySelector('.er-head-name'))
  assert.equal(editor(page), null, 'clicked away: dropped')
  assert.deepEqual(posts(env), [])
  assert.equal(sdk.notifications.length, 0, 'silently')
  await page.unmount()
})

test('保存 with nothing written → one 划线; with words → one 批注; it joins the list as the current card', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await click(editor(page).querySelector('[data-er-float-save]'))
  assert.equal(editor(page), null)
  assert.equal(posts(env).length, 1, 'one request')
  assert.equal(env.backend.items.length, 1)
  assert.equal(env.backend.items[0].comment, '', 'a 划线')
  const id = env.backend.items[0].id
  assert.ok(page.el.querySelector(`[data-er-item="${id}"]`).classList.contains('is-active'))
  await annotate(page, '第三段')
  await setValue(editor(page).querySelector('textarea'), '补一句')
  await key(editor(page).querySelector('textarea'), 'Enter')
  await flush()
  assert.equal(posts(env).length, 2)
  assert.equal(env.backend.items[1].comment, '补一句', 'a 批注, written in one request')
  assert.equal(env.backend.calls.filter((c) => c.method === 'PATCH').length, 0, 'no second write')
  assert.equal(cards(page), 2)
  await page.unmount()
})

test('a draft with words: a click away keeps it and shakes; a new 标注 elsewhere shakes and keeps it; Esc drops it', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '还没写完')
  await click(page.el.querySelector('.er-head-name'))
  const ed = editor(page)
  assert.ok(ed, 'kept')
  assert.ok(shaken(page), 'shakes')
  assert.equal(ed.querySelector('textarea').value, '还没写完')
  await annotate(page, '第三段')
  assert.match(editor(page).querySelector('.er-float-quote').textContent, /第二段/, 'the first draft stays')
  assert.equal(editor(page).querySelector('textarea').value, '还没写完')
  assert.deepEqual(posts(env), [])
  await key(editor(page).querySelector('textarea'), 'Escape')
  await flush()
  assert.equal(editor(page), null)
  assert.deepEqual(posts(env), [])
  await page.unmount()
})

test('an empty draft is replaced by a new 标注 elsewhere (above or below)', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第三段')
  await annotate(page, '第二段')
  assert.match(editor(page).querySelector('.er-float-quote').textContent, /第二段/)
  assert.ok(!shaken(page))
  await annotate(page, '第四段')
  assert.match(editor(page).querySelector('.er-float-quote').textContent, /第四段/)
  assert.equal(page.el.querySelectorAll('[data-er-float-editor]').length, 1)
  assert.deepEqual(drafted(), ['第四段'])
  assert.deepEqual(posts(env), [])
  await page.unmount()
})

test('an annotated passage opens its annotation, not a new draft', async () => {
  const env = fresh({ items: [item('r0002', '第二段', 5, { comment: '旧意见' })] })
  const page = await openPage(env)
  await annotate(page, '第二段')
  const ed = editor(page)
  assert.ok(ed)
  assert.ok(!ed.hasAttribute('data-er-draft'))
  assert.equal(ed.dataset.itemId, 'r0002')
  assert.equal(ed.querySelector('textarea').value, '旧意见')
  assert.deepEqual(posts(env), [])
  await page.unmount()
})

test('重新选取原文 on a draft moves only the draft (no request); the words typed stay', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '意见先写')
  await click(editor(page).querySelector('[data-er-float-reselect]'))
  assert.equal(editor(page), null, 'the editor steps aside for the new selection')
  assert.ok(page.el.querySelector('.er-banner'), 'the 重新选取 banner')
  await annotate(page, '第三段')
  const ed = editor(page)
  assert.ok(ed?.hasAttribute('data-er-draft'))
  assert.match(ed.querySelector('.er-float-quote').textContent, /第三段/)
  assert.equal(ed.querySelector('textarea').value, '意见先写')
  assert.deepEqual(posts(env), [], 'nothing written')
  await click(ed.querySelector('[data-er-float-save]'))
  assert.equal(env.backend.items.length, 1)
  assert.equal(env.backend.items[0].text, '第三段')
  assert.equal(env.backend.items[0].comment, '意见先写')
  await page.unmount()
})

test('保存并发送 on a draft: one write, then the send of that annotation', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '发出去')
  await click(editor(page).querySelector('[data-er-float-send]'))
  await flush(10)
  assert.equal(env.backend.calls.filter((c) => c.path === '/items' && c.method === 'POST').length, 1, 'one write')
  const ho = env.backend.calls.find((c) => c.path === '/handoffs' && c.method === 'POST')
  assert.ok(ho, 'a hand-off')
  assert.deepEqual(ho.body.items.map((i) => i.origin?.itemId ?? i.itemId ?? i.id), [env.backend.items[0].id])
  await page.unmount()
})
