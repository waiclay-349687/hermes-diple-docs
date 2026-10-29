// V2-D: the Diple Docs page through register(ctx) with the SDK stub — marks on the
// original text, the card's Markdown quote, the way back from the list, and the
// load-time self-check. jsdom has no Highlight API; a registry stand-in records
// what would be painted (real painting: tests/e2e/v2d-review.mjs).
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
const withHighlights = () => {
  globalThis.CSS = { highlights: new Map() }
  globalThis.Highlight = FakeHighlight
}
withHighlights()
const React = await import('react')
const { act, createElement } = React
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple-docs')
const sdk = globalThis.__sdk
w.HTMLElement.prototype.scrollIntoView ??= function () {}
let rangeRect = { top: 200, bottom: 220, left: 10, right: 80, width: 70, height: 20 }
w.Range.prototype.getBoundingClientRect = () => rangeRect
w.Range.prototype.getClientRects = function () {
  return [this.getBoundingClientRect()]
}

const DOC = '# 缓存方案\n\n先**更新数据库**，再删除缓存。\n\n第二段说明文字。\n\n第三段也有文字。\n'
const PATH = '/work/plan.md'

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

function fakeBackend(text = DOC) {
  const b = { text, items: [], version: 0 }
  b.rest = async (p, opts = {}) => {
    const method = opts.method ?? 'GET'
    const url = new URL(p, 'http://x')
    const route = url.pathname
    if (route === '/file') return { path: url.searchParams.get('path'), text: b.text, mtime: 1, size: b.text.length }
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

function fresh({ items = [], text } = {}) {
  sdk.notifications.length = 0
  sdk.workspaces.clear()
  sdk.pluginDecisions.set({})
  sdk.locale.set('zh')
  sdk.state.focusedStoredSessionId.set('local-s1')
  const backend = fakeBackend(text)
  backend.items.push(...items)
  const h = makeCtx({ rest: backend.rest })
  h.ctx.setInterval = () => () => {}
  const timeouts = []
  h.ctx.setTimeout = (fn, ms) => (timeouts.push({ fn, ms }), () => {})
  const settingsPages = []
  h.ctx.registerSettingsPage = (pg) => (settingsPages.push(pg), () => {})
  h.ctx.os = { pickOpenPath: async () => PATH, revealPath: async () => true }
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  return { h, backend, timeouts, settingsPages }
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
  return { el, unmount: () => act(async () => root.unmount()).then(() => el.remove()) }
}

const click = async (node) => {
  assert.ok(node, 'element to click')
  await act(async () => node.dispatchEvent(new w.MouseEvent('click', { bubbles: true })))
  await flush()
}
const reg = () => globalThis.CSS.highlights
const painted = (name) => (reg().get(name)?.ranges ?? []).map((r) => r.toString())
const card = (el, id) => el.querySelector(`[data-er-item="${id}"]`)

test('marks: each status gets its own mark on the original text; 划线 and 批注 differ while waiting', async () => {
  const env = fresh({
    items: [
      item('r0001', '缓存方案', 1, { comment: '标题再具体些' }),
      item('r0002', '更新数据库', 3),
      item('r0003', '第二段', 5, { status: 'sent', comment: 'a' }),
      item('r0004', '第三段', 7, { status: 'answered', comment: 'b' })
    ]
  })
  const page = await openPage(env)
  assert.deepEqual(painted('er-pending'), ['缓存方案'])
  assert.deepEqual(painted('er-highlight'), ['更新数据库'])
  assert.deepEqual(painted('er-sent'), ['第二段'])
  assert.deepEqual(painted('er-answered'), ['第三段'])
  assert.equal(card(page.el, 'r0001').dataset.erMark, 'pending')
  assert.equal(card(page.el, 'r0002').dataset.erMark, 'highlight')
  assert.equal(card(page.el, 'r0003').dataset.erMark, 'sent')
  await page.unmount()
  assert.equal(reg().size, 0, 'closing the page removes its marks')
})

test('marks: 原文已变 is an overlay — the old line carries it, the card keeps its status and adds the overlay chip', async () => {
  const env = fresh({ items: [item('r0001', '已经删掉的句子', 5, { status: 'sent', comment: 'x' })] })
  const page = await openPage(env)
  await flush()
  const c = card(page.el, 'r0001')
  assert.equal(c.dataset.erStatus, 'changed')
  assert.equal(c.dataset.erMark, 'sent')
  assert.equal(c.dataset.erChanged, 'true')
  const chips = [...c.querySelectorAll('.er-status')].map((s) => s.textContent)
  assert.deepEqual(chips, ['已发', '原文已变'])
  assert.deepEqual(painted('er-changed'), ['第二段说明文字。'], 'its old line, marked as changed')
  assert.deepEqual(painted('er-sent'), [], 'no status mark on text that is not the annotated passage')
  await page.unmount()
})

test('the card quote is rendered Markdown, not raw source', async () => {
  const env = fresh({ items: [item('r0001', '先**更新数据库**，再删除缓存。', 3)] })
  const page = await openPage(env)
  const quote = card(page.el, 'r0001').querySelector('.er-quote')
  assert.equal(quote.querySelector('strong')?.textContent, '更新数据库')
  assert.doesNotMatch(quote.textContent, /\*\*/)
  await page.unmount()
})

function frame(page, { top = 0, height = 600 } = {}) {
  const wrap = page.el.querySelector('.er-docwrap')
  wrap.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 600, width: 600 })
  const calls = []
  wrap.scrollTo = (opts) => calls.push(opts)
  return calls
}

