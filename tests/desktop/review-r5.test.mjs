// fix-r5 audit — a late answer never overwrites a newer one in the Review page's
// document store: list reads take a ticket like file reads (XR-06).
import test from 'node:test'
import assert from 'node:assert/strict'

import { setupDom, loadEntry } from './harness.mjs'
import { flush } from './flow-fixture.mjs'

setupDom()
const { createDocStore } = await loadEntry('diple-docs', 'tests/desktop/fixtures/review-doc-store.js')

const deferred = () => {
  let resolve
  const promise = new Promise((r) => (resolve = r))
  return { promise, resolve }
}

test('audit: an older list read that answers last does not replace the newer list', async () => {
  const reads = []
  const api = {
    readFile: async () => ({ text: '# 标题\n\n第一段', mtime: 1 }),
    listItems: () => {
      const d = deferred()
      reads.push(d)
      return d.promise
    },
    applyLocations: async () => ({}),
    reviewState: async () => ({ exists: true, mtime: 1, itemsVersion: 'v0' })
  }
  const doc = createDocStore({ api, path: '/w/a.md', schedule: () => () => {} })
  const loading = doc.load()
  await flush()
  reads.shift().resolve({ items: [], itemsVersion: 'v0' })
  await loading
  const item = (status) => ({ id: 'r0001', revision: 1, mutation: status === 'sent' ? 2 : 1, status, text: '第一段', comment: '', anchor: { text: '第一段', before: '', after: '', line: 3 } })
  const older = doc.reloadItems()
  const newer = doc.reloadItems()
  await flush()
  const [first, second] = reads.splice(0)
  second.resolve({ items: [item('sent')], itemsVersion: 'v2' })
  await newer
  first.resolve({ items: [item('pending')], itemsVersion: 'v1' })
  await older
  assert.equal(doc.get().itemsVersion, 'v2')
  assert.equal(doc.get().items[0].status, 'sent', 'the late older read was dropped')
})
