// R11-H: the eight R11b counterexamples, as positive runtime contracts.
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
      // R11-J: the API's CAS — an edit made against an older mutation is 409 'stale'
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
  envs.push(h); return { h, backend, timeouts }
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
  const result = { el, wrap, shakes: () => shook, unmount: async () => { if (!el.isConnected) return; mo.disconnect(); await act(async () => root.unmount()); el.remove() } }; mounted.push(result); return result
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


const mounted = [], envs = []; test.afterEach(async () => { for (const p of mounted.splice(0)) await p.unmount(); for (const h of envs.splice(0)) h.dispose(); });
const KEY = `draft:${PATH}`
const gate = (env, route, method) => {
  const original = env.h.ctx.rest; let release;
  const wait = new Promise(r => release = r);
  env.h.ctx.rest = async (p, opts) => { if (p === route && opts?.method === method) await wait; return original(p, opts); };
  return async () => { await act(async () => { release(); await tick(0) }); await flush(10); };
}
async function collision(env) {
  const page = await openPage(env); await annotate(page, '第二段');
  await setValue(editor(page).querySelector('textarea'), '我的草稿');
  env.backend.items.push(item('r0002', '第二段', 5, {comment:'对方意见'})); env.backend.version++;
  await click(editor(page).querySelector('[data-er-float-save]'));
  assert.ok(page.el.querySelector('[data-er-collision]')); return page;
}
test('NEW-01 saving disables reselect: submitted anchor is not changed', async () => {
  const env=fresh(); const page=await openPage(env); await annotate(page,'第二段');
  await setValue(editor(page).querySelector('textarea'),'重选保留的字');
  const release=gate(env,'/items','POST');
  await click(editor(page).querySelector('[data-er-float-save]'));
  assert.equal(editor(page).querySelector('[data-er-float-reselect]').disabled, true);
  assert.ok(editor(page).querySelector('[data-er-saving]'));
  await click(editor(page).querySelector('[data-er-float-reselect]'));
  await annotate(page,'第四段');
  assert.match(editor(page).querySelector('.er-float-quote').textContent,/第二段/);
  await release();
  assert.equal(env.backend.items.length, 1);
  assert.equal(env.backend.items[0].text, '第二段');
  assert.equal(env.backend.items[0].comment, '重选保留的字');
  assert.equal(editor(page), null);

});
test('NEW-02 collision response must not close a newer draft', async () => {
  const env=fresh(); const page=await collision(env); const release=gate(env,'/items/r0002','PATCH');
  await click(page.el.querySelector('[data-er-collision-action="replace"]'));
  await key(editor(page).querySelector('textarea'),'Escape'); await flush();
  await annotate(page,'第四段'); await setValue(editor(page).querySelector('textarea'),'新草稿不能丢');
  await release();
  assert.equal(editor(page)?.querySelector('textarea').value,'新草稿不能丢');
  assert.ok(editor(page)?.hasAttribute('data-er-draft'));
});
test('NEW-03 cache retains continue-typing when closing after first save', async () => {
  const env=fresh(); const page=await openPage(env); await annotate(page,'第二段');
  await setValue(editor(page).querySelector('textarea'),'第一版'); const release=gate(env,'/items','POST');
  await click(editor(page).querySelector('[data-er-float-save]'));
  await setValue(editor(page).querySelector('textarea'),'第一版继续写'); await release();
  await page.unmount(); mounted.splice(mounted.indexOf(page),1);
  const reopened=await openPage(env);
  assert.equal(editor(reopened)?.querySelector('textarea').value,'第一版继续写');
  assert.match(editor(reopened).textContent,/恢复了未保存的修改/);
  const slot=Object.values(env.h.ctx.storage.get(KEY).slots)[0];
  assert.equal(slot.kind,'pending-edit');
  assert.equal(slot.itemId,env.backend.items[0].id);
  await click(editor(reopened).querySelector('[data-er-float-save]'));
  assert.equal(env.backend.items[0].comment,'第一版继续写');
  assert.equal(patches(env).length,1,'restored edit PATCHes the saved item');
  assert.equal(env.h.ctx.storage.get(KEY,null),null);
});
test('NEW-04 lost restore draft must not be cleared by an unrelated empty draft', async () => {
  const lost={anchor:{text:'删掉的段落',before:'',after:'',line:5},words:'不能丢的恢复草稿',sig:'x',at:1};
  const env=fresh({stored:{[KEY]:lost}}); const page=await openPage(env);
  assert.ok(page.el.querySelector('[data-er-restore-bar]'));
  await annotate(page,'第三段');
  assert.equal(Object.values(env.h.ctx.storage.get(KEY,null)?.slots ?? {})[0]?.words ?? env.h.ctx.storage.get(KEY,null)?.words,lost.words);
});
test('NEW-05 collision actions single flight', async () => {
  const env=fresh(); const page=await collision(env); const release=gate(env,'/items/r0002','PATCH');
  await click(page.el.querySelector('[data-er-collision-action="merge"]'));
  await click(page.el.querySelector('[data-er-collision-action="merge"]'));
  await release();
  assert.equal(patches(env).length,1);
});
test('NEW-06 reselect keeps underlay and editor together', async () => {
  const env=fresh(); const page=await openPage(env); await annotate(page,'第二段');
  await setValue(editor(page).querySelector('textarea'),'我的字');
  await click(editor(page).querySelector('[data-er-float-reselect]'));
  assert.ok(!drafted().length || editor(page));
});

