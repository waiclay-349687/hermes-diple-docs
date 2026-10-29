// R11-F D 路 (XR11-01…05, 10): the review's counter-examples, turned into the
// behaviour they should have. Seam: register(ctx) with the SDK stub (as
// v3d3-draft); geometry and scroll stay with tests/e2e/v3d3-*.mjs.
//   XR11-01 every entry that switches the editor goes through one guard
//   XR11-02 a draft keeps its anchor + document version; a refresh relocates it
//   XR11-03 typing on while 保存 is in flight; a save token per draft
//   XR11-04 a draft meets the same passage saved elsewhere: the user chooses
//   XR11-05 a written draft survives close / reload (ctx.storage, per file)
//   XR11-10 复制给 AI needs neither Diple nor a session
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

function fresh({ items = [], stored = {}, session = 'local-s1', decisions = {}, text } = {}) {
  sdk.notifications.length = 0
  sdk.workspaces.clear()
  sdk.pluginDecisions.set(decisions)
  sdk.locale.set('zh')
  sdk.state.focusedStoredSessionId.set(session)
  const backend = fakeBackend(text)
  backend.items.push(...items)
  const h = makeCtx({ rest: backend.rest })
  for (const [k, v] of Object.entries(stored)) h.store.set(k, JSON.stringify(v))
  const timeouts = []
  h.ctx.setInterval = () => () => {}
  h.ctx.setTimeout = (fn, ms) => (timeouts.push({ fn, ms }), () => {})
  h.ctx.registerSettingsPage = () => () => {}
  h.ctx.os = { pickOpenPath: async () => PATH, revealPath: async () => true }
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  return { h, backend, timeouts }
}

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => tick(0))
}

// a test that fails before its page.unmount() must not leave its page (and underlay) to the next ones
const left = []
test.afterEach(async () => { for (const p of left.splice(0)) await p.unmount() })

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
  const page = { el, wrap, shakes: () => shook, unmount: async () => { if (!el.isConnected) return; mo.disconnect(); await act(async () => root.unmount()); el.remove() } }
  left.push(page)
  return page
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
const cards = (page) => page.el.querySelectorAll('[data-er-item]').length
const drafted = () => [...(CSS.highlights.get('er-draft')?.ranges ?? [])].map((r) => r.toString())

const patches = (env) => env.backend.calls.filter((c) => c.method === 'PATCH')
const shaken = (page) => { const n = page.shakes(); const s = n > (page.seen ?? 0); page.seen = n; return s }
const buttonByText = (root, re) => [...root.querySelectorAll('button')].find((b) => re.test(b.textContent))
// the invariant of XR11-01: a draft underlay is never left without its editor
const noStrandedDraft = (page) => assert.ok(drafted().length === 0 || editor(page)?.hasAttribute('data-er-draft'), `underlay ${JSON.stringify(drafted())} has its editor`)
const LOST = () => item('r0009', '早已删掉的一句话', 3, { anchor: { text: '早已删掉的一句话', before: '', after: '', line: 3 } })

// --- XR11-01 ---------------------------------------------------------------------------
const ENTRIES = {
  card: async (page) => click(page.el.querySelector('[data-er-item="r0002"]')),
  // the card is current before the draft opens: its 编辑意见 is on screen
  editButton: async (page) => click(buttonByText(page.el.querySelector('[data-er-item="r0002"]'), /编辑意见/)),
  doubleClick: async (page) => act(async () => page.el.querySelector('[data-er-item="r0002"] .er-comment').dispatchEvent(new w.MouseEvent('dblclick', { bubbles: true }))),
  enter: async (page) => {
    const c = page.el.querySelector('[data-er-item="r0002"]')
    c.focus()
    await key(c, 'Enter')
  },
  reselect: async (page) => click(page.el.querySelector('[data-er-item="r0009"] [data-er-reselect]')),
  nav: async (page) => click(page.el.querySelector('[data-diple-docs-list] [data-er-nav="next"]'))
}
for (const [name, run] of Object.entries(ENTRIES)) {
  test(`XR11-01 ${name}: a written draft holds — the editor shakes, stays a draft, keeps its words; nothing switches`, async () => {
    const env = fresh({ items: [item('r0002', '第三段', 7, { comment: '原有意见' }), LOST()], stored: { listPanel: { collapsed: false, width: 340 } } })
    const page = await openPage(env)
    if (name === 'editButton') await click(page.el.querySelector('[data-er-item="r0002"]'))
    await annotate(page, '第二段')
    await setValue(editor(page).querySelector('textarea'), '不可丢的草稿')
    await run(page)
    await flush()
    const ed = editor(page)
    assert.ok(ed?.hasAttribute('data-er-draft'), 'the draft editor is still the one shown')
    assert.equal(ed.querySelector('textarea').value, '不可丢的草稿')
    assert.ok(shaken(page), 'it shook')
    assert.equal(page.el.querySelectorAll('[data-er-float-editor]').length, 1)
    assert.ok(!page.el.querySelector('.er-card .er-editor'), 'no card editor opened')
    assert.ok(!/请选一段新的原文|重新选取/.test(page.el.querySelector('.er-banner')?.textContent ?? ''), 'no replace banner')
    assert.deepEqual(drafted(), ['第二段'])
    noStrandedDraft(page)
    assert.deepEqual(posts(env), [])
    await page.unmount()
  })
}

