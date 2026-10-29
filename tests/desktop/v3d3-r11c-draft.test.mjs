// R11-J (S2): the R11c review's counter-examples (XR11c-01, 03) as positive runtime
// contracts, and the gaps of the R11b enumeration closed:
//   - the fake backend keeps the API's CAS: an edit names expectMutation, a write
//     since → 409 {detail:'stale'}; any write can be made to reject (network)
//   - writes can be parked and answered ONE AT A TIME, each answer flushed alone
//   - three-step sequences: a conflict choice in flight → typing → 保存; the first
//     保存 in flight → typing → close / reopen; a restored pending edit → 保存 → 409
//     or reject → retry
//   - every assertion keeps the other side's words as well as mine
//   - two files (A, B) interleaved in one runtime
// Seam: register(ctx) with the SDK stub (as v3d3-r11b-draft).
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
const OTHER = '/work/other.md'
const LINE = { 第二段: 5, 第三段: 7, 第四段: 9 }

function item(id, text, line, extra = {}) {
  return { id, path: PATH, anchor: { text, before: '', after: '', line }, text, comment: '', status: 'pending', lost: false, revision: 1, mutation: 1, sentSessions: [], queued: null, createdAt: Number(id.slice(1)), updatedAt: 0, ...extra }
}

// The backend's contract, per file. reject(pred): the next matching item write fails
// as the network would. hold(pred) → unhold: matching item writes park in `parked`
// until released (releaseOne) — the server handles each when it is released.
function fakeBackend(text = DOC) {
  const b = { text, items: [], version: 0, calls: [], seq: 100, rejects: [], holds: [], parked: [] }
  b.reject = (pred) => b.rejects.push(pred)
  b.hold = (pred = () => true) => {
    b.holds.push(pred)
    return () => b.holds.splice(b.holds.indexOf(pred), 1)
  }
  const byRoute = (route) => b.items.find((i) => `/items/${i.id}` === route)
  b.rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    const body = opts.body
    const u = new URL(p, 'http://x')
    const route = u.pathname
    b.calls.push({ path: p, method, body })
    const write = (method === 'POST' && route === '/items') || (method === 'PATCH' && route.startsWith('/items/r'))
    if (write) {
      const req = { route, method, body, path: body?.path ?? byRoute(route)?.path }
      if (b.holds.some((h) => h(req))) await new Promise((go) => b.parked.push({ ...req, go }))
      const i = b.rejects.findIndex((f) => f(req))
      if (i >= 0) {
        b.rejects.splice(i, 1)
        throw new Error('network down')
      }
    }
    if (route === '/file') return { path: u.searchParams.get('path'), text: b.text, mtime: 1, size: b.text.length }
    if (route === '/review/state') return { exists: true, mtime: 1, itemsVersion: String(b.version) }
    if (route === '/items' && method === 'GET') {
      const q = u.searchParams.get('path')
      return { items: b.items.filter((i) => i.path === q).map((i) => ({ ...i })), itemsVersion: String(b.version) }
    }
    if (route === '/items' && method === 'POST') {
      const dup = b.items.find((i) => i.path === body.path && i.text === body.anchor.text && i.anchor.line === body.anchor.line)
      if (dup) return { ...dup, duplicate: true }
      const it = item(`r${++b.seq}`, body.anchor.text, body.anchor.line, { path: body.path, anchor: body.anchor, comment: body.comment ?? '' })
      b.items.push(it)
      b.version++
      return { ...it, duplicate: false }
    }
    if (route.startsWith('/items/r') && method === 'PATCH') {
      const it = byRoute(route)
      if (!it) throw Object.assign(new Error('{"detail":"unknown-item"}'), { status: 404 })
      if (typeof body.expectMutation === 'number' && body.expectMutation !== it.mutation) throw Object.assign(new Error('{"detail":"stale"}'), { status: 409, detail: 'stale' })
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

const mounted = []
const envs = []
test.afterEach(async () => {
  for (const p of mounted.splice(0)) await p.unmount()
  for (const e of envs.splice(0)) e.h.dispose()
})

function fresh({ items = [], stored = {}, session = 'local-s1' } = {}) {
  sdk.notifications.length = 0
  sdk.workspaces.clear()
  sdk.pluginDecisions.set({})
  sdk.locale.set('zh')
  sdk.state.focusedStoredSessionId.set(session)
  const backend = fakeBackend()
  backend.items.push(...items)
  const h = makeCtx({ rest: backend.rest })
  for (const [k, v] of Object.entries(stored)) h.store.set(k, JSON.stringify(v))
  const env = { h, backend, pick: PATH }
  h.ctx.setInterval = () => () => {}
  h.ctx.setTimeout = () => () => {}
  h.ctx.registerSettingsPage = () => () => {}
  h.ctx.os = { pickOpenPath: async () => env.pick, revealPath: async () => true }
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  envs.push(env)
  return env
}

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => tick(0))
}

