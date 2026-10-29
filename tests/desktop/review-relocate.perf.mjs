// XR2-02 performance regression on the REAL review model interface (relocate), as the
// review page calls it: a 4.9 MB document with 1000 identical full-context copies,
// 100 annotations, the earlier version known. Must stay under a second warm, and
// under two seconds on the first (cold) run.
// A *.perf.mjs file: npm test runs it after the parallel suite, serially
// (--test-concurrency=1), so other test files cannot eat its time budget.
// Computed loads reviewed: see the override in publish/public-export-manifest.json.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'esbuild'

import { ROOT } from './harness.mjs'

async function loadModel() {
  const out = await build({
    entryPoints: [path.join(ROOT, 'plugins/diple-docs/desktop/src/review/model.js')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    alias: { '@diple/core': path.join(ROOT, 'packages/core/src/index.js') },
    logLevel: 'warning'
  })
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))
}
const model = await loadModel()
const { Anchor } = await import('../../packages/core/src/index.js')

const B = 'X'.repeat(34) + 'word' + 'Y'.repeat(34) + '\n' + 'z'.repeat(4826) + '\n'
const OLD = '# HEAD\n' + B.repeat(1000) + '# FOOT OLD\n'
const EDITED = OLD.replace('FOOT OLD', 'FOOT NEW')
const items = Array.from({ length: 100 }, (_, i) => {
  const at = 7 + i * B.length + 34
  return { id: `r${i}`, anchor: Anchor.makeAnchor(OLD, at, at + 4), lost: false }
})

// XR11d-04: each case runs 3 times; EVERY run's result is checked and every
// sample printed. Two limits per case:
//   cold: the FIRST run (cold start, first computation) < 2 s (twice the warm limit);
//   warm: the fastest of the 3 runs < 1 s (unchanged: load on the machine only adds
//         time, so the best run filters noise; the cold limit catches a slow first run).
const RUNS = 3
const COLD_MS = 2000
const WARM_MS = 1000
function measure(label, fn, check) {
  const samples = []
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    const r = fn()
    samples.push(performance.now() - t0)
    check(r, `${label}, run ${i + 1}`)
  }
  const shown = samples.map((ms) => Math.round(ms)).join(' / ')
  console.log(`perf relocate ${label}: ${shown} ms (cold first, then warm)`)
  assert.ok(samples[0] < COLD_MS, `${label} cold: first run ${Math.round(samples[0])} ms ≥ ${COLD_MS} ms (all runs: ${shown} ms)`)
  assert.ok(Math.min(...samples) < WARM_MS, `${label} warm: best of ${RUNS} ${Math.round(Math.min(...samples))} ms ≥ ${WARM_MS} ms (all runs: ${shown} ms)`)
}
const all100 = (r, what) => assert.equal(r.ranges.size, 100, `${what}: all 100 carried`)

test('XR2-02: relocate of 100 annotations in a 4.9 MB document with 1000 repeats < 1 s (edited, prior known)', () => {
  assert.ok(Buffer.byteLength(OLD) > 4_800_000 && Buffer.byteLength(OLD) < 5 * 1024 * 1024)
  measure('edited', () => model.relocate(EDITED, items, [OLD]), all100)
})

test('XR2-02: the unchanged document and a second pass stay < 1 s each', () => {
  measure('unchanged', () => model.relocate(OLD, items), all100)
  measure('second pass', () => model.relocate(EDITED, items, [OLD]), all100)
  measure('second pass, reversed', () => model.relocate(OLD, items, [EDITED]), all100)
})
