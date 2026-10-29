// Diple Docs desktop half (W2c), driven only through register(ctx) with the SDK stub.
// Each test names the spec user story it covers (S45…S62).
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'

const w = setupDom()
const React = await import('react')
const { act, createElement } = React
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple-docs')
const sdk = globalThis.__sdk
w.HTMLElement.prototype.scrollIntoView ??= function () {}
w.Range.prototype.getBoundingClientRect ??= () => ({ top: 10, bottom: 30, left: 10, right: 80, width: 70, height: 20 })
w.Range.prototype.getClientRects ??= function () {
  return [this.getBoundingClientRect()]
}

const DOC = '# 缓存方案\n\n先**更新数据库**，再删除缓存。\n\n第二段说明文字。\n'
const PATH = '/work/plan.md'

/** In-memory stand-in for the review backend (the real one is covered by pytest). */
function fakeBackend({ text = DOC } = {}) {
  const b = {
    text,
    mtime: 1,
    exists: true,
    items: [],
    calls: [],
    handoffs: [],
    receipts: [],
    seq: 0,
    version: 0,
    recent: [{ path: PATH, lastOpenedAt: 1, openItems: 0, items: 0 }]
  }
  const bump = () => b.version++
  const find = (id) => b.items.find((i) => i.id === id)
  b.rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    const body = opts.body
    b.calls.push({ path: p, method, body })
    const url = new URL(p, 'http://x')
    const route = url.pathname
    const q = (k) => url.searchParams.get(k)
    if (route === '/file') {
      if (!q('path').match(/\.(md|markdown)$/i)) throw Object.assign(new Error('{"detail":"unsupported-suffix"}'), { status: 415 })
      if (!b.exists) throw Object.assign(new Error('{"detail":"not-found"}'), { status: 404 })
      if (b.fileGate) await b.fileGate
      if (b.fileError) throw Object.assign(new Error(`{"detail":"${b.fileError.code}"}`), { status: b.fileError.status })
      return { path: q('path'), text: b.text, mtime: b.mtime, size: b.text.length }
    }
    if (route === '/review/state')
      return b.exists ? { exists: true, mtime: b.mtime, itemsVersion: String(b.version) } : { exists: false, itemsVersion: String(b.version) }
    if (route === '/items' && method === 'GET') return { items: b.items.map((i) => ({ ...i })), itemsVersion: String(b.version) }
    if (route === '/items' && method === 'POST') {
      const dup = b.items.find((i) => i.text === body.anchor.text && i.anchor.line === body.anchor.line)
      if (dup) return { ...dup, duplicate: true }
      const it = {
        id: `r${String(++b.seq).padStart(4, '0')}`,
        path: body.path,
        anchor: body.anchor,
        text: body.anchor.text,
        comment: body.comment ?? '',
        status: 'pending',
        lost: false,
        revision: 1,
        mutation: 1,
        sentSessions: [],
        queued: null,
        createdAt: b.seq,
        updatedAt: b.seq
      }
      b.items.push(it)
      bump()
      return { ...it, duplicate: false }
    }
    if (route === '/items/locate') {
      for (const r of body.results) {
        const it = find(r.id)
        if (!it) continue
        if (r.lost) it.lost = true
        else Object.assign(it, { lost: false, anchor: r.anchor })
      }
      bump()
      return { changed: body.results.length }
    }
    let m
    if ((m = route.match(/^\/items\/(\w+)$/)) && method === 'PATCH') {
      const it = find(m[1])
      // mirrors store.update_item: revision = content version (origin.revision);
      // mutation = every user operation, resolve included (XR2-01)
      const stale = () => Object.assign(new Error('{"detail":"stale"}'), { status: 409 })
      if (body.expectRevision != null && body.expectRevision !== it.revision) throw stale()
      if (body.expectMutation != null && body.expectMutation !== (it.mutation ?? 1)) throw stale()
      const before = JSON.stringify(it)
      if (body.op === 'comment' && body.comment !== it.comment) Object.assign(it, { comment: body.comment, status: 'pending', revision: it.revision + 1 })
      if (body.op === 'resolve') it.status = 'resolved'
      if (body.op === 'reopen' && it.status === 'resolved') Object.assign(it, { status: 'pending', revision: it.revision + 1 })
      if (body.op === 'replace') Object.assign(it, { anchor: body.anchor, text: body.anchor.text, lost: false, status: 'pending', revision: it.revision + 1 })
      if (JSON.stringify(it) !== before) it.mutation = (it.mutation ?? 1) + 1
      bump()
      return { ...it }
    }
    if ((m = route.match(/^\/items\/(\w+)$/)) && method === 'DELETE') {
      b.items = b.items.filter((i) => i.id !== m[1])
      bump()
      return { deleted: true }
    }
    if (route === '/items/restore') {
      b.items.push({ ...body })
      bump()
      return body
    }
    if (route === '/handoffs' && method === 'POST') {
      if (b.handoffGate) await b.handoffGate
      b.handoffs.push(body)
      b.onHandoff?.(body)
      return { handoffId: body.handoffId, payload: body, receipt: null }
    }
    if ((m = route.match(/^\/handoffs\/([\w-]+)\/(receipt|cancel)$/))) {
      b.receipts.push({ id: m[1], kind: m[2], body })
      return {}
    }
    if ((m = route.match(/^\/handoffs\/([\w-]+)\/settled$/))) {
      b.settled ??= {}
      const prev = b.settled[m[1]]
      if (!prev || (prev.inferred && !body.inferred)) b.settled[m[1]] = body
      return { touched: [] }
    }
    if ((m = route.match(/^\/handoffs\/([\w-]+)\/replay$/))) {
      b.replays ??= []
      b.replays.push(m[1])
      return b.replayAnswer ?? { replayed: true }
    }
    if ((m = route.match(/^\/handoffs\/([\w-]+)\/rebroadcast$/))) {
      b.rebroadcasts ??= []
      b.rebroadcasts.push({ id: m[1], body })
      return { rebroadcast: true }
    }
    if (route === '/handoffs/rebroadcast-pending') return { rebroadcast: [] }
    if (route === '/handoffs/unconfirmed') return { handoffs: b.unconfirmed ?? [] }
    if ((m = route.match(/^\/handoffs\/([\w-]+)$/))) return { handoffId: m[1], settled: b.settled?.[m[1]] ?? null }
    if (route === '/events/batch-sent' || route === '/events/batch-answered') {
      const list = body.items ?? body.answered
      const touched = []
      for (const { origin } of list) {
        const it = find(origin.itemId)
        if (!it || origin.revision !== it.revision) continue
        if (route.endsWith('sent')) {
          it.sentSessions.push({ sessionId: body.sessionId, batchId: body.batchId })
          if (it.status === 'pending') it.status = 'sent'
        } else if (it.status === 'sent' || it.status === 'pending') it.status = 'answered'
        touched.push(it.id)
      }
      bump()
      return { touched }
    }
    if (route === '/reviews/recent' && method === 'GET') return { reviews: b.recent }
    if (route === '/reviews/recent') return { ok: true }
    if (route === '/sessions/titles') return { titles: { 'local-s1': '缓存讨论' } }
    if (route === '/settings') return { autoCard: body?.autoCard ?? true }
    throw Object.assign(new Error(`unhandled ${method} ${p}`), { status: 404 })
  }
  return b
}

// Each test cleans up after itself, also when it fails (V2-R): a hand-off
// left without a receipt arms a real 3 s receipt timer, and on a loaded
// machine (npm test runs files concurrently) it fired inside a later test and
// put its 未确认 notice into the shared sdk.notifications; a page left mounted
// by a failed assertion kept its 10 s ticker alive, so the process never exited.
const live = { timers: new Set(), pages: new Set(), envs: new Set() }
test.afterEach(async () => {
  for (const id of live.timers) clearTimeout(id)
  live.timers.clear()
  for (const p of [...live.pages]) await p.unmount()
  for (const env of live.envs) env.h.dispose()
  live.envs.clear()
})