test('NEW-07 old save-and-send must not send the newly saved draft', async () => {
 const env=fresh(); const page=await openPage(env); await annotate(page,'第二段');
 await setValue(editor(page).querySelector('textarea'),'旧的要发送');
 const original=env.h.ctx.rest; let release; let first=true; const wait=new Promise(r=>release=r);
 env.h.ctx.rest=async(p,o)=>{if(p==='/items'&&o?.method==='POST'&&first){first=false; await wait;} return original(p,o);};
 await click(editor(page).querySelector('[data-er-float-send]'));
 await key(editor(page).querySelector('textarea'),'Escape'); await flush();
 await annotate(page,'第四段'); await setValue(editor(page).querySelector('textarea'),'新的仅保存不发送');
 await click(editor(page).querySelector('[data-er-float-save]'));
 await act(async()=>{release(); await tick(0)}); await flush(10);
 const hs=env.backend.calls.filter(c=>c.path==='/handoffs'&&c.method==='POST');
 assert.equal(hs.length,0,'stale send ticket sends neither old nor new draft');
});
test('NEW-08 restore bar actions must not erase another current draft cache', async () => {
 const lost={anchor:{text:'删掉的段落',before:'',after:'',line:5},words:'旧恢复草稿',sig:'x',at:1};
 const env=fresh({stored:{[`draft:${PATH}`]:lost}}); const page=await openPage(env);
 await annotate(page,'第三段'); await setValue(editor(page).querySelector('textarea'),'新草稿');
 await click(page.el.querySelector('[data-er-restore-action="discard"]'));
 assert.equal(Object.values(env.h.ctx.storage.get(KEY,null)?.slots ?? {}).find(s => s.words === '新草稿')?.words,'新草稿');
});

