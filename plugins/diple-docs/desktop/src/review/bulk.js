// bulk: what the list's ⋯ menu acts on (V3-D2 L #2). Pure.
//
//   bulkPlan(items, ranges, filter) → { all, resolved, sent, changed, resolvable, filtered }
//     all         every annotation of the file (清除全部)
//     resolved    已解决 (清除已解决)
//     sent        已发送 or 已回应, not 原文已变 (清除已发送/已回应)
//     changed     原文已变 (清除原文已变)
//     resolvable  everything not yet 已解决 (全部标为已解决)
//     filtered    what the current filter shows, or null under 全部 (清除当前筛选的 N 条)
//   copyAll(items, ranges) → Markdown of every annotation in document order: each one
//     as the single-card copy does (core CopyText.block: the original quoted with '>',
//     a blank line, the words), separated by a blank line.
//   UNDO_MS — how long a clear can be undone (the chat's 全部清空 toast, ~8 s).
import { CopyText } from '@diple/core'

import { arrange, displayStatus, docOrder } from './model.js'

export const UNDO_MS = 8000

export function bulkPlan(items, ranges, filter = 'all') {
  const all = docOrder(items, ranges)
  const by = (fn) => all.filter(fn)
  return {
    all,
    resolved: by((it) => it.status === 'resolved'),
    sent: by((it) => ['sent', 'answered'].includes(displayStatus(it))),
    changed: by((it) => displayStatus(it) === 'changed'),
    resolvable: by((it) => it.status !== 'resolved'),
    filtered: filter === 'all' ? null : arrange(items, ranges, filter).shown
  }
}

export function copyAll(items, ranges) {
  return docOrder(items, ranges)
    .map((it) => CopyText.block({ text: it.text, comment: it.comment }))
    .join('\n\n')
}