function fresh(opts = {}) {
  sdk.notifications.length = 0
  sdk.workspaces.clear()
  sdk.openedSessions.length = 0
  sdk.pluginDecisions.set(opts.decisions ?? {})
  sdk.locale.set('zh')
  sdk.state.focusedStoredSessionId.set('session' in opts ? opts.session : 'local-s1')
  const backend = fakeBackend(opts)
  const h = makeCtx({ rest: backend.rest })
  const intervals = []
  const timeouts = []
  h.ctx.setInterval = (fn) => (intervals.push(fn), () => {})
  if (opts.fakeTimeouts) h.ctx.setTimeout = (fn, ms) => (timeouts.push({ fn, ms }), () => {})
  else
    h.ctx.setTimeout = (fn, ms) => {
      const id = setTimeout(() => {
        live.timers.delete(id)
        fn()
      }, ms)
      live.timers.add(id)
      return () => (clearTimeout(id), live.timers.delete(id))
    }
  h.ctx.os = { pickOpenPath: async () => opts.pick ?? PATH, revealPath: async () => true }
  const settingsPages = []
  h.ctx.registerSettingsPage = (p) => (settingsPages.push(p), () => {})
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  const poll = async () => {
    for (const fn of intervals) fn()
    await flush()
  }
  const env = { h, backend, poll, timeouts, settingsPages }
  live.envs.add(env)
  return env
}

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => tick(0))
}

async function mount(render) {
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(createElement(render)))
  await flush()
  const page = {
    el,
    unmount: async () => {
      if (!live.pages.delete(page)) return
      await act(async () => root.unmount())
      el.remove()
    }
  }
  live.pages.add(page)
  return page
}

async function openPage(env, path = PATH) {
  const run = env.h.find('palette', (c) => c.data.id === 'diple-docs.open').data.run
  run()
  await flush()
  const ws = sdk.workspaces.get(`diple-docs:${path}`)
  assert.ok(ws, 'workspace opened')
  return mount(() => ws.render())
}

/** Select the nth occurrence of `needle` in root's text, across element boundaries. */
function selectText(root, needle, nth = 0) {
  const walker = document.createTreeWalker(root, 4)
  const nodes = []
  let all = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ n, at: all.length })
    all += n.data
  }
  let i = all.indexOf(needle)
  for (let k = 0; k < nth && i >= 0; k++) i = all.indexOf(needle, i + 1)
  if (i < 0) throw new Error(`text not found: ${needle}`)
  const point = (off, end) => {
    const hit = nodes.findLast((x) => (end ? x.at < off : x.at <= off))
    return [hit.n, off - hit.at]
  }
  const r = document.createRange()
  r.setStart(...point(i, false))
  r.setEnd(...point(i + needle.length, true))
  const sel = document.getSelection()
  sel.removeAllRanges()
  sel.addRange(r)
}

async function pressAnnotateKey() {
  await act(async () => {
    window.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'e', code: 'KeyE', metaKey: true, shiftKey: true, bubbles: true }))
  })
  await flush()
}

const doc = (el) => el.querySelector('[data-diple-docs-doc]')
const cards = (el) => [...el.querySelectorAll('[data-er-item]')]
const click = async (node) => {
  assert.ok(node, 'element to click')
  await act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await flush()
}
const lastNote = () => sdk.notifications.at(-1)
// The send menu (V2.1 #8, after Orca): 「发送这一条」 on a card or 「发送 N 条 ▾」 on the list
// opens it; a target is picked by its key: 'current' | 'queue' (加入聊天待发) |
// 'session:<id>' | 'copy'. A scope ('scope-item' | 'scope-unsent') may be picked first.
const menuTrigger = (el, from = null) =>
  from === 'list' ? el.querySelector('[data-er-send-menu-open]') : el.querySelector(from ? `[data-er-item="${from}"] [data-er-send-one]` : '[data-er-send-one]')
const menuItem = (el, key) => el.querySelector(`[data-er-send-menu] [data-send-item="${key}"]`)
const sendVia = async (page, target, { from = null, scope = null } = {}) => {
  await click(menuTrigger(page.el, from))
  if (scope) await click(menuItem(page.el, scope))
  await click(menuItem(page.el, target))
}
/** Pick a value in a native <select> (the stub SDK has no Select). */
const choose = async (select, value) => {
  assert.ok(select, 'select exists')
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLSelectElement.prototype, 'value').set.call(select, value)
    select.dispatchEvent(new w.Event('change', { bubbles: true }))
  })
  await flush()
}

test('register contributes palette rows, an unbound keybind, the card directive and a settings page', async () => {
  const { h, settingsPages } = fresh()
  await flush()
  const ids = h.contributions.filter((c) => c.area === 'palette').map((c) => c.data.id)
  for (const id of ['diple-docs.open', 'diple-docs.recent', 'diple-docs.add', 'diple-docs.recent.0']) assert.ok(ids.includes(id), id)
  const kb = h.find('keybinds', (c) => c.data.id === 'diple-docs.add')
  assert.deepEqual(kb.data.defaults, [], '⌘⇧E stays with the Diple plugin; the page listens itself')
  assert.equal(h.find('transcript.directives').data.name, 'diple-docs')
  assert.equal(settingsPages.length, 1)
})

test('S45: ⌘K "圈批·文档：打开文档…" opens a workspace tab; other suffixes are refused', async () => {
  const ok = fresh()
  await ok.h.find('palette', (c) => c.data.id === 'diple-docs.open').data.run()
  await flush()
  assert.ok(sdk.workspaces.has(`diple-docs:${PATH}`))
  assert.equal(sdk.workspaces.get(`diple-docs:${PATH}`).title, 'plan.md')

  const md = fresh({ pick: '/work/notes.markdown' })
  await md.h.find('palette', (c) => c.data.id === 'diple-docs.open').data.run()
  await flush()
  assert.ok(sdk.workspaces.has('diple-docs:/work/notes.markdown'))

  const bad = fresh({ pick: '/work/notes.txt' })
  await bad.h.find('palette', (c) => c.data.id === 'diple-docs.open').data.run()
  await flush()
  assert.equal(sdk.workspaces.size, 0)
  assert.match(lastNote().message, /notes\.txt.*\.md/)
})

test('S47: recent reviews appear as ⌘K rows and in the recent tab', async () => {
  const env = fresh()
  await flush()
  const row = env.h.find('palette', (c) => c.data.id === 'diple-docs.recent.0')
  assert.equal(row.data.label, '最近的文档：plan.md')
  row.data.run()
  assert.ok(sdk.workspaces.has(`diple-docs:${PATH}`))
  env.h.find('palette', (c) => c.data.id === 'diple-docs.recent').data.run()
  const tab = sdk.workspaces.get('diple-docs:recent')
  const page = await mount(() => tab.render())
  assert.match(page.el.textContent, /plan\.md/)
  await page.unmount()
})

test('S46: the ::diple-docs card opens the review; non-markdown paths render inert', async () => {
  const env = fresh()
  const render = env.h.find('transcript.directives').data.render
  const good = await mount(() => render({ attrs: { path: PATH }, source: '', streaming: false }))
  assert.match(good.el.textContent, /用圈批·文档打开 · plan\.md/)
  await click(good.el.querySelector('[data-er-open-review]'))
  assert.ok(sdk.workspaces.has(`diple-docs:${PATH}`))
  const bad = await mount(() => render({ attrs: { path: '/work/x.txt' }, source: '', streaming: false }))
  assert.equal(bad.el.querySelector('[data-er-open-review]'), null)
  assert.match(bad.el.textContent, /只支持/)
  await good.unmount()
  await bad.unmount()
})

test('S48/S49/S50: select in the rendered view, ⌘⇧E adds an annotation anchored in the SOURCE', async () => {
  const env = fresh()
  const page = await openPage(env)
  assert.ok(doc(page.el).querySelector('strong'), 'rendered markdown')
  selectText(doc(page.el), '更新数据库，再删除')
  await pressAnnotateKey()
  // V3-D3 #2: a draft — nothing stored until 保存
  assert.equal(env.backend.calls.find((c) => c.path === '/items' && c.method === 'POST'), undefined, 'no POST before 保存')
  assert.equal(cards(page.el).length, 0)
  // the draft's comment editor has focus: type and press Enter
  const editor = page.el.querySelector('.er-editor')
  assert.equal(document.activeElement, editor)
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set
    set.call(editor, '为什么不是先删缓存？')
    editor.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
  const add = env.backend.calls.find((c) => c.path === '/items' && c.method === 'POST')
  assert.ok(add, 'POST /items')
  assert.equal(add.body.anchor.text, '**更新数据库**，再删除', 'a half-selected bold marker is pulled in')
  assert.equal(add.body.anchor.line, 3)
  assert.equal(add.body.comment, '为什么不是先删缓存？', 'stored with its words, in one request')
  assert.equal(env.backend.calls.find((c) => c.method === 'PATCH'), undefined)
  assert.equal(cards(page.el).length, 1)
  assert.match(cards(page.el)[0].textContent, /为什么不是先删缓存/)
  await page.unmount()
})

