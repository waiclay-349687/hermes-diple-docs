// V2-D: the way back from the 标注清单 to the original text. Seam: scrollPlan()
// — given where the words are and the visible box, does the document scroll,
// to where, and how. The page's use of it is covered in v2d-page.test.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'

import { scrollPlan } from '../../plugins/diple-docs/desktop/src/review/locate.js'

const box = { top: 100, bottom: 700, height: 600 }

test('already in view: no scroll at all', () => {
  assert.equal(scrollPlan({ rect: { top: 300, bottom: 320 }, box, scrollTop: 500 }), null)
  // touching the comfortable margin still counts as visible
  assert.equal(scrollPlan({ rect: { top: 125, bottom: 145 }, box, scrollTop: 500 }), null)
})

test('outside the view: a smooth scroll that centres the words', () => {
  const below = scrollPlan({ rect: { top: 1500, bottom: 1520 }, box, scrollTop: 500 })
  // words' centre (1510) lands at the box's centre (400): 500 + (1510 - 400)
  assert.deepEqual(below, { top: 1610, behavior: 'smooth' })
  const above = scrollPlan({ rect: { top: -300, bottom: -280 }, box, scrollTop: 900 })
  assert.deepEqual(above, { top: 900 + (-290 - 400), behavior: 'smooth' })
})

test('partly cut off at an edge counts as outside', () => {
  const p = scrollPlan({ rect: { top: 690, bottom: 712 }, box, scrollTop: 0 })
  assert.equal(p?.behavior, 'smooth')
})

test('reduced motion: jump straight there', () => {
  assert.deepEqual(scrollPlan({ rect: { top: 1500, bottom: 1520 }, box, scrollTop: 500, reduced: true }), { top: 1610, behavior: 'auto' })
})

test('never scrolls above the top', () => {
  assert.deepEqual(scrollPlan({ rect: { top: 20, bottom: 40 }, box, scrollTop: 50 }), { top: 0, behavior: 'smooth' })
})

test('words taller than the view: their top goes near the top of the view', () => {
  const p = scrollPlan({ rect: { top: 900, bottom: 2000 }, box, scrollTop: 0 })
  assert.deepEqual(p, { top: 900 - 100 - 24, behavior: 'smooth' })
})
