// Client of the Diple Docs backend (/api/plugins/diple-docs/…).

export function createApi(rest) {
  const enc = encodeURIComponent
  const json = (method, body) => ({ method, body })
  return {
    health: () => rest('/health'),
    readFile: (path) => rest(`/file?path=${enc(path)}`),
    statFile: (path) => rest(`/file/stat?path=${enc(path)}`),
    reviewState: (path) => rest(`/review/state?path=${enc(path)}`),
    recentReviews: (limit = 20) => rest(`/reviews/recent?limit=${limit}`),
    forgetReview: (path) => rest(`/reviews/recent?path=${enc(path)}`, { method: 'DELETE' }),
    listItems: (path) => rest(`/items?path=${enc(path)}`),
    /** V3-D2: counts for many lists in one read (the transcript cards). */
    itemsSummary: (paths) => rest('/items/summary', json('POST', { paths })),
    addItem: (path, anchor, comment = '') => rest('/items', json('POST', { path, anchor, comment })),
    updateItem: (id, body) => rest(`/items/${enc(id)}`, json('PATCH', body)),
    deleteItem: (id) => rest(`/items/${enc(id)}`, { method: 'DELETE' }),
    restoreItem: (item) => rest('/items/restore', json('POST', item)),
    applyLocations: (path, results) => rest('/items/locate', json('POST', { path, results })),
    batchSent: (payload) => rest('/events/batch-sent', json('POST', payload)),
    batchAnswered: (payload) => rest('/events/batch-answered', json('POST', payload)),
    createHandoff: (payload) => rest('/handoffs', json('POST', payload)),
    pendingHandoffs: () => rest('/handoffs'),
    unconfirmedHandoffs: () => rest('/handoffs/unconfirmed'),
    getHandoff: (id) => rest(`/handoffs/${enc(id)}`),
    recordReceipt: (id, receipt) => rest(`/handoffs/${enc(id)}/receipt`, json('POST', receipt)),
    cancelHandoff: (id) => rest(`/handoffs/${enc(id)}/cancel`, { method: 'POST' }),
    rebroadcastHandoff: (id, body) => rest(`/handoffs/${enc(id)}/rebroadcast`, body ? json('POST', body) : { method: 'POST' }),
    recordSettled: (id, settled) => rest(`/handoffs/${enc(id)}/settled`, json('POST', settled)),
    replayHandoff: (id) => rest(`/handoffs/${enc(id)}/replay`, { method: 'POST' }),
    rebroadcastPending: () => rest('/handoffs/rebroadcast-pending', { method: 'POST' }),
    sessionTitles: (ids) => rest(`/sessions/titles?ids=${enc(ids.join(','))}`),
    getSettings: () => rest('/settings'),
    putSettings: (patch) => rest('/settings', json('PUT', patch)),
    // V3-D2 (L) bulk list actions: each one transaction, all or nothing
    bulkDelete: (path, ids, expectMutations) => rest('/items/bulk-delete', json('POST', { path, ids, expectMutations })),
    bulkRestore: (items) => rest('/items/bulk-restore', json('POST', { items })),
    bulkResolve: (path, ids, expectMutations) => rest('/items/bulk-resolve', json('POST', { path, ids, expectMutations }))
  }
}

/** A stable error code from a ctx.rest failure (the backend sends {detail: code}). */
export function errorCode(err) {
  const raw = err?.detail ?? err?.body?.detail ?? err?.data?.detail
  if (typeof raw === 'string') return raw
  const m = String(err?.message ?? '').match(/"detail"\s*:\s*"([^"]+)"/)
  if (m) return m[1]
  const status = err?.status ?? err?.statusCode
  if (status === 404) return 'not-found'
  if (status === 415) return 'unsupported-suffix'
  if (status === 413) return 'too-large'
  if (status === 403) return 'sensitive-path'
  return 'network'
}