test('S49: the floating "标注" button appears for a selection in the document and adds on click', async () => {
  const env = fresh()
  const page = await openPage(env)
  selectText(doc(page.el), '第二段')
  await act(async () => document.dispatchEvent(new w.Event('selectionchange')))
  await act(async () => tick(150))
  await flush()
  const btn = page.el.querySelector('[data-diple-docs-pick]')
  assert.ok(btn, 'floating button')
  assert.match(btn.textContent, /标注/)
  await click(btn)
  assert.equal(env.backend.items.length, 0, 'a draft first (V3-D3)')
  await click(page.el.querySelector('[data-er-float-save]'))
  assert.equal(env.backend.items[0].text, '第二段')
  await page.unmount()
})

test('S50: the source view shows the Markdown and annotations from it too', async () => {
  const env = fresh()
  const page = await openPage(env)
  await click(page.el.querySelector('[role="radio"]:not([aria-checked="true"])') ?? [...page.el.querySelectorAll('button')].find((b) => b.textContent === '源码'))
  assert.equal(doc(page.el).dataset.view, 'source')
  assert.match(doc(page.el).textContent, /\*\*更新数据库\*\*/)
  selectText(doc(page.el), '**更新数据库**')
  await pressAnnotateKey()
  await act(async () => page.el.querySelector('.er-editor').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
  assert.equal(env.backend.items[0].text, '**更新数据库**')
  await page.unmount()
})

test('S48: clicking shaded text in the document expands and focuses its card', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '细化' }), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  assert.equal(doc(page.el).dataset.erPainted, '2', 'both annotations painted')
  const walker = document.createTreeWalker(doc(page.el), 4)
  let node = walker.nextNode()
  while (node && !node.data.includes('第二段')) node = walker.nextNode()
  document.caretRangeFromPoint = () => {
    const r = document.createRange()
    r.setStart(node, node.data.indexOf('第二段') + 1)
    return r
  }
  await act(async () => doc(page.el).dispatchEvent(new w.MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 })))
  await act(async () => tick(60))
  await flush()
  const card = page.el.querySelector('[data-er-item="r0001"]')
  assert.ok(card.classList.contains('is-active'))
  assert.equal(document.activeElement, card)
  assert.ok(card.querySelector('[data-er-action="resolve"]'), 'expanded: actions shown')
  delete document.caretRangeFromPoint
  await page.unmount()
})

test('S60: the review page is read-only (no editable document surface)', async () => {
  const env = fresh()
  const page = await openPage(env)
  assert.equal(doc(page.el).querySelector('[contenteditable], textarea, input'), null)
  assert.match(page.el.textContent, /只读/)
  await page.unmount()
})

test('S52 / V2.1 #8: 发送这一条 → 加入聊天待发 hands off with origin + revision, and a receipt confirms it', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '这里要细化' }))
  const page = await openPage(env)
  await click(cards(page.el)[0])
  await sendVia(page, 'queue')
  const ho = env.backend.handoffs[0]
  assert.equal(ho.v, 1)
  assert.equal(ho.targetSessionId, 'local-s1')
  assert.equal(ho.sendNow, false)
  assert.deepEqual(ho.items, [
    { origin: { plugin: 'diple-docs', itemId: 'r0001', revision: 1, path: PATH, line: 5 }, text: '第二段', comment: '这里要细化' }
  ])
  await act(async () => env.h.emit('plugin.diple.handoff.receipt', { v: 1, handoffId: ho.handoffId, accepted: ['r0001'] }))
  await flush()
  assert.equal(env.backend.receipts[0].kind, 'receipt')
  assert.equal(lastNote().kind, 'success')
  assert.match(lastNote().message, /1 条标注加入待发/)
  await page.unmount()
})

test('S52 / V2.1 #8: 发送 N 条 → 当前会话 sets sendNow and carries every pending item', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1), item('r0003', '更新数据库', 3, { status: 'answered' }))
  const page = await openPage(env)
  const bulk = page.el.querySelector('[data-er-send-menu-open]')
  assert.match(bulk.textContent, /发送 2 条/)
  await sendVia(page, 'current', { from: 'list' })
  const ho = env.backend.handoffs[0]
  assert.equal(ho.sendNow, true)
  assert.deepEqual(ho.items.map((i) => i.origin.itemId), ['r0002', 'r0001'], 'document order')
  await act(async () => env.h.emit('plugin.diple.handoff.receipt', { v: 1, handoffId: ho.handoffId, accepted: ['r0002', 'r0001'], batchId: 'b1' }))
  await flush()
  assert.match(lastNote().message, /已提交 2 条/)
  await act(async () => env.h.emit('plugin.diple.handoff.settled', { v: 1, handoffId: ho.handoffId, batchId: 'b1', delivered: true }))
  await flush()
  assert.match(lastNote().message, /已发送 2 条/)
  await page.unmount()
})

test('V2-X (R8 XV-02 class): a comment still being typed is saved first and the hand-off carries it', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '旧的意见' }))
  const page = await openPage(env)
  await click(cards(page.el)[0])
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  const editor = page.el.querySelector('.er-editor')
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(editor, '还在写的新意见')
    editor.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
  // no Enter, no blur: straight to 直接发送
  await sendVia(page, 'current')
  await flush()
  assert.equal(env.backend.items.find((i) => i.id === 'r0001').comment, '还在写的新意见', 'saved')
  assert.equal(env.backend.handoffs[0]?.items[0].comment, '还在写的新意见', 'sent the words on screen')
  await page.unmount()
})

test('S62: no receipt within 3 s → the hand-off is cancelled and send buttons are disabled with a reason', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  await click(cards(page.el)[0])
  await sendVia(page, 'queue')
  const timer = env.timeouts.find((x) => x.ms === 3000)
  assert.ok(timer, '3 s receipt timer')
  await act(async () => timer.fn())
  await flush()
  assert.equal(env.backend.receipts[0].kind, 'cancel')
  assert.match(lastNote().message, /等待超时.*还没有确认收到/)
  assert.ok(page.el.querySelector('[data-er-peer="missing"]'))
  // XR11-10: the menu still opens (复制给 AI needs no Diple); its send targets are off
  assert.equal(page.el.querySelector('[data-er-send-one]').disabled, false)
  await click(menuTrigger(page.el, 'r0001'))
  assert.equal(menuItem(page.el, 'queue').disabled, true)
  assert.equal(menuItem(page.el, 'copy').disabled, false)
  await act(async () => document.activeElement?.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await flush()
  assert.match(page.el.textContent, /标注清单照常可用/)
  // the list still works: resolve is allowed
  await click(page.el.querySelector('[data-er-action="resolve"]'))
  assert.equal(env.backend.items[0].status, 'resolved')
  await page.unmount()
})

test('S62: Diple switched off in plugin decisions → disabled at once, nothing broadcast', async () => {
  const env = fresh({ decisions: { annotation: false } })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  assert.ok(page.el.querySelector('[data-er-peer="disabled"]'))
  // XR11-10: the menu opens for 复制给 AI; sending is what is off
  assert.equal(page.el.querySelector('[data-er-send-menu-open]').disabled, false)
  await click(page.el.querySelector('[data-er-send-menu-open]'))
  assert.equal(menuItem(page.el, 'current').disabled, true)
  assert.equal(menuItem(page.el, 'copy').disabled, false)
  assert.equal(env.backend.handoffs.length, 0)
  await page.unmount()
})

test('S53/S54/S57: batch.sent → 已发 with the session; batch.answered → 已回应; session chip opens it', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: 'c' }))
  const page = await openPage(env)
  const origin = { plugin: 'diple-docs', itemId: 'r0001', revision: 1, path: PATH, line: 5 }
  await act(async () => env.h.emit('plugin.diple.batch.sent', { v: 1, batchId: 'b1', sessionId: 'local-s1', items: [{ origin }] }))
  await flush()
  assert.equal(cards(page.el)[0].dataset.erStatus, 'sent')
  const chip = page.el.querySelector('.er-session')
  assert.equal(chip.textContent, '缓存讨论')
  await click(chip)
  assert.deepEqual(sdk.openedSessions, ['local-s1'])
  await act(async () => env.h.emit('plugin.diple.batch.answered', { v: 1, batchId: 'b1', answered: [{ origin }] }))
  await flush()
  assert.equal(cards(page.el)[0].dataset.erStatus, 'answered')
  // events about other plugins' items are not relayed
  const before = env.backend.calls.length
  await act(async () => env.h.emit('plugin.diple.batch.sent', { v: 1, batchId: 'b2', sessionId: 's', items: [{ origin: { plugin: 'diple' } }] }))
  assert.equal(env.backend.calls.length, before)
  await page.unmount()
})