test('back to the original: words already in view → no scroll, no flash; the card\'s words stay deeper (V2.1 #1)', async () => {
  const env = fresh({ items: [item('r0001', '第二段', 5, { comment: 'x' }), item('r0002', '缓存方案', 1)] })
  const page = await openPage(env)
  const calls = frame(page)
  rangeRect = { top: 200, bottom: 220, left: 10, right: 80, width: 70, height: 20 }
  const before = env.timeouts.length
  await click(card(page.el, 'r0001'))
  assert.deepEqual(calls, [])
  assert.deepEqual(painted('er-pulse'), [])
  assert.deepEqual(painted('er-active'), ['第二段'])
  assert.equal(env.timeouts.slice(before).filter((x) => x.ms >= 100 && x.ms <= 3000).length, 0, 'no timer to end an effect: nothing temporary')
  await page.unmount()
})

test('back to the original: words out of view → one smooth scroll that centres them; no flash on arrival', async () => {
  const env = fresh({ items: [item('r0001', '第三段', 7)] })
  const page = await openPage(env)
  const calls = frame(page)
  rangeRect = { top: 1500, bottom: 1520, left: 10, right: 80, width: 70, height: 20 }
  await click(card(page.el, 'r0001'))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].behavior, 'smooth')
  assert.equal(calls[0].top, 1510 - 300)
  await act(async () => page.el.querySelector('.er-docwrap').dispatchEvent(new w.Event('scrollend')))
  assert.deepEqual(painted('er-pulse'), [], 'nothing flashes on arrival')
  assert.deepEqual(painted('er-active'), ['第三段'], 'the deeper fill marks the place')
  await page.unmount()
})

test('back to the original with reduced motion: jump, no flash', async () => {
  window.matchMedia = (q) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })
  try {
    const env = fresh({ items: [item('r0001', '第三段', 7)] })
    const page = await openPage(env)
    const calls = frame(page)
    rangeRect = { top: 1500, bottom: 1520, left: 10, right: 80, width: 70, height: 20 }
    await click(card(page.el, 'r0001'))
    assert.equal(calls[0].behavior, 'auto')
    assert.deepEqual(painted('er-pulse'), [])
    assert.deepEqual(painted('er-active'), ['第三段'])
    await page.unmount()
  } finally {
    delete window.matchMedia
  }
})

test('self-check: a host without the Highlight API → one notice, the page still works', async () => {
  const saved = [globalThis.CSS, globalThis.Highlight]
  globalThis.CSS = undefined
  globalThis.Highlight = undefined
  try {
    const env = fresh({ items: [item('r0001', '第二段', 5)] })
    await flush()
    const notes = sdk.notifications.filter((n) => /降级/.test(n.message))
    assert.equal(notes.length, 1)
    assert.match(notes[0].message, /原文上的标注底色/)
    const page = await openPage(env)
    assert.ok(card(page.el, 'r0001'), 'cards still render')
    await page.unmount()
    // and it is not forgotten after the notice fades: the settings page keeps saying it
    const el = document.createElement('div')
    document.body.appendChild(el)
    const root = createRoot(el)
    await act(async () => root.render(createElement(() => env.settingsPages[0].render())))
    assert.match(el.querySelector('[data-diple-docs-degraded]')?.textContent ?? '', /已降级运行（原文上的标注底色/)
    await act(async () => root.unmount())
    el.remove()
  } finally {
    ;[globalThis.CSS, globalThis.Highlight] = saved
  }
})

test('self-check: the stub host (renderer present, Highlight API present) says nothing', async () => {
  const env = fresh()
  await flush()
  assert.equal(sdk.notifications.filter((n) => /降级/.test(n.message)).length, 0)
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  await act(async () => root.render(createElement(() => env.settingsPages[0].render())))
  assert.equal(el.querySelector('[data-diple-docs-degraded]'), null)
  await act(async () => root.unmount())
  el.remove()
})
