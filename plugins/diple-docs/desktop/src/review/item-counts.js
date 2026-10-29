// The transcript cards' item counts (V3-D2, ADR 0013). Every ::diple-docs card
// used to fetch GET /items itself; a long chat restored at startup sent dozens
// in one millisecond while the gateway was still starting, and all of them
// failed for good ("Gateway ticket bootstrap failed"). Now cards watch a path
// here: paths asked for together go out as ONE POST /items/summary, a failure
// is retried with backoff (a starting gateway is a temporary error), and one
// timer refreshes every watched path in one request.

export const BACKOFF_MS = Object.freeze([1000, 2000, 4000, 8000, 15000, 30000])
const COALESCE_MS = 16

/**
 * @param {{
 *   fetch: (paths: string[]) => Promise<{counts: Record<string, any>}>,
 *   later: (fn: () => void, ms: number) => () => void,
 *   refreshMs?: number,
 *   isVisible?: () => boolean
 * }} o
 */
export function createItemCounts({ fetch, later, refreshMs = 20_000, isVisible = () => true }) {
  const values = new Map() // path → counts | {error} (final)
  const watchers = new Map() // path → Set<fn>
  const wanted = new Set() // paths to ask for in the next request
  let flushTimer = null
  let retryTimer = null
  let refreshTimer = null
  let inflight = false
  let attempt = 0
  let disposed = false

  const cancel = (t) => t?.()

  function scheduleFlush() {
    if (disposed || flushTimer || retryTimer || inflight) return
    flushTimer = later(() => {
      flushTimer = null
      void flush()
    }, COALESCE_MS)
  }

  function scheduleRefresh() {
    cancel(refreshTimer)
    refreshTimer = null
    if (disposed || !watchers.size) return
    refreshTimer = later(() => {
      refreshTimer = null
      if (!watchers.size) return
      if (isVisible()) {
        for (const p of watchers.keys()) wanted.add(p)
        scheduleFlush()
      } else scheduleRefresh()
    }, refreshMs)
  }

  async function flush() {
    if (disposed || inflight) return
    const paths = [...wanted].filter((p) => watchers.has(p))
    wanted.clear()
    if (!paths.length) return
    inflight = true
    let res
    try {
      res = await fetch(paths)
    } catch {
      inflight = false
      if (disposed) return
      for (const p of paths) wanted.add(p)
      const wait = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]
      attempt++
      cancel(refreshTimer)
      refreshTimer = null
      retryTimer = later(() => {
        retryTimer = null
        void flush()
      }, wait)
      return
    }
    inflight = false
    if (disposed) return
    attempt = 0
    const counts = res?.counts ?? {}
    for (const p of paths) {
      const v = counts[p]
      if (v === undefined) continue
      const before = values.get(p)
      values.set(p, v)
      if (JSON.stringify(before) !== JSON.stringify(v)) for (const fn of [...(watchers.get(p) ?? [])]) fn(peek(p))
    }
    if (wanted.size) scheduleFlush()
    scheduleRefresh()
  }

  function peek(path) {
    const v = values.get(path)
    return v && !v.error ? v : null
  }

  return {
    peek,
    watch(path, fn) {
      let set = watchers.get(path)
      if (!set) watchers.set(path, (set = new Set()))
      set.add(fn)
      if (!values.has(path)) {
        wanted.add(path)
        scheduleFlush()
      } else if (!refreshTimer && !retryTimer) scheduleRefresh()
      return () => {
        set.delete(fn)
        if (!set.size) watchers.delete(path)
        if (!watchers.size) {
          cancel(refreshTimer)
          refreshTimer = null
        }
      }
    },
    /** Lists changed (a hand-off settled, an edit): refetch what is on screen, once. */
    invalidate() {
      for (const p of watchers.keys()) wanted.add(p)
      scheduleFlush()
    },
    dispose() {
      disposed = true
      for (const t of [flushTimer, retryTimer, refreshTimer]) cancel(t)
      watchers.clear()
      wanted.clear()
    }
  }
}

/**
 * The summary request, with a fallback for a backend that predates it (the
 * desktop half hot-reloads; the Python half needs a restart): on 404/405 the
 * paths are read one GET /items at a time — never all at once.
 */
export function summaryFetcher(api) {
  let legacy = false
  const old = async (paths) => {
    const counts = {}
    for (const p of paths) {
      const r = await api.listItems(p)
      const items = r?.items ?? []
      const byStatus = { pending: 0, sent: 0, answered: 0, resolved: 0 }
      for (const it of items) byStatus[it.status in byStatus ? it.status : 'pending']++
      counts[p] = { total: items.length, open: items.length - byStatus.resolved, byStatus, lost: items.filter((i) => i.lost).length }
    }
    return { counts }
  }
  return async (paths) => {
    if (legacy) return old(paths)
    try {
      return await api.itemsSummary(paths)
    } catch (err) {
      const status = err?.status ?? err?.statusCode
      if (status === 404 || status === 405) {
        legacy = true
        return old(paths)
      }
      throw err
    }
  }
}