test('S55: editing an answered comment sends PATCH; resolved items can be reopened', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: 'old', status: 'answered' }), item('r0002', '缓存方案', 1, { status: 'resolved' }))
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  const editor = page.el.querySelector('.er-editor')
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(editor, 'new')
    editor.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
  assert.equal(page.el.querySelector('[data-er-item="r0001"]').dataset.erStatus, 'pending')
  await click(page.el.querySelector('[data-er-resolved-toggle]'))
  await click(page.el.querySelector('[data-er-item="r0002"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '重新打开'))
  assert.equal(env.backend.items.find((i) => i.id === 'r0002').status, 'pending')
  await page.unmount()
})

test('IME: Enter while composing does not save the comment', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  const editor = page.el.querySelector('.er-editor')
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true, bubbles: true })))
  await flush()
  assert.ok(page.el.querySelector('.er-editor'), 'editor stays open')
  assert.equal(env.backend.calls.filter((c) => c.method === 'PATCH').length, 0)
  // Escape cancels without saving
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await flush()
  assert.equal(page.el.querySelector('.er-editor'), null)
  assert.equal(env.backend.calls.filter((c) => c.method === 'PATCH').length, 0)
  await page.unmount()
})

test('S56: filters by status with counts; resolved are folded by default', async () => {
  const env = fresh()
  env.backend.items.push(
    item('r0001', '第二段', 5),
    item('r0002', '缓存方案', 1, { status: 'sent' }),
    item('r0003', '更新数据库', 3, { status: 'resolved' })
  )
  const page = await openPage(env)
  assert.deepEqual(cards(page.el).map((c) => c.dataset.erItem), ['r0002', 'r0001'])
  const filter = (f) => page.el.querySelector(`[data-er-filter="${f}"]`)
  assert.match(filter('all').textContent, /全部3/)
  assert.match(filter('resolved').textContent, /已解决1/)
  await click(filter('sent'))
  assert.deepEqual(cards(page.el).map((c) => c.dataset.erItem), ['r0002'])
  await click(filter('resolved'))
  assert.deepEqual(cards(page.el).map((c) => c.dataset.erItem), ['r0003'])
  await click(filter('all'))
  await click(page.el.querySelector('[data-er-resolved-toggle]'))
  assert.equal(cards(page.el).length, 3)
  await page.unmount()
})

test('S58: after the file changes, annotations re-anchor; missing ones become 原文已变 and can be re-picked', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: 'keep me' }), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  env.backend.text = '# 缓存方案\n\n新插入的一段。\n\n全新的内容。\n'
  env.backend.mtime = 2
  await env.poll()
  await flush()
  const locate = env.backend.calls.filter((c) => c.path === '/items/locate').at(-1)
  assert.deepEqual(locate.body.results.find((r) => r.id === 'r0001'), { id: 'r0001', lost: true })
  const lost = page.el.querySelector('[data-er-item="r0001"]')
  assert.equal(lost.dataset.erStatus, 'changed')
  assert.match(lost.textContent, /原第 5 行/)
  assert.equal(page.el.querySelector('[data-er-item="r0002"]').dataset.erStatus, 'pending')
  // re-pick a new original for the changed one
  await click(lost)
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '重新选取原文'))
  assert.match(page.el.textContent, /替换第 \d 条标注/)
  selectText(doc(page.el), '全新的内容')
  await pressAnnotateKey()
  const rep = env.backend.calls.find((c) => c.method === 'PATCH' && c.body.op === 'replace')
  assert.equal(rep.body.anchor.text, '全新的内容')
  const now = page.el.querySelector('[data-er-item="r0001"]')
  assert.equal(now.dataset.erStatus, 'pending')
  assert.match(now.textContent, /keep me/)
  await page.unmount()
})

test('S59: while a comment is being written, a file change waits; it applies after the editor closes', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  env.backend.text = '# 缓存方案\n\n改过的文档。\n\n第二段说明文字。\n'
  env.backend.mtime = 3
  await env.poll()
  assert.match(page.el.textContent, /文件已更新，写完意见后自动刷新/)
  assert.doesNotMatch(doc(page.el).textContent, /改过的文档/)
  const editor = page.el.querySelector('.er-editor')
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await flush()
  assert.match(doc(page.el).textContent, /改过的文档/)
  assert.doesNotMatch(page.el.textContent, /写完意见后自动刷新/)
  await page.unmount()
})

test('S51: the list belongs to the file — switching conversations keeps it; the target follows', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  assert.match(page.el.textContent, /发送到：缓存讨论/)
  await act(async () => sdk.state.focusedStoredSessionId.set('local-s2'))
  await flush()
  assert.equal(cards(page.el).length, 1)
  assert.match(page.el.textContent, /发送到：未命名会话/)
  await act(async () => sdk.state.focusedStoredSessionId.set(null))
  await flush()
  assert.match(page.el.textContent, /没有打开的会话/)
  // XR11-10: no session still copies
  assert.equal(page.el.querySelector('[data-er-send-menu-open]').disabled, false)
  await page.unmount()
})

test('deleting an annotation offers undo, which restores it', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click(page.el.querySelector('[data-er-action="remove"]'))
  assert.equal(cards(page.el).length, 0)
  const note = lastNote()
  assert.equal(note.action.label, '撤销')
  await act(async () => note.action.onClick())
  await flush()
  assert.equal(cards(page.el).length, 1)
  await page.unmount()
})

test('a missing file shows a clear error and keeps the list', async () => {
  const env = fresh()
  env.backend.exists = false
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  assert.match(page.el.textContent, /找不到这个文件/)
  assert.equal(cards(page.el).length, 1)
  await page.unmount()
})

test('settings: language override switches labels; the card switch is mirrored to the backend', async () => {
  const env = fresh()
  const page = await mount(() => env.settingsPages[0].render())
  await choose(page.el.querySelector('[data-diple-docs-choice]'), 'en')
  assert.match(page.el.textContent, /Add an “Open in Diple Docs” card/)
  assert.match(page.el.textContent, /^Diple \(›\) is the mark/, 'the one-line note on the name comes first')
  assert.equal(env.h.find('palette', (c) => c.data.id === 'diple-docs.open' && c.data.label.startsWith('Diple Docs: Open')) != null, true)
  const sw = page.el.querySelector('#er-autocard')
  await act(async () => sw.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await flush()
  const put = env.backend.calls.filter((c) => c.path === '/settings' && c.method === 'PUT').at(-1)
  assert.deepEqual(put.body, { autoCard: false })
  await page.unmount()
})

function item(id, text, line, extra = {}) {
  return {
    id,
    path: PATH,
    anchor: { text, before: '', after: '', line },
    text,
    comment: '',
    status: 'pending',
    lost: false,
    revision: 1,
    mutation: 1,
    sentSessions: [],
    queued: null,
    createdAt: Number(id.slice(1)),
    updatedAt: 0,
    ...extra
  }
}

test('XR-01: a refused real target (symlink to credentials, a pipe) shows the reason, not the content', async () => {
  for (const [code, status, text] of [['sensitive-path', 403, /凭据或 Hermes 内部数据/], ['not-regular', 415, /不是普通文件/]]) {
    const env = fresh()
    env.backend.fileError = { code, status }
    const page = await openPage(env)
    assert.match(page.el.textContent, text)
    assert.equal(doc(page.el).querySelector('strong'), null, 'no document content')
    await page.unmount()
  }
})

test('XR-06: a refresh already in flight when the editor opens is held back, then applied on close', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  let open
  env.backend.fileGate = new Promise((r) => (open = r))
  env.backend.text = '# 缓存方案\n\n在途的新版本。\n\n第二段说明文字。\n'
  env.backend.mtime = 4
  await env.poll() // the poll sees the new mtime and starts reading the file (held at the gate)
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  env.backend.fileGate = null
  open()
  await flush()
  assert.doesNotMatch(doc(page.el).textContent, /在途的新版本/, 'not applied while the comment is being written')
  assert.match(page.el.textContent, /文件已更新，写完意见后自动刷新/)
  assert.ok(page.el.querySelector('.er-editor'), 'the editor stays put')
  const editor = page.el.querySelector('.er-editor')
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await flush()
  assert.match(doc(page.el).textContent, /在途的新版本/)
  await page.unmount()
})