test('XR11-01 an empty draft is dropped by a switch, which then happens (编辑意见 opens the stored one)', async () => {
  const env = fresh({ items: [item('r0002', '第三段', 7, { comment: '原有意见' })], stored: { listPanel: { collapsed: false, width: 340 } } })
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-item="r0002"]'))
  await annotate(page, '第二段')
  await ENTRIES.editButton(page)
  assert.equal(editor(page)?.dataset.itemId, 'r0002')
  assert.ok(!editor(page).hasAttribute('data-er-draft'))
  assert.deepEqual(drafted(), [])
  await page.unmount()
})

test('XR11-01 the review\'s stranding sequence: the draft cannot be hidden, annotate works after', async () => {
  const env = fresh({ items: [item('r0002', '第三段', 7, { comment: '原有意见' })] })
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '不可丢的草稿')
  await click(page.el.querySelector('[data-er-item="r0002"]'))
  noStrandedDraft(page)
  await key(editor(page).querySelector('textarea'), 'Escape') // Esc on the draft: dropped explicitly
  await flush()
  assert.equal(editor(page), null)
  noStrandedDraft(page)
  await annotate(page, '第四段')
  assert.ok(editor(page)?.hasAttribute('data-er-draft'))
  assert.deepEqual(drafted(), ['第四段'])
  await page.unmount()
})

test('XR11-01 the rail: a tick does not switch away from a written draft', async () => {
  const env = fresh({ items: [item('r0002', '第三段', 7, { comment: '原有意见' })], stored: { listPanel: { collapsed: true, width: 340 } } })
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '草稿')
  const tick = page.el.querySelector('[data-er-tick="r0002"]')
  assert.ok(tick, 'a tick')
  await click(tick)
  assert.ok(editor(page)?.hasAttribute('data-er-draft'))
  assert.ok(shaken(page))
  assert.ok(!page.el.querySelector('.er-card.is-active, [data-er-tick].is-active'), 'no current item set')
  await page.unmount()
})

// --- XR11-02 ---------------------------------------------------------------------------
test('XR11-02 a refresh moves the draft with its words (unique): 保存 stores the passage the user picked', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '给第二段的意见')
  env.backend.text = '新增一大段前言，足以改变所有偏移量。\n\n' + DOC
  await click(page.el.querySelector('.er-head button[aria-label="重新读取"]'))
  await flush()
  assert.deepEqual(drafted(), ['第二段'], 'the underlay moved with the words')
  assert.ok(!editor(page).querySelector('[data-er-draft-lost]'))
  await click(editor(page).querySelector('[data-er-float-save]'))
  assert.equal(env.backend.items.length, 1)
  assert.equal(env.backend.items[0].text, '第二段')
  assert.equal(env.backend.items[0].comment, '给第二段的意见')
  await page.unmount()
})

test('XR11-02 the passage is gone after a refresh: the words stay, 保存 waits for 重新选取原文', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '留着的字')
  env.backend.text = DOC.replace('第二段说明文字。', '改写过的一句。')
  await click(page.el.querySelector('.er-head button[aria-label="重新读取"]'))
  await flush()
  const ed = editor(page)
  assert.ok(ed?.hasAttribute('data-er-draft'))
  assert.match(ed.querySelector('[data-er-draft-lost]')?.textContent ?? '', /原文变了，请重新选取/)
  assert.equal(ed.querySelector('[data-er-float-save]').disabled, true)
  assert.equal(ed.querySelector('[data-er-float-send]').disabled, true)
  assert.equal(ed.querySelector('textarea').value, '留着的字')
  assert.deepEqual(drafted(), [], 'no underlay on words that are not the passage')
  await key(ed.querySelector('textarea'), 'Enter') // ⏎ cannot save it either
  await flush()
  assert.deepEqual(posts(env), [])
  await click(ed.querySelector('[data-er-float-reselect]'))
  await annotate(page, '第三段')
  assert.ok(!editor(page).querySelector('[data-er-draft-lost]'))
  assert.equal(editor(page).querySelector('textarea').value, '留着的字')
  await click(editor(page).querySelector('[data-er-float-save]'))
  assert.equal(env.backend.items[0].text, '第三段')
  assert.equal(env.backend.items[0].comment, '留着的字')
  await page.unmount()
})

