// Review (W2c): md-map — rendered text ↔ Markdown source offsets. Pure module.
// Computed loads reviewed: see the override in publish/public-export-manifest.json.
import test from 'node:test'
import assert from 'node:assert/strict'

import { project, toSource, toRendered, normalize, describe } from '../../plugins/diple-docs/desktop/src/review/md-map.js'

const DOC = `# 缓存方案 #

先**更新数据库**，再删除缓存。见 [设计文档](https://example.com/a_(b)) 和 \`cache_key\`。

- [ ] 任务一：用 *延迟双删*
- 任务二 &amp; 收尾
1. 编号项 snake_case_name

> 引用里的话

| 列 A | 列 B |
|---|:-:|
| 甲 | 乙 |

\`\`\`python
x = a * b  # **不是粗体**
\`\`\`

---
再删除缓存。<br>结束\\*号
`

test('S50: the projection drops Markdown syntax the renderer hides', () => {
  const { plain } = project(DOC)
  assert.equal(
    plain,
    '缓存方案 先更新数据库，再删除缓存。见 设计文档 和 cache_key。 任务一：用 延迟双删 任务二 & 收尾 编号项 snake_case_name 引用里的话 列 A 列 B 甲 乙 x = a * b # **不是粗体** 再删除缓存。 结束*号'
  )
})

test('S50: every projected character maps back to the same character in the source', () => {
  const { plain, map } = project(DOC)
  for (let i = 0; i < plain.length; i++) {
    if (plain[i] === ' ') continue
    const s = DOC[map[i]]
    if (plain[i] === '&') assert.equal(DOC.slice(map[i], map[i] + 5), '&amp;')
    else assert.equal(s, plain[i], `plain[${i}]`)
  }
})

test('S49/S50: a phrase selected in the rendered view finds its source range across markup', () => {
  const r = toSource(DOC, '更新数据库，再删除', { occurrence: 0, count: 1, ratio: 0 })
  assert.equal(DOC.slice(r.start, r.end), '更新数据库**，再删除')
  const link = toSource(DOC, '设计文档 和 cache_key', null)
  assert.equal(DOC.slice(link.start, link.end), '设计文档](https://example.com/a_(b)) 和 `cache_key')
})

test('S49: a phrase that occurs twice is told apart by its occurrence in the rendered text', () => {
  const first = toSource(DOC, '再删除缓存。', { occurrence: 0, count: 2, ratio: 0.1 })
  const second = toSource(DOC, '再删除缓存。', { occurrence: 1, count: 2, ratio: 0.9 })
  assert.ok(first.start < second.start)
  assert.equal(DOC.slice(second.start, second.end), '再删除缓存。')
  assert.equal(DOC.lastIndexOf('再删除缓存。'), second.start)
})

test('S49: when counts disagree the closest relative position wins; a missing phrase is null', () => {
  const r = toSource(DOC, '再删除缓存。', { occurrence: 0, count: 3, ratio: 0.95 })
  assert.equal(r.start, DOC.lastIndexOf('再删除缓存。'))
  assert.equal(toSource(DOC, '根本不存在的话', null), null)
  assert.equal(toSource(DOC, '   ', null), null)
})

test('S48: a source range is painted back as rendered text with its occurrence', () => {
  const s = DOC.lastIndexOf('再删除缓存。')
  const r = toRendered(DOC, s, s + '再删除缓存。'.length)
  assert.deepEqual([r.text, r.occurrence, r.count], ['再删除缓存。', 1, 2])
  const b = DOC.indexOf('**更新')
  const bold = toRendered(DOC, b, b + '**更新数据库**'.length)
  assert.equal(bold.text, '更新数据库')
})

test('describe/normalize helpers', () => {
  assert.equal(normalize('  a\n\n b\t c  '), 'a b c')
  assert.deepEqual(describe('ab ab ab', 'ab', 3), { occurrence: 1, count: 3, ratio: 3 / 8 })
})