test('XR-05: identical copies are told apart across an unrelated edit seen by this page', async () => {
  const UNIT = 'L'.repeat(34) + '同样的待办' + 'R'.repeat(34) + '\n'
  const text = '# 计划\n\n' + UNIT + UNIT + '\n中间。\n\n' + UNIT
  const env = fresh({ text })
  const page = await openPage(env)
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '源码'))
  selectText(doc(page.el), '同样的待办', 1)
  await pressAnnotateKey()
  // V3-D3: 保存 the draft (empty → 划线)
  const editor = page.el.querySelector('.er-editor')
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
  const added = env.backend.items[0]
  assert.equal(added.anchor.line, 4)
  assert.ok(added.anchor.sig, 'the anchor records its document version')
  env.backend.text = text.replace('中间。', '中间，改长了。')
  env.backend.mtime = 2
  await env.poll()
  await flush()
  const locate = env.backend.calls.filter((c) => c.path === '/items/locate').at(-1)
  const r = locate.body.results.find((x) => x.id === added.id)
  assert.equal(r.lost, undefined, 'still located')
  assert.equal(r.anchor.line, 4)
  // a block inserted in front of identical copies is not guessed
  env.backend.text = UNIT + env.backend.text
  env.backend.mtime = 3
  await env.poll()
  await flush()
  const r2 = env.backend.calls.filter((c) => c.path === '/items/locate').at(-1).body.results.find((x) => x.id === added.id)
  assert.equal(r2.lost, undefined, 'line 1 insert before "# 计划" keeps the prefix/suffix explanation unique')
  await page.unmount()
})

test('XR-07: an annotation holding an invalid numeric entity still renders its card', async () => {
  const env = fresh({ text: '# 实体\n\nx &#xFFFFFF; y\n' })
  env.backend.items.push(item('r0001', 'x &#xFFFFFF; y', 3))
  const page = await openPage(env)
  assert.equal(cards(page.el).length, 1)
  // V2-D: the quote goes through the host's Markdown renderer (the real one shows U+FFFD;
  // the stub renderer leaves the entity as written) — what matters is that the card renders
  assert.match(cards(page.el)[0].querySelector('.er-quote').textContent, /x (\uFFFD|&#xFFFFFF;) y/)
  await page.unmount()
})

const typeInto = async (editor, value) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(editor, value)
    editor.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
}

test('XR-04: a comment saved elsewhere meanwhile is not overwritten; the draft stays and can be applied on purpose', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: 'old' }))
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  // another window saves first
  Object.assign(env.backend.items[0], { comment: 'window A', revision: 2, mutation: 2 })
  env.backend.version++
  await env.poll()
  const editor = page.el.querySelector('.er-editor')
  assert.ok(editor, 'the editor is not reset by the refresh')
  await typeInto(editor, 'window B draft')
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
  const first = env.backend.calls.filter((c) => c.method === 'PATCH').at(-1)
  assert.equal(first.body.expectMutation, 1, 'saved against the version editing started from')
  assert.equal(env.backend.items[0].comment, 'window A', 'the newer comment survives')
  assert.equal(page.el.querySelector('.er-editor').value, 'window B draft', 'the draft is kept')
  const conflict = page.el.querySelector('[data-er-conflict]')
  assert.ok(conflict, 'conflict notice')
  assert.match(conflict.textContent, /window A/)
  await click(conflict.querySelector('[data-er-conflict-action="overwrite"]'))
  assert.equal(env.backend.items[0].comment, 'window B draft')
  assert.equal(env.backend.calls.filter((c) => c.method === 'PATCH').at(-1).body.expectMutation, 2)
  assert.equal(page.el.querySelector('.er-editor'), null)
  await page.unmount()
})

test('XR-04: resolve / reopen / replace carry the version they were made against', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  Object.assign(env.backend.items[0], { revision: 3, mutation: 4 })
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click(page.el.querySelector('[data-er-action="resolve"]'))
  const p = env.backend.calls.filter((c) => c.method === 'PATCH').at(-1)
  assert.deepEqual(p.body, { op: 'resolve', expectMutation: 1 })
  assert.equal(env.backend.items[0].status, 'pending', 'stale resolve rejected')
  assert.match(lastNote().message, /刚在别处被修改过/)
  // after the refresh the same click works
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click(page.el.querySelector('[data-er-action="resolve"]'))
  assert.equal(env.backend.items[0].status, 'resolved')
  await page.unmount()
})

async function sendOne(env, page, target = 'current', id = 'r0001') {
  await click(page.el.querySelector(`[data-er-item="${id}"]`))
  await sendVia(page, target, { from: id })
  return env.backend.handoffs.at(-1)
}
const receipt = (env, body) => act(async () => env.h.emit('plugin.diple.handoff.receipt', { v: 1, ...body }))

test('XR-09: "直接发送" only says 已发送 when the receipt carries a batch; otherwise it says what happened', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  let ho = await sendOne(env, page)
  await receipt(env, { handoffId: ho.handoffId, accepted: ['r0001'] }) // added, but the send failed / was refused
  await flush()
  assert.equal(lastNote().kind, 'warning')
  assert.match(lastNote().message, /加入待发列表，但没有立即发出/)
  assert.doesNotMatch(lastNote().message, /已发送/)

  ho = await sendOne(env, page)
  await receipt(env, { handoffId: ho.handoffId, accepted: ['r0001'], queued: true })
  await flush()
  assert.match(lastNote().message, /回答完后发出/)

  ho = await sendOne(env, page)
  await receipt(env, { handoffId: ho.handoffId, accepted: ['r0001'], batchId: 'b9' })
  await flush()
  // XR-09 (R2): a receipt with a batch is "submitted", not yet "sent"
  assert.match(lastNote().message, /已提交 1 条.*等待.*确认/)
  assert.doesNotMatch(lastNote().message, /已发送/)
  await page.unmount()
})

test('XR-09: a receipt that accepts fewer items than were handed over says so', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  await sendVia(page, 'queue', { from: 'list' })
  const ho = env.backend.handoffs.at(-1)
  await receipt(env, { handoffId: ho.handoffId, accepted: ['r0002'] })
  await flush()
  assert.match(lastNote().message, /1 条标注加入待发.*另有 1 条没有被接收/)
  await page.unmount()
})

test('XR-03: the 3 s clock starts once the hand-off is broadcast, not while it is being saved', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  let open
  env.backend.handoffGate = new Promise((r) => (open = r))
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await sendVia(page, 'current')
  assert.equal(env.timeouts.filter((x) => x.ms === 3000).length, 0, 'no receipt timer before the broadcast')
  env.backend.handoffGate = null
  open()
  await flush()
  assert.equal(env.timeouts.filter((x) => x.ms === 3000).length, 1)
  await page.unmount()
})

test('XR-03: a timeout is "not confirmed", a late receipt is reported, and a re-send needs an explicit choice', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const ho = await sendOne(env, page)
  await act(async () => env.timeouts.find((x) => x.ms === 3000).fn())
  await flush()
  assert.match(lastNote().message, /没有确认收到.*不要重复发送/)
  assert.doesNotMatch(lastNote().message, /没有发出去/)
  // the user checks again and presses send again before anything arrived
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '重新检测'))
  const before = env.backend.handoffs.length
  await sendOne(env, page)
  assert.equal(env.backend.handoffs.length, before, 'no second hand-off without asking')
  const ask = lastNote()
  assert.match(ask.message, /还没有确认.*可能已经发出/)
  assert.equal(ask.action.label, '仍然发送')
  // meanwhile the late receipt of the first hand-off arrives
  await receipt(env, { handoffId: ho.handoffId, accepted: ['r0001'], batchId: 'b-late' })
  await flush()
  assert.match(lastNote().message, /刚确认了上次的交接.*已提交 1 条/)
  assert.equal(page.el.querySelector('[data-er-peer]'), null, 'peer is back')
  // once confirmed, sending again is an ordinary send
  const n = env.backend.handoffs.length
  await sendOne(env, page)
  assert.equal(env.backend.handoffs.length, n + 1)
  await page.unmount()
})