// --- XR11-03 ---------------------------------------------------------------------------
const gatePosts = (env) => {
  const originalRest = env.h.ctx.rest
  let release
  const gate = new Promise((r) => (release = r))
  env.h.ctx.rest = async (p, opts) => {
    if (p === '/items' && opts?.method === 'POST') await gate
    return originalRest(p, opts)
  }
  return () => act(async () => (release(), await tick(0)))
}

test('XR11-03 typing on while 保存 is in flight: the editor becomes that annotation\'s, the new words unsaved', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '第一版')
  const release = gatePosts(env)
  await click(editor(page).querySelector('[data-er-float-save]'))
  assert.equal(editor(page).querySelector('textarea').disabled, false, 'the box is not locked')
  await setValue(editor(page).querySelector('textarea'), '第一版继续写的内容')
  await release()
  await flush(10)
  const ed = editor(page)
  assert.ok(ed, 'still open')
  assert.ok(!ed.hasAttribute('data-er-draft'), 'now the stored annotation\'s editor')
  assert.equal(ed.dataset.itemId, env.backend.items[0].id)
  assert.equal(ed.querySelector('textarea').value, '第一版继续写的内容')
  assert.equal(env.backend.items[0].comment, '第一版')
  await key(ed.querySelector('textarea'), 'Enter')
  await flush(10)
  assert.equal(env.backend.items[0].comment, '第一版继续写的内容')
  assert.equal(env.backend.items.length, 1)
  assert.equal(editor(page), null)
  await page.unmount()
})

test('XR11-03 an old save returning never closes a newer draft (save token)', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  const release = gatePosts(env)
  await click(editor(page).querySelector('[data-er-float-save]')) // empty → a 划线, in flight
  await key(editor(page).querySelector('textarea'), 'Escape')
  await flush()
  await annotate(page, '第四段')
  await setValue(editor(page).querySelector('textarea'), '新的草稿')
  await release()
  await flush(10)
  const ed = editor(page)
  assert.ok(ed?.hasAttribute('data-er-draft'), 'the new draft is still open')
  assert.match(ed.querySelector('.er-float-quote').textContent, /第四段/)
  assert.equal(ed.querySelector('textarea').value, '新的草稿')
  assert.deepEqual(drafted(), ['第四段'])
  await page.unmount()
})

// --- XR11-04 ---------------------------------------------------------------------------
async function collide(env, mine = '本窗口草稿', theirs = '另一窗口刚保存的意见') {
  const page = await openPage(env)
  await annotate(page, '第二段')
  if (mine) await setValue(editor(page).querySelector('textarea'), mine)
  env.backend.items.push(item('r0002', '第二段', 5, { comment: theirs }))
  env.backend.version++
  await click(editor(page).querySelector('[data-er-float-save]'))
  await flush()
  return page
}

test('XR11-04 a draft meets the same passage saved elsewhere with other words: nothing overwritten, the user chooses', async () => {
  const env = fresh()
  const page = await collide(env)
  const bar = page.el.querySelector('[data-er-collision]')
  assert.ok(bar, 'the conflict bar')
  assert.match(bar.textContent, /另一窗口刚保存的意见/)
  assert.equal(editor(page).querySelector('textarea').value, '本窗口草稿', 'my draft stays in the box')
  assert.deepEqual(patches(env), [], 'nothing written over it')
  assert.equal(env.backend.items[0].comment, '另一窗口刚保存的意见')
  for (const a of ['keep', 'replace', 'merge']) assert.ok(bar.querySelector(`[data-er-collision-action="${a}"]`), a)
  await page.unmount()
})

test('XR11-04 合并: mine after theirs, a blank line between — one write', async () => {
  const env = fresh()
  const page = await collide(env)
  await click(page.el.querySelector('[data-er-collision-action="merge"]'))
  assert.equal(env.backend.items[0].comment, '另一窗口刚保存的意见\n\n本窗口草稿')
  assert.equal(patches(env).length, 1)
  assert.equal(editor(page), null)
  await page.unmount()
})