// Cartesian product of the actual UI entry points. For each ordered pair, let the
// first response precede the second action, or let both actions precede responses.
// Responses settle in one of two ways (R11-J): 'batch' — all parked answers released
// together, newest first, one flush; 'each' — oldest first, one answer, its own flush.
// The backend keeps CAS (409 'stale'). No SKIP and no fabricated operation result.
const actions = ['save', 'send', 'keep', 'replace', 'merge', 'esc-new', 'reselect', 'discard', 'close'];
for (const first of actions) for (const second of actions) for (const early of [true, false]) for (const mode of ['batch', 'each']) {
  test(`interleave ${first} / ${second} / ${early ? 'response-first' : 'response-last'} / ${mode}`, async () => {
    const lost = {anchor:{text:'失去定位的旧原文',before:'',after:'',line:1},words:'恢复槽的文字',sig:'old',at:1};
    const env = fresh({stored:{[KEY]:lost}});
    let page = await openPage(env);
    await annotate(page, '第二段');
    await setValue(editor(page).querySelector('textarea'), 'A保留文字');
    const original = env.h.ctx.rest;
    const waiting = [], submitted = [], expectedSends = new Set();
    let delay = false, droppedA = false, discardedRestore = false;
    const surviving = new Set(['A保留文字']);
    env.h.ctx.rest = async (p, o) => {
      if ((p === '/items' && o?.method === 'POST') || (p.startsWith('/items/r') && o?.method === 'PATCH')) {
        submitted.push({p, body: structuredClone(o.body), quote: editor(page)?.querySelector('.er-float-quote').textContent});
        if (delay) await new Promise(resolve => waiting.push(resolve));
      }
      return original(p, o);
    };
    const settle = async () => {
      while (waiting.length) {
        const batch = mode === 'batch' ? waiting.splice(0).reverse() : waiting.splice(0, 1);
        await act(async () => { batch.forEach(f => f()); await tick(0); });
        await flush(8);
      }
    };
    // the other side's words: comments that were there before me, by item id; only an
    // explicit 用我的替换 on that passage may overwrite them
    const theirs = new Map(), replaced = new Set();
    const run = async (a) => {
      if (a === 'discard') {
        const btn = page.el.querySelector('[data-er-restore-action="discard"]');
        if (btn) { await click(btn); discardedRestore = true; }
        return;
      }
      if (a === 'close') {
        await page.unmount(); mounted.splice(mounted.indexOf(page),1);
        page = await openPage(env);
        return;
      }
      if (a === 'esc-new') {
        const box = editor(page)?.querySelector('textarea');
        if (box) { surviving.delete(box.value); if (box.value.includes('A保留文字')) droppedA = true; await key(box,'Escape'); await flush(); }
        await annotate(page, '第四段');
        await setValue(editor(page).querySelector('textarea'), 'B保留文字'); surviving.add('B保留文字');
        return;
      }
      if (!editor(page)) {
        await annotate(page, '第三段');
        if (editor(page)?.hasAttribute('data-er-draft')) await setValue(editor(page).querySelector('textarea'), 'B保留文字'); surviving.add('B保留文字');
      }
      const e = editor(page);
      // a stored item's editor (a pending edit, or 保留已有's): only 保存 means something there
      if (e && !e.hasAttribute('data-er-draft')) { if (a === 'save') await click(e.querySelector('[data-er-float-save]')); return; }
      if (!e) return;
      if (a === 'reselect') {
        const btn = e.querySelector('[data-er-float-reselect]');
        const locked = btn.disabled;
        const quote = e.querySelector('.er-float-quote').textContent;
        await click(btn);
        if (locked) assert.equal(editor(page).querySelector('.er-float-quote').textContent, quote);
        else await annotate(page, '第四段');
        return;
      }
      if (['keep','replace','merge'].includes(a)) {
        if (e.querySelector('[data-er-float-save]').disabled && !e.querySelector('[data-er-collision]')) return;
        if (!e.querySelector('[data-er-collision]')) {
          const quote = e.querySelector('.er-float-quote').textContent;
          const text = ['第二段','第三段','第四段'].find(s => quote.includes(s));
          const line = text === '第二段' ? 5 : text === '第三段' ? 7 : 9;
          if (!env.backend.items.some(i=>i.text===text)) { const it = item(`r${++env.backend.seq}`,text,line,{comment:'已有意见'}); theirs.set(it.id, text); env.backend.items.push(it); env.backend.version++; }
          const wasDelayed = delay; delay = false;
          await click(e.querySelector('[data-er-float-save]'));
          delay = wasDelayed;
        }
        const btn = page.el.querySelector(`[data-er-collision-action="${a}"]`);
        if (btn && a === 'replace' && !btn.disabled) replaced.add(['第二段','第三段','第四段'].find(x => e.querySelector('.er-float-quote').textContent.includes(x)));
        if (btn) { if (a==='keep' && !btn.disabled) surviving.delete(editor(page).querySelector('textarea').value); if (a==='keep' && !btn.disabled && editor(page).querySelector('textarea').value.includes('A保留文字')) droppedA = true; await click(btn); }
        return;
      }
      const btn = e.querySelector(`[data-er-float-${a}]`);
      if (a === 'send' && !btn.disabled) expectedSends.add(e.querySelector('.er-float-quote').textContent);
      await click(btn);
    };
    // Conflict creation is itself covered by the first operation, not left waiting
    // before there is a conflict choice to click.
    delay = true;
    await run(first);
    if (early) { delay = false; await settle(); }
    await run(second);
    delay = false;
    await settle();
    // 1. no wrong item sent, and no implicit send from save/conflict/reopen
    for (const c of env.backend.calls.filter(c=>c.path==='/handoffs' && c.method==='POST')) for (const sent of c.body.items) {
      const actual = env.backend.items.find(i=>i.id===sent.origin.itemId);
      assert.ok(actual, 'send names a real returned item');
      assert.ok([...expectedSends].some(q=>q.includes(actual.text)), 'only an explicitly sent passage');
      assert.equal(sent.text,actual.text);
    }
    // 2. no wrong original stored: each POST carries the selected original, never
    // another session's words (B is only written on 第三段 / 第四段).
    for (const {p,body,quote} of submitted) if (p==='/items') {
      assert.ok(quote?.includes(body.anchor.text), 'POST anchor equals the original shown when requested');
      assert.ok(['第二段','第三段','第四段'].includes(body.anchor.text));
      if (body.comment==='B保留文字') assert.notEqual(body.anchor.text,'第二段');
    }
    // 3. all words survive somewhere durable (or in the active editor), unless the
    // user explicitly discarded them or chose 保留已有.
    const slots = Object.values(env.h.ctx.storage.get(KEY,null)?.slots ?? {});
    const contents = [...slots.map(s=>s.words ?? s.text),...env.backend.items.map(i=>i.comment),editor(page)?.querySelector('textarea').value].filter(Boolean).join('\n');
    if (!droppedA) assert.ok(contents.includes('A保留文字'), 'written A survives');
    for (const text of surviving) assert.ok(contents.includes(text), `written ${text} survives`);
    // 3b. the other side's words survive too (R11-J, XR11c-01), unless I chose 用我的替换 there
    for (const [id, text] of theirs) if (!replaced.has(text)) assert.match(env.backend.items.find(i=>i.id===id).comment, /已有意见/, `their words on ${text} survive`);
    // 4. the restore bar's slot is never cleared by another draft's save or Esc.
    const legacy = env.h.ctx.storage.get(KEY,null);
    assert.equal(slots.some(s=>s.words===lost.words) || legacy?.words===lost.words, !discardedRestore);
    const active = editor(page);
    if (active?.hasAttribute('data-er-draft') && active.querySelector('textarea').value.trim()) assert.ok(slots.some(s=>s.words===active.querySelector('textarea').value), 'active draft has its own cache slot');
  });
}

test('explicit 保存并发送 sends the returned id once, not an auto-flushed pending edit', async () => {
  const env=fresh(); const page=await openPage(env); await annotate(page,'第二段');
  await setValue(editor(page).querySelector('textarea'),'发送此版本');
  const release=gate(env,'/items','POST');
  await click(editor(page).querySelector('[data-er-float-send]'));
  await setValue(editor(page).querySelector('textarea'),'发送后继续修改');
  await release();
  const handoffs=env.backend.calls.filter(c=>c.path==='/handoffs'&&c.method==='POST');
  assert.equal(handoffs.length,1);
  assert.equal(handoffs[0].body.items[0].origin.itemId,env.backend.items[0].id);
  assert.equal(handoffs[0].body.items[0].comment,'发送此版本');
  assert.equal(patches(env).length,0,'no implicit PATCH of words typed later');
  assert.equal(editor(page).querySelector('textarea').value,'发送后继续修改');
});