test('XR-03: "仍然发送" first replays the old hand-off under its own id; a new one only after a second yes', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const old = await sendOne(env, page)
  await act(async () => env.timeouts.find((x) => x.ms === 3000).fn())
  await flush()
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '重新检测'))
  const before = env.backend.handoffs.length
  await sendOne(env, page)
  await act(async () => lastNote().action.onClick())
  await flush()
  assert.deepEqual(env.backend.replays, [old.handoffId], 'replayed under the old id')
  assert.equal(env.backend.handoffs.length, before, 'no new hand-off id')
  // the receiver answers the replay with the result it already had
  await receipt(env, { handoffId: old.handoffId, accepted: ['r0001'] })
  await flush()
  assert.match(lastNote().message, /已把 1 条标注加入待发列表/)
  await page.unmount()
})

test('XR-03: when the old hand-off cannot be replayed, re-sending needs a second confirmation', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  env.backend.unconfirmed = [{ handoffId: 'h-old', itemIds: ['r0001'] }]
  env.backend.replayAnswer = { replayed: false, reason: 'stale' }
  const page = await openPage(env)
  const before = env.backend.handoffs.length
  await sendOne(env, page)
  await act(async () => lastNote().action.onClick())
  await flush()
  assert.deepEqual(env.backend.replays, ['h-old'])
  assert.equal(env.backend.handoffs.length, before)
  const ask = lastNote()
  assert.match(ask.message, /没有找到上次交接的结果/)
  assert.equal(ask.action.label, '重新发送')
  await act(async () => ask.action.onClick())
  await flush()
  assert.equal(env.backend.handoffs.length, before + 1, 'a new hand-off only now')
  await page.unmount()
})

test('XR-03: replaying finds a receipt the backend already has: its result is shown, nothing is sent', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  env.backend.unconfirmed = [{ handoffId: 'h-old', itemIds: ['r0001'] }]
  env.backend.replayAnswer = { replayed: false, receipt: { v: 1, handoffId: 'h-old', accepted: ['r0001'] } }
  const page = await openPage(env)
  const before = env.backend.handoffs.length
  await sendOne(env, page)
  await act(async () => lastNote().action.onClick())
  await flush()
  assert.equal(env.backend.handoffs.length, before)
  assert.match(lastNote().message, /已把 1 条标注加入待发列表/)
  await page.unmount()
})

test('XR-03: an unconfirmed hand-off from before a reload (or another window) still asks before re-sending', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5))
  env.backend.unconfirmed = [{ handoffId: 'h-old', itemIds: ['r0001'] }]
  const page = await openPage(env)
  const before = env.backend.handoffs.length
  await sendOne(env, page)
  assert.equal(env.backend.handoffs.length, before)
  assert.equal(lastNote().action.label, '仍然发送')
  await page.unmount()
})

// XR2-01 contract: the page and the backend agree that resolve moves the edit token.
test('XR2-01: B starts editing → A resolves → B saves: B gets the conflict notice, the resolution stands', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: 'old' }))
  const page = await openPage(env)
  // window B opens the editor
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  // window A resolves, with the request A's page makes
  await env.backend.rest('/items/r0001', { method: 'PATCH', body: { op: 'resolve', expectMutation: 1 } })
  assert.equal(env.backend.items[0].status, 'resolved')
  assert.equal(env.backend.items[0].revision, 1, 'origin revision unchanged by resolve')
  await env.poll()
  const editor = page.el.querySelector('.er-editor')
  assert.ok(editor, 'B keeps its editor')
  await typeInto(editor, 'B 的草稿')
  await act(async () => editor.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })))
  await flush()
  const save = env.backend.calls.filter((c) => c.method === 'PATCH').at(-1)
  assert.deepEqual(save.body, { op: 'comment', comment: 'B 的草稿', expectMutation: 1 })
  assert.equal(env.backend.items[0].status, 'resolved', 'not silently reopened')
  assert.equal(env.backend.items[0].comment, 'old')
  const conflict = page.el.querySelector('[data-er-conflict]')
  assert.ok(conflict, 'B sees the conflict')
  assert.match(conflict.textContent, /别处标为已解决/)
  assert.equal(page.el.querySelector('.er-editor').value, 'B 的草稿', 'the draft is kept')
  // B chooses to apply the draft anyway: that is an explicit reopen with the new comment
  await click(conflict.querySelector('[data-er-conflict-action="overwrite"]'))
  assert.equal(env.backend.calls.filter((c) => c.method === 'PATCH').at(-1).body.expectMutation, 2)
  assert.deepEqual([env.backend.items[0].comment, env.backend.items[0].status], ['B 的草稿', 'pending'])
  await page.unmount()
})

test('XR2-01: a reopen from another window also makes a stale resolve conflict', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { status: 'resolved' }))
  const page = await openPage(env)
  await click(page.el.querySelector('[data-er-resolved-toggle]'))
  await env.backend.rest('/items/r0001', { method: 'PATCH', body: { op: 'reopen', expectMutation: 1 } })
  await env.backend.rest('/items/r0001', { method: 'PATCH', body: { op: 'resolve', expectMutation: 2 } })
  // this page still shows mutation 1: its reopen must be refused, not applied on top
  await click(page.el.querySelector('[data-er-item="r0001"]'))
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '重新打开'))
  assert.equal(env.backend.calls.filter((c) => c.method === 'PATCH').at(-1).body.expectMutation, 1)
  assert.equal(env.backend.items[0].status, 'resolved')
  assert.match(lastNote().message, /刚在别处被修改过/)
  await page.unmount()
})

// XR-09 (R2): sending is two-phase. receipt{batchId} = submitted; plugin.diple.handoff.settled = final.
const settled = (env, body) => act(async () => env.h.emit('plugin.diple.handoff.settled', { v: 1, ...body }))
const fire = async (env, ms) => {
  const due = env.timeouts.filter((x) => x.ms === ms && !x.done)
  for (const x of due) {
    x.done = true
    await act(async () => x.fn())
  }
  await flush()
  return due.length
}

async function submitted(env, page, id = 'r0001') {
  const ho = await sendOne(env, page, 'current', id)
  await receipt(env, { handoffId: ho.handoffId, accepted: [id], batchId: 'b1' })
  await flush()
  return ho
}

test('XR-09: submitted → settled delivered → 已发送; the card says 等待确认 meanwhile', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const ho = await submitted(env, page)
  assert.match(lastNote().message, /已提交 1 条.*等待.*确认/)
  env.backend.items[0].queued = { sessionId: 'local-s1', revision: 1, batchId: 'b1', at: 1 }
  env.backend.version++
  await env.poll()
  assert.match(page.el.querySelector('[data-er-item="r0001"]').textContent, /已提交，等待确认/)
  await settled(env, { handoffId: ho.handoffId, batchId: 'b1', delivered: true })
  await flush()
  assert.equal(lastNote().kind, 'success')
  assert.match(lastNote().message, /已发送 1 条/)
  assert.deepEqual(env.backend.settled[ho.handoffId], { v: 1, handoffId: ho.handoffId, batchId: 'b1', delivered: true })
  await page.unmount()
})

test('XR-09: settled not delivered → back to pending, the reason is shown', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1)) // the 2nd hand-off: another one (a sent card's 发送这一条 is greyed)
  const page = await openPage(env)
  const ho = await submitted(env, page)
  // batch.sent is only an intermediate step: no 已发送 yet
  await act(async () => env.h.emit('plugin.diple.batch.sent', { v: 1, batchId: 'b1', sessionId: 'local-s1', items: [{ origin: handoffOrigin(ho) }] }))
  await flush()
  assert.doesNotMatch(lastNote().message, /已发送/)
  await settled(env, { handoffId: ho.handoffId, batchId: 'b1', delivered: false, reason: 'turn-error' })
  await flush()
  assert.equal(lastNote().kind, 'warning')
  assert.match(lastNote().message, /没有发出去.*回答出错.*放回待发/)
  assert.equal(env.backend.settled[ho.handoffId].delivered, false)
  // an unknown reason is shown as it came
  const ho2 = await submitted(env, page, 'r0002')
  await settled(env, { handoffId: ho2.handoffId, batchId: 'b1', delivered: false, reason: 'quota exceeded' })
  await flush()
  assert.match(lastNote().message, /quota exceeded/)
  await page.unmount()
})