test('XR11-04 用我的替换: one write of my words', async () => {
  const env = fresh()
  const page = await collide(env)
  await click(page.el.querySelector('[data-er-collision-action="replace"]'))
  assert.equal(env.backend.items[0].comment, '本窗口草稿')
  assert.equal(patches(env).length, 1)
  await page.unmount()
})

test('XR11-04 保留已有: my draft dropped, the stored one opens; nothing written', async () => {
  const env = fresh()
  const page = await collide(env)
  await click(page.el.querySelector('[data-er-collision-action="keep"]'))
  assert.deepEqual(patches(env), [])
  assert.equal(editor(page)?.dataset.itemId, 'r0002')
  assert.equal(editor(page).querySelector('textarea').value, '另一窗口刚保存的意见')
  await page.unmount()
})

test('XR11-04 an empty draft meets an annotated passage: that one opens, with 这段已经标注过', async () => {
  const env = fresh()
  const page = await collide(env, '')
  assert.deepEqual(patches(env), [])
  assert.equal(editor(page)?.dataset.itemId, 'r0002')
  assert.ok(sdk.notifications.some((n) => /这段已经标注过/.test(n.message ?? n.title ?? '')), JSON.stringify(sdk.notifications))
  await page.unmount()
})

// --- XR11-05 ---------------------------------------------------------------------------
const KEY = `draft:${PATH}`
test('XR11-05 a written draft survives closing the page: reopened in place, with 恢复了未保存的意见', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  assert.equal(env.h.ctx.storage.get(KEY, null), null, 'an empty draft is not cached')
  await setValue(editor(page).querySelector('textarea'), '关闭前还未保存')
  const cached = Object.values(env.h.ctx.storage.get(KEY, null)?.slots ?? {})[0]
  assert.equal(cached?.words, '关闭前还未保存')
  assert.equal(cached?.anchor?.text, '第二段')
  assert.ok(cached?.sig, 'the document version')
  await page.unmount()
  const again = await openPage(env)
  const ed = editor(again)
  assert.ok(ed?.hasAttribute('data-er-draft'), 'the draft is back')
  assert.equal(ed.querySelector('textarea').value, '关闭前还未保存')
  assert.match(ed.querySelector('[data-er-restored]')?.textContent ?? '', /恢复了未保存的意见/)
  assert.deepEqual(drafted(), ['第二段'])
  assert.deepEqual(posts(env), [])
  await click(ed.querySelector('[data-er-float-save]'))
  assert.equal(env.backend.items[0].comment, '关闭前还未保存')
  assert.equal(env.h.ctx.storage.get(KEY, null), null, 'saved → cache cleared')
  await again.unmount()
})

test('XR11-05 Esc clears the cache', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '不要了')
  await key(editor(page).querySelector('textarea'), 'Escape')
  await flush()
  assert.equal(env.h.ctx.storage.get(KEY, null), null)
  await page.unmount()
})

const lostCache = { anchor: { text: '早已不在的原文', before: '', after: '', line: 5, sig: 'x' }, words: '找不到原文的草稿', sig: 'x', at: 1 }
test('XR11-05 the cached passage is gone: a restore bar with 复制 / 放弃 / 重新选取原文', async () => {
  const env = fresh({ stored: { [KEY]: lostCache } })
  const page = await openPage(env)
  const bar = page.el.querySelector('[data-er-restore-bar]')
  assert.ok(bar, 'the restore bar')
  assert.match(bar.textContent, /找不到原文的草稿/)
  assert.equal(editor(page), null)
  let copied = null
  globalThis.navigator.clipboard = { writeText: async (t) => void (copied = t) }
  await click(bar.querySelector('[data-er-restore-action="copy"]'))
  assert.equal(copied, '找不到原文的草稿')
  await click(bar.querySelector('[data-er-restore-action="reselect"]'))
  assert.ok(!page.el.querySelector('[data-er-restore-bar]'))
  await annotate(page, '第三段')
  assert.equal(editor(page).querySelector('textarea').value, '找不到原文的草稿')
  await click(editor(page).querySelector('[data-er-float-save]'))
  assert.equal(env.backend.items[0].text, '第三段')
  assert.equal(env.h.ctx.storage.get(KEY, null), null)
  await page.unmount()
})

test('XR11-05 放弃 on the restore bar clears it', async () => {
  const env = fresh({ stored: { [KEY]: lostCache } })
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-restore-action="discard"]'))
  assert.ok(!page.el.querySelector('[data-er-restore-bar]'))
  assert.equal(env.h.ctx.storage.get(KEY, null), null)
  await page.unmount()
})

