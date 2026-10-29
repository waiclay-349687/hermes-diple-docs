// V3-D2 P2: the startup request storm. Every ::diple-docs card used to fetch
// GET /items on its own (the user's log: dozens in one millisecond, all failing
// with "Gateway ticket bootstrap failed" while the gateway started). Now the
// cards share one coalescing loader: one summary request per moment, retried
// with backoff, never stuck in an error or a spinner.
import test from 'node:test'
import assert from 'node:assert/strict'

import { createItemCounts, BACKOFF_MS } from '../../plugins/diple-docs/desktop/src/review/item-counts.js'
import { setupDom, loadPlugin, makeCtx, tick } from './harness.mjs'

/** Manual clock: later(fn, ms) queues; run(ms) advances. */
function clock() {
  let now = 0
  const q = []
  return {
    later(fn, ms) {
      const t = { at: now + ms, fn, live: true }
      q.push(t)
      return () => (t.live = false)
    },
    async run(ms) {
      const end = now + ms
      for (;;) {
        q.sort((a, b) => a.at - b.at)
        const i = q.findIndex((t) => t.live && t.at <= end)
        if (i < 0) break
        const [t] = q.splice(i, 1)
        now = t.at
        t.fn()
        for (let k = 0; k < 5; k++) await Promise.resolve()
      }
      now = end
    },
    pending: () => q.filter((t) => t.live).length
  }
}

const summary = (paths) => ({ counts: Object.fromEntries(paths.map((p) => [p, { total: 3, open: 2, byStatus: { pending: 1, sent: 1, answered: 0, resolved: 1 }, lost: 0 }])) })

test('30 cards mounting together → exactly one request', async () => {
  const c = clock()
  const calls = []
  const counts = createItemCounts({ fetch: async (paths) => (calls.push(paths), summary(paths)), later: c.later })
  const seen = []
  for (let i = 0; i < 30; i++) counts.watch(`/w/doc${i % 20}.md`, (s) => seen.push(s))
  await c.run(100)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].length, 20, 'duplicate paths are merged')
  assert.equal(seen.length, 30)
  assert.equal(counts.peek('/w/doc3.md').open, 2)
  counts.dispose()
})

test('first N attempts fail (gateway not ready) → backoff, then the counts arrive', async () => {
  const c = clock()
  let n = 0
  const counts = createItemCounts({
    fetch: async (paths) => {
      if (++n <= 3) throw new Error('Gateway ticket bootstrap failed')
      return summary(paths)
    },
    later: c.later
  })
  const states = []
  counts.watch('/w/a.md', (s) => states.push(s))
  counts.watch('/w/b.md', () => {})
  await c.run(50)
  assert.equal(n, 1)
  assert.equal(counts.peek('/w/a.md'), null, 'no value yet, and no error state')
  await c.run(BACKOFF_MS[0] - 100)
  assert.equal(n, 1, 'waits out the backoff')
  await c.run(BACKOFF_MS[0] + BACKOFF_MS[1] + BACKOFF_MS[2] + 100)
  assert.equal(n, 4, 'one request per retry, both paths together')
  assert.equal(counts.peek('/w/a.md').open, 2)
  assert.equal(states.length, 1)
  counts.dispose()
})

test('backoff is capped and keeps going: a card never stays stuck', async () => {
  const c = clock()
  let n = 0
  let up = false
  const counts = createItemCounts({ fetch: async (paths) => (n++, up ? summary(paths) : Promise.reject(new Error('down'))), later: c.later })
  counts.watch('/w/a.md', () => {})
  await c.run(10 * 60_000)
  const cap = BACKOFF_MS[BACKOFF_MS.length - 1]
  assert.ok(cap <= 30_000)
  assert.ok(n > 10 && n < 10 * 60_000 / cap + BACKOFF_MS.length + 2, `retries keep going at the cap (${n})`)
  up = true
  await c.run(cap + 10)
  assert.equal(counts.peek('/w/a.md').open, 2)
  counts.dispose()
})

test('refresh: one request for every watched path; hidden window skips; unwatch stops', async () => {
  const c = clock()
  const calls = []
  let visible = true
  const counts = createItemCounts({ fetch: async (paths) => (calls.push(paths), summary(paths)), later: c.later, refreshMs: 20_000, isVisible: () => visible })
  const off1 = counts.watch('/w/a.md', () => {})
  const off2 = counts.watch('/w/b.md', () => {})
  await c.run(50)
  await c.run(20_000)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1].sort(), ['/w/a.md', '/w/b.md'])
  visible = false
  await c.run(20_000)
  assert.equal(calls.length, 2)
  visible = true
  off1()
  off2()
  await c.run(60_000)
  assert.equal(calls.length, 2, 'nobody watching, no polling')
  assert.equal(c.pending(), 0)
  counts.dispose()
})