test('XR-09: a settled for a hand-off this window did not make is recorded but not announced', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const n = sdk.notifications.length
  await settled(env, { handoffId: 'h-elsewhere', batchId: 'bx', delivered: true })
  await flush()
  assert.equal(sdk.notifications.length, n)
  assert.ok(env.backend.settled['h-elsewhere'])
  await page.unmount()
})

const handoffOrigin = (ho) => ho.items[0].origin

test('XR-09 fallback: an older Diple without settled — batch.answered settles it as sent', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const ho = await submitted(env, page)
  await act(async () => env.h.emit('plugin.diple.batch.answered', { v: 1, batchId: 'b1', answered: [{ origin: handoffOrigin(ho) }] }))
  await flush()
  assert.match(lastNote().message, /已发送 1 条/)
  assert.equal(env.backend.settled[ho.handoffId].inferred, 'batch.answered')
  await page.unmount()
})

test('XR-09 fallback: batch.sent then silence settles as sent; total silence stops waiting with a clear note', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1)) // the 2nd hand-off: another one (a sent card's 发送这一条 is greyed)
  const page = await openPage(env)
  const ho = await submitted(env, page)
  await act(async () => env.h.emit('plugin.diple.batch.sent', { v: 1, batchId: 'b1', sessionId: 'local-s1', items: [{ origin: handoffOrigin(ho) }] }))
  await flush()
  // polling first: the backend has nothing, one settle-rebroadcast goes out
  assert.ok((await fire(env, 5000)) >= 1)
  assert.equal(env.backend.calls.filter((c) => c.path === `/handoffs/${ho.handoffId}`).length >= 1, true, 'polled')
  await fire(env, 15000)
  assert.deepEqual(env.backend.rebroadcasts?.map((r) => [r.id, r.body]), [[ho.handoffId, { settle: true }]])
  await fire(env, 60000)
  assert.match(lastNote().message, /已发送 1 条/)
  assert.equal(env.backend.settled[ho.handoffId].inferred, 'batch.sent')

  const ho2 = await submitted(env, page, 'r0002')
  await fire(env, 60000)
  assert.equal(lastNote().kind, 'warning')
  assert.match(lastNote().message, /没有收到.*发送结果/)
  assert.equal(env.backend.settled?.[ho2.handoffId], undefined, 'nothing is made up')
  // a late real settled still lands
  await settled(env, { handoffId: ho2.handoffId, batchId: 'b1', delivered: true })
  await flush()
  assert.match(lastNote().message, /已发送 1 条/)
  await page.unmount()
})

test('XR-09: polling picks up a settled another window recorded', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const ho = await submitted(env, page)
  env.backend.settled = { [ho.handoffId]: { handoffId: ho.handoffId, batchId: 'b1', delivered: false, reason: 'refused' } }
  await fire(env, 5000)
  assert.match(lastNote().message, /没有发出去.*拒绝/)
  await page.unmount()
})

test('XR-09: a queued hand-off (busy session) is settled later by the same event', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  const ho = await sendOne(env, page)
  await receipt(env, { handoffId: ho.handoffId, accepted: ['r0001'], queued: true })
  await flush()
  assert.match(lastNote().message, /回答完后发出/)
  await settled(env, { handoffId: ho.handoffId, batchId: 'b7', delivered: true })
  await flush()
  assert.match(lastNote().message, /已发送 1 条/)
  await page.unmount()
})

test('XR-05: a 原文已变 card offers 重新选取原文 right away, without opening the card first', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '早已删掉的一句', 5, { comment: 'keep me', lost: true }))
  const page = await openPage(env)
  const card = page.el.querySelector('[data-er-item="r0001"]')
  assert.equal(card.dataset.erStatus, 'changed')
  const btn = card.querySelector('[data-er-reselect]')
  assert.ok(btn, 'visible on the closed card')
  assert.equal(btn.textContent, '重新选取原文')
  await click(btn)
  assert.match(page.el.textContent, /替换第 1 条标注/)
  await page.unmount()
})

test('XR-09: a settled that beats its receipt (the send failed at once) gives the final result directly', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  // the receiver settles first, then sends the receipt — as plugins/diple does on a failed start
  let ho
  env.backend.onHandoff = (body) => {
    ho = body
    queueMicrotask(() => {
      env.h.emit('plugin.diple.handoff.settled', { v: 1, handoffId: body.handoffId, batchId: 'bz', delivered: false, reason: 'refused' })
      env.h.emit('plugin.diple.handoff.receipt', { v: 1, handoffId: body.handoffId, accepted: ['r0001'] })
    })
  }
  await sendOne(env, page)
  await flush()
  assert.ok(ho)
  assert.match(lastNote().message, /没有发出去.*拒绝.*放回待发/)
  await page.unmount()
})

test('XR-09: receipt during the save round trip, settled before the save returns: still 已发送', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5))
  const page = await openPage(env)
  let open
  env.backend.onHandoff = (body) => {
    env.h.emit('plugin.diple.handoff.receipt', { v: 1, handoffId: body.handoffId, accepted: ['r0001'], batchId: 'bq' })
    env.h.emit('plugin.diple.handoff.settled', { v: 1, handoffId: body.handoffId, batchId: 'bq', delivered: true })
  }
  await sendOne(env, page)
  await flush()
  assert.match(lastNote().message, /已发送 1 条/)
  await page.unmount()
})

// R9 XV9-02: one send intent → at most one hand-off. The comment save the
// send waits for (V2-X) must not open a window where a second click starts a
// second hand-off: the send entries are locked from the first click on.
async function slowCommentSend(env, page) {
  await click(cards(page.el)[0])
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  const editor = page.el.querySelector('.er-editor')
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(editor, '保存中的意见')
    editor.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
  let release
  const gate = new Promise((r) => (release = r))
  const rest = env.h.ctx.rest
  const counts = { saves: 0 }
  env.h.ctx.rest = async (p, opts) => {
    if (opts?.method === 'PATCH' && opts.body?.op === 'comment') {
      counts.saves++
      await gate
    }
    return rest(p, opts)
  }
  // a real click blurs the box before onClick
  await act(async () => editor.blur())
  return { release: () => act(async () => (release(), tick(5))), counts }
}

// [trigger, target] pairs: the first send, then a second try while the comment is still saving
for (const [first, second] of [
  [['card', 'current'], ['card', 'current']],
  [['card', 'queue'], ['card', 'current']],
  [['card', 'current'], ['list', 'current']]
]) {
  test(`XV9-02 a second click while the comment is still saving starts no second hand-off (${first.join('→')} then ${second.join('→')})`, async () => {
    const env = fresh({ fakeTimeouts: true })
    env.backend.items.push(item('r0001', '第二段', 5, { comment: '旧意见' }))
    const page = await openPage(env)
    const slow = await slowCommentSend(env, page)
    const trigger = (from) => menuTrigger(page.el, from === 'list' ? 'list' : null)
    await click(trigger(first[0]))
    await click(menuItem(page.el, first[1]))
    const again = trigger(second[0])
    if (again) await act(async () => again.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
    const item2 = menuItem(page.el, second[1])
    // XR11-10: the menu opens (for 复制给 AI); the send targets in it are locked
    const lockedAtOnce = item2?.disabled === true
    if (item2) await act(async () => item2.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
    await flush()
    await slow.release()
    await flush()
    assert.equal(slow.counts.saves, 1)
    assert.equal(env.backend.handoffs.length, 1, 'one hand-off')
    assert.equal(env.backend.handoffs[0].items[0].comment, '保存中的意见')
    assert.equal(lockedAtOnce, true, 'locked from the first click on')
    await receipt(env, { handoffId: env.backend.handoffs[0].handoffId, accepted: ['r0001'], batchId: 'b1' })
    await flush()
    await page.unmount()
  })
}

test('XV9-02 a click after the hand-off went out but before its receipt starts no second one; the lock is released after', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '旧意见' }))
  const page = await openPage(env)
  const slow = await slowCommentSend(env, page)
  const btn = () => page.el.querySelector('[data-er-send-one]')
  await sendVia(page, 'current')
  await slow.release()
  await flush()
  assert.equal(env.backend.handoffs.length, 1, 'broadcast, waiting for the receipt')
  await act(async () => btn().dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await flush()
  assert.equal(env.backend.handoffs.length, 1, 'still one')
  // no receipt: the 3 s timeout ends the send; the entries open again
  assert.equal(await fire(env, 3000), 1)
  assert.match(lastNote().message, /没有确认收到/)
  await page.unmount()
})