// --- XR11-10 ---------------------------------------------------------------------------
async function copyCase(env, { expectSend }) {
  const page = await openPage(env)
  let copied = null
  globalThis.navigator.clipboard = { writeText: async (t) => void (copied = t) }
  const open = page.el.querySelector('[data-er-send-menu-open]')
  assert.equal(open.disabled, false, 'the menu opens')
  await click(open)
  const menu = page.el.querySelector('[data-er-send-menu]')
  assert.ok(menu)
  const it = (k) => menu.querySelector(`[data-send-item="${k}"]`)
  assert.equal(it('copy')?.disabled, false, '复制给 AI usable')
  for (const k of ['current', 'queue']) if (it(k)) assert.equal(it(k).disabled, !expectSend, `${k} ${expectSend ? 'enabled' : 'disabled'}`)
  await click(it('copy'))
  assert.match(copied ?? '', /第二段/)
  // the card's own button opens the same menu
  const one = page.el.querySelector('[data-er-send-one]')
  assert.equal(one.disabled, false)
  await page.unmount()
}
const pending2 = () => [item('r0002', '第二段', 5, { comment: '意见' })]
test('XR11-10 peer unknown: the menu opens, copy and send usable', async () => {
  await copyCase(fresh({ items: pending2() }), { expectSend: true })
})
test('XR11-10 Diple disabled: the menu opens, 复制给 AI works, send / 加入待发 disabled', async () => {
  await copyCase(fresh({ items: pending2(), decisions: { annotation: false } }), { expectSend: false })
})
test('XR11-10 Diple missing (no receipt): copy still works', async () => {
  const env = fresh({ items: pending2() })
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-send-menu-open]'))
  await click(page.el.querySelector('[data-er-send-menu] [data-send-item="queue"]'))
  await flush()
  const timer = env.timeouts.find((x) => x.ms === 3000)
  assert.ok(timer)
  await act(async () => timer.fn())
  await flush()
  assert.ok(page.el.querySelector('[data-er-peer="missing"]'))
  await page.unmount()
  await copyCase(env, { expectSend: false })
})
test('XR11-10 no session: the menu opens, 复制给 AI works', async () => {
  const env = fresh({ items: pending2(), session: null })
  const page = await openPage(env)
  let copied = null
  globalThis.navigator.clipboard = { writeText: async (t) => void (copied = t) }
  const open = page.el.querySelector('[data-er-send-menu-open]')
  assert.equal(open.disabled, false)
  await click(open)
  const menu = page.el.querySelector('[data-er-send-menu]')
  assert.ok(!menu.querySelector('[data-send-item="queue"]:not(:disabled)'))
  await click(menu.querySelector('[data-send-item="copy"]'))
  assert.match(copied ?? '', /第二段/)
  await page.unmount()
})

// --- the review's two guard probes, kept as positives (XR11-03) ----------------------------
test('XR11-03 Enter / Escape while an input method is composing neither save nor discard the draft', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  const box = editor(page).querySelector('textarea')
  await setValue(box, '候选字')
  await key(box, 'Enter', { isComposing: true })
  await key(box, 'Escape', { isComposing: true })
  await key(box, 'Enter', { keyCode: 229 })
  await flush()
  assert.ok(editor(page)?.hasAttribute('data-er-draft'))
  assert.equal(posts(env).length, 0)
  await page.unmount()
})

test('XR11-03 two 保存 clicks while the first is in flight: one POST', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(editor(page).querySelector('textarea'), '只保存一次')
  const release = gatePosts(env)
  await click(editor(page).querySelector('[data-er-float-save]'))
  await click(editor(page).querySelector('[data-er-float-save]'))
  await release()
  await flush(10)
  assert.equal(posts(env).filter((c) => c.path === '/items' && c.method === 'POST').length, 1)
  assert.equal(env.backend.items.length, 1)
  assert.equal(editor(page), null)
  await page.unmount()
})

// Once (under a loaded `npm test`) this file finished every test and then never
// exited. If anything still holds the event loop 5 s after the last test, name
// it and fail, instead of hanging the whole suite.
test.after(() => {
  const t = setTimeout(() => {
    const live = process._getActiveHandles().map((h) => h?.constructor?.name ?? typeof h)
    process.stderr.write(`v3d3-r11-draft: still alive after the tests: ${JSON.stringify(live)}\n`)
    process.exit(1)
  }, 5000)
  t.unref()
})