test('invalidate refetches the watched paths in one request', async () => {
  const c = clock()
  const calls = []
  const counts = createItemCounts({ fetch: async (paths) => (calls.push(paths), summary(paths)), later: c.later })
  counts.watch('/w/a.md', () => {})
  counts.watch('/w/b.md', () => {})
  await c.run(50)
  counts.invalidate()
  counts.invalidate()
  await c.run(50)
  assert.equal(calls.length, 2)
  counts.dispose()
})

test('a path the backend refuses is final (no retry loop for it)', async () => {
  const c = clock()
  const calls = []
  const counts = createItemCounts({
    fetch: async (paths) => (calls.push(paths), { counts: { '/w/a.md': summary(['/w/a.md']).counts['/w/a.md'], '/w/x.md': { error: 'unsupported-suffix' } } }),
    later: c.later
  })
  counts.watch('/w/a.md', () => {})
  counts.watch('/w/x.md', () => {})
  await c.run(BACKOFF_MS[0] * 3)
  assert.equal(calls.length, 1)
  counts.dispose()
})

// --- through the plugin: the transcript cards share the loader -----------------------
setupDom()
const { act, createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const plugin = await loadPlugin('diple-docs')
const flush = async (n = 6) => {
  for (let i = 0; i < n; i++) await act(async () => tick(0))
}

test('30 ::diple-docs cards in a transcript: 1 summary request, 0 per-card /items; counts show after the gateway recovers', async () => {
  const calls = []
  let fail = 2
  const rest = async (p, opts = {}) => {
    calls.push({ p, method: opts.method ?? 'GET', body: opts.body })
    if (p === '/items/summary') {
      if (fail-- > 0) throw new Error('Gateway ticket bootstrap failed')
      return summary(opts.body.paths)
    }
    if (p.startsWith('/reviews/recent')) return { reviews: [] }
    return {}
  }
  const h = makeCtx({ rest })
  // manual timers: pump() fires whatever is queued (coalesce, a retry, …)
  let queue = []
  h.ctx.setTimeout = (fn, ms) => {
    const t = { fn, ms, live: true }
    queue.push(t)
    return () => (t.live = false)
  }
  const pump = async () => {
    const due = queue.filter((t) => t.live && t.ms < 20_000)
    queue = queue.filter((t) => !due.includes(t))
    for (const t of due) t.fn()
    await flush()
  }
  h.ctx.setInterval = () => () => {}
  h.registerI18n('diple-docs')
  plugin.register(h.ctx)
  const render = h.find('transcript.directives').data.render
  const el = document.createElement('div')
  document.body.appendChild(el)
  const root = createRoot(el)
  try {
    await act(async () =>
      root.render(
        createElement(
          'div',
          null,
          Array.from({ length: 30 }, (_, i) => createElement('div', { key: i }, render({ attrs: { path: `/w/doc${i}.md` }, streaming: false })))
        )
      )
    )
    await flush()
    await pump()
    const perCard = calls.filter((c) => c.p.startsWith('/items?'))
    assert.equal(perCard.length, 0, 'no per-card GET /items')
    const first = calls.filter((c) => c.p === '/items/summary')
    assert.equal(first.length, 1, 'one request for all 30 cards')
    assert.equal(first[0].method, 'POST')
    assert.equal(first[0].body.paths.length, 30)
    const sub = (i) => el.querySelector(`[data-diple-docs-card="/w/doc${i}.md"] .er-dcard-sub`).textContent
    assert.doesNotMatch(sub(0), /2/, 'no count yet, no error text either')
    for (let i = 0; i < 10 && !/2/.test(sub(29)); i++) await pump()
    assert.equal(calls.filter((c) => c.p === '/items/summary').length, 3, 'two failures, one success')
    assert.match(sub(29), /2/)
    assert.match(sub(0), /2/)
  } finally {
    await act(async () => root.unmount())
    el.remove()
    h.dispose()
  }
})

test('an older backend without /items/summary (404): falls back to GET /items one path at a time', async () => {
  const { summaryFetcher } = await import('../../plugins/diple-docs/desktop/src/review/item-counts.js')
  let live = 0
  let peak = 0
  const calls = []
  const api = {
    itemsSummary: async () => Promise.reject(Object.assign(new Error('Not Found'), { status: 404 })),
    listItems: async (p) => {
      calls.push(p)
      peak = Math.max(peak, ++live)
      await new Promise((r) => setTimeout(r, 1))
      live--
      return { items: [{ status: 'pending' }, { status: 'resolved', lost: true }] }
    }
  }
  const fetch = summaryFetcher(api)
  const r = await fetch(['/a.md', '/b.md', '/c.md'])
  assert.equal(peak, 1, 'never in parallel')
  assert.deepEqual(r.counts['/b.md'], { total: 2, open: 1, byStatus: { pending: 1, sent: 0, answered: 0, resolved: 1 }, lost: 1 })
  const other = summaryFetcher({ itemsSummary: async () => Promise.reject(new Error('Gateway ticket bootstrap failed')), listItems: async () => assert.fail('no fallback on a gateway error') })
  await assert.rejects(other(['/a.md']), /Gateway/)
})