test('XV9-02 a save that fails releases the lock and sends nothing', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '旧意见' }))
  const page = await openPage(env)
  const rest = env.h.ctx.rest
  env.h.ctx.rest = async (p, opts) => {
    if (opts?.method === 'PATCH' && opts.body?.op === 'comment') throw Object.assign(new Error('down'), { status: 500 })
    return rest(p, opts)
  }
  await click(cards(page.el)[0])
  await click([...page.el.querySelectorAll('button')].find((b) => b.textContent === '编辑意见'))
  const editor = page.el.querySelector('.er-editor')
  await act(async () => {
    Object.getOwnPropertyDescriptor(w.HTMLTextAreaElement.prototype, 'value').set.call(editor, '存不进去')
    editor.dispatchEvent(new w.Event('input', { bubbles: true }))
  })
  await sendVia(page, 'current')
  await flush()
  assert.equal(env.backend.handoffs.length, 0)
  env.h.ctx.rest = rest
  assert.equal(page.el.querySelector('[data-er-send-one]').disabled, false, 'unlocked')
  await sendVia(page, 'current')
  await flush()
  assert.equal(env.backend.handoffs.length, 1)
  await page.unmount()
})

// ── V2.1 #8: the send menu (after Orca's "Send notes") ────────────────────────
const withSessions = (rows) => {
  sdk.sessions = rows
  return () => (sdk.sessions = undefined)
}

test('V2.1 #8: a card has one 发送这一条 (no 加入待发 / 直接发送); its menu: scope, current + recent + 加入聊天待发, 复制给 AI — no 新会话', async () => {
  const done = withSessions([
    { id: 'local-s9', title: '旧的讨论', last_active: 10 },
    { id: 'local-s1', title: '缓存讨论', last_active: 20 },
    { id: 'local-hidden', title: '隐藏的', last_active: 30, hidden: true }
  ])
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  await click(cards(page.el)[0])
  const texts = [...page.el.querySelectorAll('button')].map((b) => b.textContent)
  assert.ok(!texts.some((x) => /^(加入待发|直接发送)$/.test(x)), 'the old two buttons are gone')
  assert.equal(page.el.querySelector('[data-er-action="add"], [data-er-action="send"], [data-er-bulk]'), null)
  assert.equal(page.el.querySelectorAll('[data-er-send-one]').length, 2, 'one per card')
  await click(menuTrigger(page.el, 'r0001'))
  const menu = page.el.querySelector('[data-er-send-menu]')
  assert.equal(menu.getAttribute('role'), 'menu')
  const items = [...menu.querySelectorAll('[data-send-item]')].map((b) => [b.getAttribute('data-send-item'), b.querySelector('.dk-menu-label').textContent, b.getAttribute('aria-checked')])
  assert.deepEqual(items, [
    ['scope-item', '这一条', 'true'],
    ['scope-unsent', '本文件全部未发送（2）', 'false'],
    ['current', '当前会话：缓存讨论', null],
    ['session:local-s9', '旧的讨论', null],
    ['queue', '加入聊天待发（和你的话一起发）', null],
    ['copy', '复制给 AI', null]
  ])
  assert.doesNotMatch(menu.textContent, /新会话/)
  assert.equal(page.el.ownerDocument.activeElement, menuItem(page.el, 'current'), 'the current session is the default')
  done()
  await page.unmount()
})

test('V2.1 #8: a target picked in the menu is sent to at once, no second question (not the focused session either)', async () => {
  const done = withSessions([{ id: 'local-s9', title: '旧的讨论', last_active: 10 }])
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '细化' }))
  const page = await openPage(env)
  const before = sdk.notifications.length
  await sendVia(page, 'session:local-s9')
  assert.equal(env.backend.handoffs.length, 1)
  const ho = env.backend.handoffs[0]
  assert.equal(ho.targetSessionId, 'local-s9', 'the picked session, not the focused one')
  assert.equal(ho.sendNow, true)
  assert.equal(sdk.notifications.length, before, 'nothing asked before the hand-off')
  assert.equal(page.el.querySelector('[data-er-send-menu]'), null, 'the menu closed')
  done()
  await page.unmount()
})

test('V2.1 #8: 加入聊天待发 goes to the focused session, not sent; 当前会话 sends now', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  await sendVia(page, 'queue', { from: 'r0002' })
  assert.deepEqual([env.backend.handoffs[0].targetSessionId, env.backend.handoffs[0].sendNow], ['local-s1', false])
  assert.deepEqual(env.backend.handoffs[0].items.map((i) => i.origin.itemId), ['r0002'], 'only this one')
  await receipt(env, { handoffId: env.backend.handoffs[0].handoffId, accepted: ['r0002'] })
  await flush()
  await sendVia(page, 'current', { from: 'r0001' })
  assert.deepEqual([env.backend.handoffs[1].targetSessionId, env.backend.handoffs[1].sendNow], ['local-s1', true])
  await page.unmount()
})

test('V2.1 #8: from a card, scope 本文件全部未发送 sends every unsent one in document order', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5), item('r0002', '缓存方案', 1), item('r0003', '更新数据库', 3, { status: 'resolved' }))
  const page = await openPage(env)
  await sendVia(page, 'current', { from: 'r0001', scope: 'scope-unsent' })
  assert.deepEqual(env.backend.handoffs[0].items.map((i) => i.origin.itemId), ['r0002', 'r0001'])
  await page.unmount()
})

test('V2.1 #8: a sent card greys 发送这一条 out and says 已发送; the list counts only the unsent', async () => {
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { status: 'sent' }), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  const sent = menuTrigger(page.el, 'r0001')
  // XR11-10: it opens (复制给 AI); sending this one again is what is off, and the tip says why
  assert.equal(sent.disabled, false)
  assert.match(sent.getAttribute('aria-label'), /已发送/)
  await click(sent)
  assert.equal(menuItem(page.el, 'current').disabled, true)
  assert.equal(menuItem(page.el, 'copy').disabled, false)
  assert.match(page.el.querySelector('[data-er-send-menu-open]').textContent, /发送 1 条/)
  await page.unmount()
})

test('V2.1 #8: 复制给 AI puts one Markdown prompt on the clipboard and sends nothing', async () => {
  let copied = null
  const had = Object.getOwnPropertyDescriptor(w.navigator, 'clipboard')
  Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: { writeText: async (s) => void (copied = s) } })
  const env = fresh()
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '这里要细化' }), item('r0002', '缓存方案', 1))
  const page = await openPage(env)
  await sendVia(page, 'copy', { from: 'list' })
  await flush()
  assert.equal(env.backend.handoffs.length, 0)
  assert.match(copied, /^# plan\.md 的 2 条标注/)
  assert.match(copied, /## ① plan\.md 第 1 行\n\n> 缓存方案\n\n## ② plan\.md 第 5 行/)
  assert.match(copied, /> 第二段\n\n这里要细化/)
  assert.match(lastNote().message, /已复制 2 条标注给 AI/)
  if (had) Object.defineProperty(w.navigator, 'clipboard', had)
  else delete w.navigator.clipboard
  await page.unmount()
})

test('V2.1 #8 / XV9-02: two clicks on a menu target in one go, while the comment is saving, start one hand-off', async () => {
  const env = fresh({ fakeTimeouts: true })
  env.backend.items.push(item('r0001', '第二段', 5, { comment: '旧意见' }))
  const page = await openPage(env)
  const slow = await slowCommentSend(env, page)
  await click(menuTrigger(page.el))
  const target = menuItem(page.el, 'current')
  await act(async () => {
    target.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
    target.dispatchEvent(new w.MouseEvent('click', { bubbles: true }))
  })
  await flush()
  await click(menuTrigger(page.el))
  assert.equal(menuItem(page.el, 'current').disabled, true, 'locked while saving')
  await slow.release()
  await flush()
  assert.equal(slow.counts.saves, 1)
  assert.equal(env.backend.handoffs.length, 1, 'one hand-off')
  assert.equal(env.backend.handoffs[0].items[0].comment, '保存中的意见')
  await receipt(env, { handoffId: env.backend.handoffs[0].handoffId, accepted: ['r0001'], batchId: 'b1' })
  await flush()
  await page.unmount()
})