async function openPage(env, path = PATH) {
  env.pick = path
  env.h.find('palette', (c) => c.data.id === 'diple-docs.open').data.run()
  await flush()
  const ws = sdk.workspaces.get(`diple-docs:${path}`)
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
  const page = {
    el,
    path,
    unmount: async () => {
      if (!el.isConnected) return
      await act(async () => root.unmount())
      el.remove()
    }
  }
  mounted.push(page)
  return page
}
const closePage = async (page) => {
  await page.unmount()
  mounted.splice(mounted.indexOf(page), 1)
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

const editor = (page) => page.el.querySelector('[data-er-float-editor]')
const box = (page) => editor(page)?.querySelector('textarea')
const save = (page) => click(editor(page).querySelector('[data-er-float-save]'))
const choice = (page, a) => page.el.querySelector(`[data-er-collision-action="${a}"]`)
const patches = (env) => env.backend.calls.filter((c) => c.method === 'PATCH')
const slots = (env, path = PATH) => Object.values(env.h.ctx.storage.get(`draft:${path}`, null)?.slots ?? {})
const stored = (env, id) => env.backend.items.find((i) => i.id === id)
const on = (env, path, text) => env.backend.items.filter((i) => i.path === path && i.text === text)
// another window writes item id meanwhile (the mutation moves, as the API's does)
const elsewhere = (env, id, comment) => {
  const it = stored(env, id)
  Object.assign(it, { comment, revision: it.revision + 1, mutation: it.mutation + 1 })
  env.backend.version++
}
// one parked write answered, then flushed on its own (never a batch)
async function releaseOne(env, i = 0) {
  const [r] = env.backend.parked.splice(i, 1)
  assert.ok(r, 'a parked write to answer')
  await act(async () => {
    r.go()
    await tick(0)
  })
  await flush(10)
}
const THEIRS = '对方意见'
const MINE = '我的草稿'
const MERGED = `${THEIRS}\n\n${MINE}`
// my draft on 第二段 meets their saved comment there: the conflict bar is up
async function collision(env, page, { needle = '第二段', theirs = THEIRS, mine = MINE, id = 'r0002' } = {}) {
  page ??= await openPage(env)
  await annotate(page, needle)
  await setValue(box(page), mine)
  env.backend.items.push(item(id, needle, LINE[needle], { path: page.path, comment: theirs }))
  env.backend.version++
  await save(page)
  assert.ok(page.el.querySelector('[data-er-collision]'), 'conflict bar')
  return page
}
// 保存 answered while the user typed on: the editor is the stored item's, the words a pending edit
async function pending(env) {
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(box(page), '第一版')
  const unhold = env.backend.hold((r) => r.method === 'POST')
  await save(page)
  unhold()
  await setValue(box(page), '第一版续写')
  await releaseOne(env)
  assert.equal(slots(env)[0]?.kind, 'pending-edit')
  return page
}
const atEnd = (el) => assert.deepEqual([el.selectionStart, el.selectionEnd], [el.value.length, el.value.length], 'cursor at the end')

// ── XR11c-01: the three choices are what-you-see-is-what-is-written ─────────────

test('XR11c-01 合并: at the click the box shows theirs + blank line + mine, cursor at the end, before the PATCH answers', async () => {
  const env = fresh()
  const page = await collision(env)
  env.backend.hold((r) => r.method === 'PATCH')
  await click(choice(page, 'merge'))
  assert.equal(box(page).value, MERGED)
  atEnd(box(page))
  assert.equal(env.backend.parked.length, 1)
  assert.equal(env.backend.parked[0].body.comment, MERGED, 'what is shown is what is sent')
  assert.ok(editor(page).querySelector('[data-er-saving]'))
  assert.equal(slots(env)[0].words, MERGED, 'the cache keeps what is shown')
  await releaseOne(env)
  assert.equal(stored(env, 'r0002').comment, MERGED)
  assert.equal(editor(page), null)
  assert.equal(slots(env).length, 0)
})

test('XR11c-01 合并 in flight, typing on: the words stack on the merged text, the next 保存 keeps theirs (strict CAS)', async () => {
  const env = fresh()
  const page = await collision(env)
  const unhold = env.backend.hold((r) => r.method === 'PATCH')
  await click(choice(page, 'merge'))
  await setValue(box(page), `${box(page).value}继续写`) // typed on top of what the box shows
  await releaseOne(env)
  unhold()
  assert.equal(stored(env, 'r0002').comment, MERGED)
  assert.equal(box(page).value, `${MERGED}继续写`)
  const [s] = slots(env)
  assert.equal(s.kind, 'pending-edit')
  assert.equal(s.itemId, 'r0002')
  assert.equal(s.text, `${MERGED}继续写`, 'the pending edit is baseline + continuation, theirs included')
  await save(page)
  assert.equal(stored(env, 'r0002').comment, `${MERGED}继续写`)
  assert.match(stored(env, 'r0002').comment, new RegExp(THEIRS))
  const ps = patches(env)
  assert.equal(ps.length, 2)
  assert.equal(ps[1].body.expectMutation, ps[0].body.expectMutation + 1, 'the second write is based on the first one\'s answer')
  assert.equal(slots(env).length, 0)
  assert.equal(editor(page), null)
})

test('XR11c-01 合并 in flight, typing on, close and reopen: the restored edit still holds theirs', async () => {
  const env = fresh()
  let page = await collision(env)
  env.backend.hold((r) => r.method === 'PATCH')
  await click(choice(page, 'merge'))
  await setValue(box(page), `${box(page).value}继续写`) // typed on top of what the box shows
  await releaseOne(env)
  await closePage(page)
  env.backend.holds.length = 0
  page = await openPage(env)
  assert.equal(box(page).value, `${MERGED}继续写`)
  assert.match(editor(page).textContent, /恢复了未保存的修改/)
  await save(page)
  assert.equal(stored(env, 'r0002').comment, `${MERGED}继续写`)
  assert.equal(slots(env).length, 0)
})

test('XR11c-01 用我的替换: the box keeps my draft, cursor at the end; typing on in flight stacks on it', async () => {
  const env = fresh()
  const page = await collision(env)
  const unhold = env.backend.hold((r) => r.method === 'PATCH')
  await click(choice(page, 'replace'))
  assert.equal(box(page).value, MINE)
  atEnd(box(page))
  assert.equal(env.backend.parked[0].body.comment, MINE)
  await setValue(box(page), `${box(page).value}继续写`)
  await releaseOne(env)
  unhold()
  assert.equal(stored(env, 'r0002').comment, MINE)
  assert.equal(slots(env)[0].text, `${MINE}继续写`)
  await save(page)
  assert.equal(stored(env, 'r0002').comment, `${MINE}继续写`)
  assert.equal(slots(env).length, 0)
})

test('XR11c-01 保留已有: the box shows theirs and edits that item; nothing is written by the choice', async () => {
  const env = fresh()
  const page = await collision(env)
  await click(choice(page, 'keep'))
  assert.equal(editor(page).hasAttribute('data-er-draft'), false)
  assert.equal(editor(page).getAttribute('data-item-id'), 'r0002')
  assert.equal(box(page).value, THEIRS)
  atEnd(box(page))
  assert.equal(patches(env).length, 0)
  assert.equal(slots(env).length, 0, 'my words were dropped by my choice')
  await setValue(box(page), `${THEIRS}补一句`)
  await save(page)
  assert.equal(stored(env, 'r0002').comment, `${THEIRS}补一句`)
})

test('XR11c-01 合并 meets 409: the bar shows the newest theirs, the box is my draft again; 合并 again writes newest + mine', async () => {
  const env = fresh()
  const page = await collision(env)
  elsewhere(env, 'r0002', '对方又改了')
  await click(choice(page, 'merge'))
  assert.match(page.el.querySelector('[data-er-collision]').textContent, /对方又改了/)
  assert.equal(box(page).value, MINE)
  assert.equal(stored(env, 'r0002').comment, '对方又改了')
  await click(choice(page, 'merge'))
  assert.equal(stored(env, 'r0002').comment, `对方又改了\n\n${MINE}`)
  assert.equal(editor(page), null)
  assert.equal(slots(env).length, 0)
})

test('XR11c-01 合并 rejected: the bar stays, the box is my draft again, a retry does not double theirs', async () => {
  const env = fresh()
  const page = await collision(env)
  env.backend.reject((r) => r.method === 'PATCH')
  await click(choice(page, 'merge'))
  assert.ok(page.el.querySelector('[data-er-collision]'))
  assert.equal(box(page).value, MINE)
  assert.equal(choice(page, 'merge').disabled, false, 'the lock is released')
  assert.equal(stored(env, 'r0002').comment, THEIRS)
  await click(choice(page, 'merge'))
  assert.equal(stored(env, 'r0002').comment, MERGED)
})

test('XR11c-01 合并 in flight + typing, then 409: the typed words stay in the box and the cache', async () => {
  const env = fresh()
  const page = await collision(env)
  const unhold = env.backend.hold((r) => r.method === 'PATCH')
  await click(choice(page, 'merge'))
  elsewhere(env, 'r0002', '对方又改了')
  await setValue(box(page), `${box(page).value}继续写`) // typed on top of what the box shows
  await releaseOne(env)
  unhold()
  assert.match(page.el.querySelector('[data-er-collision]').textContent, /对方又改了/)
  assert.equal(box(page).value, `${MERGED}继续写`)
  assert.equal(slots(env)[0].words, `${MERGED}继续写`)
  assert.equal(stored(env, 'r0002').comment, '对方又改了', 'theirs untouched until I choose')
  await click(choice(page, 'replace'))
  assert.equal(stored(env, 'r0002').comment, `${MERGED}继续写`)
})

// ── XR11c-03: every success leaves through one exit ────────────────────────────

test('XR11c-03 a pending edit saved back to the stored words: slot cleared, not restored on reopen', async () => {
  const env = fresh()
  const page = await pending(env)
  await setValue(box(page), '第一版')
  await save(page)
  assert.equal(editor(page), null)
  assert.equal(slots(env).length, 0)
  assert.equal(patches(env).length, 0, 'nothing to write')
  await closePage(page)
  const reopened = await openPage(env)
  assert.equal(editor(reopened), null, 'no 恢复了未保存的修改')
})

test('XR11c-03 409 where another window saved the very same words: a success — slot cleared, editor closed', async () => {
  const env = fresh()
  const page = await pending(env)
  elsewhere(env, env.backend.items[0].id, '第一版续写')
  await save(page)
  assert.equal(page.el.querySelector('[data-er-conflict]'), null)
  assert.equal(editor(page), null)
  assert.equal(slots(env).length, 0)
})

test('XR11c-03 a pending edit whose remote already has those words (reloaded): one exit, slot cleared', async () => {
  const env = fresh()
  let page = await pending(env)
  await closePage(page)
  elsewhere(env, env.backend.items[0].id, '第一版续写')
  page = await openPage(env)
  assert.equal(box(page).value, '第一版续写')
  await save(page)
  assert.equal(editor(page), null)
  assert.equal(slots(env).length, 0)
})

// ── the review's other probes, as contracts (strict CAS, injected rejects) ─────

test('pending PATCH rejected: the latest words stay, the lock is released, a retry writes them', async () => {
  const env = fresh()
  const page = await pending(env)
  env.backend.reject((r) => r.method === 'PATCH')
  await save(page)
  assert.equal(slots(env)[0].text, '第一版续写')
  assert.ok(editor(page))
  await save(page)
  assert.equal(env.backend.items[0].comment, '第一版续写')
  assert.equal(slots(env).length, 0)
})

test('pending PATCH meets 409: survives close / reopen, an explicit overwrite writes it', async () => {
  const env = fresh()
  let page = await pending(env)
  elsewhere(env, env.backend.items[0].id, '远端修改')
  await save(page)
  assert.ok(page.el.querySelector('[data-er-conflict]'))
  assert.equal(slots(env)[0].text, '第一版续写')
  await closePage(page)
  page = await openPage(env)
  assert.equal(box(page).value, '第一版续写')
  await save(page)
  await click(page.el.querySelector('[data-er-conflict-action="overwrite"]'))
  assert.equal(env.backend.items[0].comment, '第一版续写')
  assert.equal(slots(env).length, 0)
})

test('pending PATCH answered late (after reopen + overwrite) disturbs neither the reopened editor nor a new draft', async () => {
  const env = fresh()
  let page = await pending(env)
  const orig = env.h.ctx.rest
  let release
  const wait = new Promise((r) => (release = r))
  let first = true
  env.h.ctx.rest = async (p, o) => {
    const result = await orig(p, o)
    if (p === '/items/r101' && o?.method === 'PATCH' && first) {
      first = false
      await wait
    }
    return result
  }
  await save(page)
  await closePage(page)
  page = await openPage(env)
  await setValue(box(page), '重开后更新的字')
  await save(page)
  await click(page.el.querySelector('[data-er-conflict-action="overwrite"]'))
  assert.equal(env.backend.items[0].comment, '重开后更新的字')
  await annotate(page, '第三段')
  await setValue(box(page), '无关新草稿')
  await act(async () => release())
  await flush()
  assert.equal(box(page)?.value, '无关新草稿')
  assert.equal(slots(env).length, 1)
})

test('close during POST, its reject arrives after reopen: the reopened draft still saves', async () => {
  const env = fresh()
  const page = await openPage(env)
  await annotate(page, '第二段')
  await setValue(box(page), '跨卸载保留')
  env.backend.hold((r) => r.method === 'POST')
  env.backend.reject((r) => r.method === 'POST')
  await save(page)
  await closePage(page)
  env.backend.holds.length = 0
  const reopened = await openPage(env)
  await releaseOne(env)
  assert.equal(box(reopened).value, '跨卸载保留')
  await save(reopened)
  assert.equal(env.backend.items[0].comment, '跨卸载保留')
  assert.equal(slots(env).length, 0)
})

// ── three-step sequences ───────────────────────────────────────────────────────

// a conflict choice in flight → typing → 保存, whose answer is ok / 409 / reject
for (const pick of ['merge', 'replace'])
  for (const next of ['ok', '409', 'reject'])
    test(`three steps: ${pick} in flight → type → 保存 (${next})`, async () => {
      const env = fresh()
      const page = await collision(env)
      const unhold = env.backend.hold((r) => r.method === 'PATCH')
      await click(choice(page, pick))
      const shown = box(page).value
      assert.equal(shown, pick === 'merge' ? MERGED : MINE)
      await setValue(box(page), `${box(page).value}续`)
      await releaseOne(env)
      unhold()
      assert.equal(stored(env, 'r0002').comment, shown)
      if (next === '409') elsewhere(env, 'r0002', '别处又改')
      if (next === 'reject') env.backend.reject((r) => r.method === 'PATCH')
      await save(page)
      if (next === '409') {
        assert.ok(page.el.querySelector('[data-er-conflict]'))
        assert.equal(stored(env, 'r0002').comment, '别处又改', 'theirs untouched until I choose')
        assert.equal(slots(env)[0].text, `${shown}续`)
        await click(page.el.querySelector('[data-er-conflict-action="overwrite"]'))
      } else if (next === 'reject') {
        assert.equal(box(page).value, `${shown}续`)
        assert.equal(slots(env)[0].text, `${shown}续`)
        await save(page)
      }
      assert.equal(stored(env, 'r0002').comment, `${shown}续`)
      if (pick === 'merge') assert.match(stored(env, 'r0002').comment, new RegExp(THEIRS), 'theirs kept')
      assert.equal(slots(env).length, 0)
      assert.equal(editor(page), null)
    })

// the first 保存 in flight → typing → close and reopen; its answer before the close,
// while closed or after the reopen, ok or rejected
for (const when of ['before-close', 'while-closed', 'after-reopen'])
  for (const outcome of ['ok', 'reject'])
    test(`three steps: 保存 in flight → type → close / reopen (answer ${when}, ${outcome})`, async () => {
      const env = fresh()
      let page = await openPage(env)
      await annotate(page, '第二段')
      await setValue(box(page), '第一版')
      env.backend.hold((r) => r.method === 'POST')
      if (outcome === 'reject') env.backend.reject((r) => r.method === 'POST')
      await save(page)
      env.backend.holds.length = 0
      await setValue(box(page), '第一版续写')
      if (when === 'before-close') await releaseOne(env)
      await closePage(page)
      if (when === 'while-closed') await releaseOne(env)
      page = await openPage(env)
      if (when === 'after-reopen') await releaseOne(env)
      assert.equal(box(page)?.value, '第一版续写', 'the words typed on come back')
      await save(page)
      // the first answer's item, when it landed unseen, meets the reopened draft as a conflict
      if (choice(page, 'replace')) {
        assert.match(page.el.querySelector('[data-er-collision]').textContent, /第一版/)
        await click(choice(page, 'replace'))
      }
      const its = on(env, PATH, '第二段')
      assert.equal(its.length, 1)
      assert.equal(its[0].comment, '第一版续写')
      assert.equal(slots(env).length, 0)
      assert.equal(editor(page), null)
    })

// a restored pending edit → 保存 → 409 / reject → retry
for (const fail of ['409', 'reject'])
  test(`three steps: restored pending edit → 保存 (${fail}) → retry`, async () => {
    const env = fresh()
    let page = await pending(env)
    await closePage(page)
    page = await openPage(env)
    assert.equal(box(page).value, '第一版续写')
    const id = env.backend.items[0].id
    if (fail === '409') elsewhere(env, id, '别处改了')
    else env.backend.reject((r) => r.method === 'PATCH')
    await save(page)
    assert.equal(slots(env)[0].text, '第一版续写')
    if (fail === '409') {
      assert.ok(page.el.querySelector('[data-er-conflict]'))
      assert.equal(stored(env, id).comment, '别处改了')
      await click(page.el.querySelector('[data-er-conflict-action="overwrite"]'))
    } else {
      assert.ok(editor(page))
      await save(page)
    }
    assert.equal(stored(env, id).comment, '第一版续写')
    assert.equal(slots(env).length, 0)
  })

test('three steps: a pending edit\'s 保存 in flight → type → 保存 again', async () => {
  const env = fresh()
  const page = await pending(env)
  const id = env.backend.items[0].id
  const unhold = env.backend.hold((r) => r.method === 'PATCH')
  await save(page)
  await setValue(box(page), '第一版续写再写')
  await releaseOne(env)
  unhold()
  assert.equal(stored(env, id).comment, '第一版续写')
  assert.equal(box(page).value, '第一版续写再写')
  assert.equal(slots(env)[0].text, '第一版续写再写')
  await save(page)
  assert.equal(stored(env, id).comment, '第一版续写再写')
  assert.equal(slots(env).length, 0)
})

// ── two files, interleaved ─────────────────────────────────────────────────────

test('two files: A and B 保存 in flight, A typed on, B answered first: ids, words, paths and caches stay apart', async () => {
  const env = fresh()
  env.backend.hold()
  const a = await openPage(env, PATH)
  await annotate(a, '第二段')
  await setValue(box(a), 'A文档原稿')
  await save(a)
  const b = await openPage(env, OTHER)
  await annotate(b, '第三段')
  await setValue(box(b), 'B文档原稿')
  await save(b)
  await setValue(box(a), 'A文档继续写')
  env.backend.holds.length = 0
  await releaseOne(env, 1)
  await releaseOne(env, 0)
  assert.equal(on(env, PATH, '第二段')[0].comment, 'A文档原稿')
  assert.equal(on(env, OTHER, '第三段')[0].comment, 'B文档原稿')
  assert.equal(box(a).value, 'A文档继续写')
  assert.equal(editor(b), null)
  assert.equal(slots(env, PATH)[0].text, 'A文档继续写')
  assert.equal(env.h.ctx.storage.get(`draft:${OTHER}`, null), null)
})

// every op pair across A and B, both writes parked, A typed on, answered one by one in each order
for (const opA of ['save', 'merge'])
  for (const opB of ['save', 'merge'])
    for (const order of ['AB', 'BA'])
      test(`two files: A ${opA} / B ${opB}, answers ${order} one at a time`, async () => {
        const env = fresh()
        const setup = async (path, needle, mine, theirs, id, op) => {
          const page = await openPage(env, path)
          if (op === 'merge') await collision(env, page, { needle, mine, theirs, id })
          else {
            await annotate(page, needle)
            await setValue(box(page), mine)
          }
          const unhold = env.backend.hold((r) => r.path === path)
          await click(op === 'merge' ? choice(page, 'merge') : editor(page).querySelector('[data-er-float-save]'))
          unhold()
          return page
        }
        const a = await setup(PATH, '第二段', 'A稿', 'A对方', 'r0002', opA)
        const b = await setup(OTHER, '第三段', 'B稿', 'B对方', 'r0003', opB)
        const wantA = opA === 'merge' ? 'A对方\n\nA稿' : 'A稿'
        const wantB = opB === 'merge' ? 'B对方\n\nB稿' : 'B稿'
        assert.equal(box(a).value, wantA)
        assert.equal(box(b).value, wantB)
        await setValue(box(a), `${box(a).value}续`)
        assert.equal(env.backend.parked.length, 2)
        for (const who of order) await releaseOne(env, env.backend.parked.findIndex((r) => r.path === (who === 'A' ? PATH : OTHER)))
        const [itA] = on(env, PATH, '第二段')
        const [itB] = on(env, OTHER, '第三段')
        assert.equal(on(env, PATH, '第三段').length + on(env, OTHER, '第二段').length, 0, 'nothing written to the other file')
        assert.equal(itB.comment, wantB)
        assert.equal(editor(b), null)
        assert.equal(slots(env, OTHER).length, 0)
        // B's answer closing B's editor blurs A's: an item edit saves on blur (as ever),
        // so A answered first may already hold the typed words; else they are A's pending edit
        if (itA.comment === `${wantA}续`) {
          assert.equal(order, 'AB')
          assert.equal(slots(env, PATH).length, 0)
        } else {
          assert.equal(itA.comment, wantA)
          assert.equal(box(a).value, `${wantA}续`)
          assert.equal(slots(env, PATH).length, 1)
          assert.equal(slots(env, PATH)[0].kind, 'pending-edit')
          assert.equal(slots(env, PATH)[0].itemId, itA.id)
          assert.equal(slots(env, PATH)[0].text, `${wantA}续`)
          await save(a)
        }
        assert.equal(itA.comment, `${wantA}续`)
        if (opA === 'merge') assert.match(itA.comment, /A对方/)
        if (opB === 'merge') assert.match(itB.comment, /B对方/)
        assert.equal(slots(env, PATH).length, 0)
      })

test('two files: a restore bar on A, a draft on B — each bar acts on its own file only', async () => {
  const lost = { anchor: { text: '删掉的段落', before: '', after: '', line: 5 }, words: '旧恢复文字', sig: 'x', at: 1 }
  const env = fresh({ stored: { [`draft:${PATH}`]: lost } })
  const a = await openPage(env, PATH)
  assert.ok(a.el.querySelector('[data-er-restore-bar]'))
  const b = await openPage(env, OTHER)
  await annotate(b, '第三段')
  await setValue(box(b), 'B当前文字')
  await click(a.el.querySelector('[data-er-restore-action="discard"]'))
  assert.equal(slots(env, PATH).length, 0)
  assert.equal(slots(env, OTHER)[0].words, 'B当前文字')
  assert.equal(box(b).value, 'B当前文字')
})

test('restore bar: a rejected copy releases its lock; 重新选取原文 cannot replace a written active draft; 放弃 drops only its slot', async () => {
  const lost = { anchor: { text: '删掉的段落', before: '', after: '', line: 5 }, words: '旧恢复文字', sig: 'x', at: 1 }
  const env = fresh({ stored: { [`draft:${PATH}`]: lost } })
  const page = await openPage(env)
  const had = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied') } } })
  try {
    await click(page.el.querySelector('[data-er-restore-action="copy"]'))
    assert.equal(page.el.querySelector('[data-er-restore-action="copy"]').disabled, false)
  } finally {
    if (had) Object.defineProperty(navigator, 'clipboard', had)
    else delete navigator.clipboard
  }
  await annotate(page, '第三段')
  await setValue(box(page), '当前新文字')
  await click(page.el.querySelector('[data-er-restore-action="reselect"]'))
  assert.equal(box(page).value, '当前新文字')
  assert.equal(slots(env).length, 2)
  await click(page.el.querySelector('[data-er-restore-action="discard"]'))
  assert.equal(slots(env).length, 1)
  assert.equal(slots(env)[0].words, '当前新文字')
})