test('code fences keep their content verbatim and an unclosed fence runs to the end', () => {
  assert.equal(project('```\n*a* `b`\n').plain, '*a* `b`')
  assert.equal(project('~~~md\n# h\n~~~\n# real').plain, '# h real')
})

test('setext headings and thematic breaks are not text', () => {
  assert.equal(project('Title\n=====\n\npara\n\n***\n').plain, 'Title para')
})

// model.js imports @diple/core (a build alias), so bundle it the way scripts/build.mjs does.
const { build } = await import('esbuild')
const here = new URL('../..', import.meta.url).pathname
const bundled = await build({
  entryPoints: [`${here}plugins/diple-docs/desktop/src/review/model.js`],
  bundle: true,
  format: 'esm',
  write: false,
  alias: { '@diple/core': `${here}packages/core/src/index.js` }
})
const { trimRange, relocate, arrange } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`)
const Anchor = await import('../../packages/core/src/anchor.js')

test('S49: a selection that cuts an emphasis marker in half pulls the marker in', () => {
  const doc = '先**更新数据库**，再删除缓存。`code` x'
  const s = doc.indexOf('更新')
  const r = trimRange(doc, s, doc.indexOf('，再删除') + 4)
  assert.equal(doc.slice(r.start, r.end), '**更新数据库**，再删除')
  const c = doc.indexOf('code')
  const rc = trimRange(doc, c, c + 4)
  assert.equal(doc.slice(rc.start, rc.end), 'code', 'a balanced span is left alone')
  assert.equal(trimRange(doc, 3, 3), null)
  assert.deepEqual(trimRange('  ab  ', 0, 6), { start: 2, end: 4 })
})

test('S58: relocate reports only items whose stored anchor must change', () => {
  const doc = 'a\nhello world\nb'
  const items = [
    { id: 'r0001', anchor: { text: 'hello', before: 'a\n', after: ' world\nb', line: 2, sig: Anchor.fingerprint(doc) }, lost: false },
    { id: 'r0002', anchor: { text: 'gone', before: '', after: '', line: 1 }, lost: false },
    { id: 'r0003', anchor: { text: 'world', before: 'x', after: '', line: 9 }, lost: true }
  ]
  const { ranges, results } = relocate(doc, items)
  assert.deepEqual([...ranges.keys()], ['r0001', 'r0003'])
  assert.deepEqual(results.map((r) => [r.id, r.lost ?? r.anchor.line]), [['r0002', true], ['r0003', 2]])
  // an anchor saved without the document fingerprint is upgraded once (XR-05)
  const legacy = relocate(doc, [{ id: 'r0004', anchor: { text: 'hello', before: 'a\n', after: ' world\nb', line: 2 }, lost: false }])
  assert.equal(legacy.results[0].anchor.sig, Anchor.fingerprint(doc))
})

test('S56: arrange keeps document order, folds resolved, and counts every status', () => {
  const it = (id, status, line, lost = false) => ({ id, status, lost, anchor: { line }, createdAt: 0 })
  const items = [it('c', 'resolved', 1), it('a', 'sent', 5), it('b', 'pending', 2, true)]
  const { shown, resolved, counts } = arrange(items, new Map([['a', { start: 50, end: 60 }]]), 'all')
  assert.deepEqual(shown.map((x) => x.id), ['b', 'a'])
  assert.deepEqual(resolved.map((x) => x.id), ['c'])
  assert.deepEqual(counts, { all: 3, pending: 0, sent: 1, answered: 0, changed: 1, resolved: 1 })
})

test('XR-07: invalid numeric entities never throw; they map like the renderer (U+FFFD)', () => {
  for (const src of ['x &#xFFFFFF; y', 'x &#9999999; y', 'x &#xD800; y', 'x &#0; y']) {
    const p = project(src)
    assert.equal(p.plain, 'x \uFFFD y', src)
  }
  // more than 7 decimal digits is not a reference at all (CommonMark): shown literally
  assert.equal(project('x &#99999999; y').plain, 'x &#99999999; y')
  assert.equal(project('a &#x4E2D; b').plain, 'a 中 b')
  assert.equal(project('a &#65; b').plain, 'a A b')
})
