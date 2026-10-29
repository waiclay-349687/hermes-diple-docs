// R11 XR11-09: the Diple Docs click matrix as data a machine can check (used by
// tests/e2e/v3d3-matrix.mjs; a helper, not a test).
// Every control of design §11 is one entry; `states` names what must really be
// clicked: 'on' (usable, its action carried out and asserted) and, where the
// control has one, 'off' (disabled, asserted inert). v3d3-matrix.mjs records one
// ledger entry per (id, state) it ran; audit() turns the ledger into the verdict:
//   - a control state that was never run is MISSING → a failure (no silent continue)
//   - a SKIP is counted on its own and is NOT a pass; only a control marked
//     `manual` (with its reason) may be skipped — today T3 alone
//   - any failing check of a row fails that control state
// tests/desktop/v3d3-matrix-manifest.test.mjs keeps this list complete.

// the plugin these controls belong to (the public export puts this file with it)
export const PLUGIN_DIR = 'plugins/diple-docs/'

export const CONTROLS = [
  // toolbar
  { id: 'T1', label: '排版/源码', states: ['on'] },
  { id: 'T2', label: '刷新', states: ['on'] },
  { id: 'T3', label: '文件夹（在访达中显示）', states: ['on'], manual: 'opens Finder on the host: the sandbox bridge is read-only, so it is checked by hand' },
  { id: 'T4', label: '侧栏开关', states: ['on'] },
  // selection and the editor under the passage
  { id: 'S1', label: '选区「标注」', states: ['on'] },
  { id: 'S1-menu', label: '「⋯」开着时拖选文档（菜单关，选区完整）', states: ['on'] },
  { id: 'F1', label: '浮层输入框', states: ['on'] },
  { id: 'F2', label: '替换原文（草稿）', states: ['on'] },
  { id: 'F3', label: '保存', states: ['on'] },
  { id: 'F4', label: '保存并发送', states: ['on'] },
  { id: 'F5a', label: '点浮层外面（空草稿）', states: ['on'] },
  { id: 'F5b', label: '点浮层外面（写了字）', states: ['on'] },
  { id: 'F6', label: 'Esc（草稿）', states: ['on'] },
  { id: 'F6x', label: '×（草稿）', states: ['on'] },
  { id: 'F7', label: '有字的草稿开着时点卡片（守卫）', states: ['on'] },
  // the list head
  { id: 'L1', label: '下一条未处理', states: ['on'] },
  { id: 'L1b', label: '上一条未处理', states: ['on'] },
  ...['all', 'pending', 'sent', 'answered', 'changed', 'resolved'].map((f) => ({ id: `L2-${f}`, label: `筛选 ${f}`, states: ['on'] })),
  { id: 'L3', label: '「⋯」打开 / Esc', states: ['on'] },
  { id: 'L3-copy', label: '⋯ 复制全部为 Markdown', states: ['on'] },
  { id: 'L3-clear-sent', label: '⋯ 清除已发送/已回应 + 撤销', states: ['on'] },
  { id: 'L3-clear-all', label: '⋯ 清除全部 + 撤销', states: ['on'] },
  { id: 'L3-clear-resolved', label: '⋯ 清除已解决', states: ['on', 'off'] },
  { id: 'L3-clear-changed', label: '⋯ 清除原文已变', states: ['on', 'off'] },
  { id: 'L3-clear-filter', label: '⋯ 清除当前筛选', states: ['on'] },
  { id: 'L3-resolve-all', label: '⋯ 全部标为已解决', states: ['on', 'off'] },
  // the send menu, every entry carried out (payload read at the REST layer)
  { id: 'L4', label: '「发送 N 条 ▾」打开 / Esc', states: ['on'] },
  { id: 'L4-scope', label: '发送菜单 › 范围切换', states: ['on'] },
  { id: 'L4-copy', label: '发送菜单 › 复制给 AI', states: ['on'] },
  { id: 'L4-current', label: '发送菜单 › 当前会话', states: ['on'] },
  { id: 'L4-recent', label: '发送菜单 › 最近会话', states: ['on'] },
  { id: 'L4-queue', label: '发送菜单 › 加入待发', states: ['on'] },
  // cards
  { id: 'C1', label: '卡片', states: ['on'] },
  { id: 'C2', label: '卡片原文', states: ['on'] },
  { id: 'C3', label: '编辑意见 / Esc', states: ['on'] },
  { id: 'C3-dbl', label: '双击意见', states: ['on'] },
  { id: 'C3-save', label: '编辑意见 › 保存', states: ['on'] },
  { id: 'C4', label: '状态标签', states: ['on'] },
  { id: 'C5', label: '标为已解决', states: ['on'] },
  { id: 'C6', label: '发送这一条（已发送的卡片：菜单开，发送灰，复制可用）', states: ['on', 'off'] },
  { id: 'C7', label: '删除 + 撤销', states: ['on'] },
  { id: 'C8', label: '「已解决」分组展开 / 收起', states: ['on'] },
  { id: 'C9', label: '已解决卡片 › 重新打开', states: ['on'] },
  { id: 'C10', label: '已发送卡片上的会话按钮', states: ['on'] },
  { id: 'C11', label: '原文已变卡片 › 重选', states: ['on'] },
  // the document's own marks
  { id: 'D1', label: '文档里已有标注的底纹', states: ['on'] },
  { id: 'D2', label: '已标注的原文再「标注」', states: ['on'] },
  // the rail, the bar, the handle (R11-I: no R4 — the rail has no expand of its
  // own; the toolbar switch T4 is the one expand)
  { id: 'R1', label: '刻度悬停', states: ['on'] },
  { id: 'R2', label: '刻度点击', states: ['on'] },
  { id: 'R3', label: '状态条的下一条', states: ['on'] },
  { id: 'B1', label: '底栏折叠 / 还原', states: ['on'] },
  { id: 'H1', label: '拖拽手柄：拖动', states: ['on'] },
  { id: 'H2', label: '拖拽手柄：双击（默认宽度）', states: ['on'] },
  { id: 'H3', label: '拖拽手柄：单击（收起）', states: ['on'] },
  // the pages around it
  { id: 'P1', label: '聊天里的「用圈批·文档打开」', states: ['on'] },
  { id: 'P2', label: '最近的文档（palette 命令）› 打开一行', states: ['on'] },
  { id: 'P2-remove', label: '最近的文档 › 移除', states: ['on'] },
  { id: 'P3', label: '设置页开关', states: ['on'] }
]

export const keyOf = (id, state = 'on') => `${id}@${state}`

/**
 * ledger: { 'ID@state': { result: 'pass' | 'fail' | 'skip', reason? } }
 * → { pass, fail, skip, missing: [keys], unknown: [keys], problems: [lines], ok }
 */
export function audit(ledger, controls = CONTROLS) {
  const out = { pass: 0, fail: 0, skip: 0, missing: [], unknown: [], problems: [] }
  const wanted = new Set()
  for (const c of controls) {
    for (const s of c.states) {
      const k = keyOf(c.id, s)
      wanted.add(k)
      const e = ledger[k]
      if (c.manual) {
        out.skip++
        if (e && e.result !== 'skip') out.problems.push(`${k}: manual control was recorded as ${e.result}`)
        continue
      }
      if (!e) {
        out.missing.push(k)
        out.fail++
        out.problems.push(`${k}: never run (missing)`)
      } else if (e.result === 'pass') out.pass++
      else if (e.result === 'skip') {
        out.skip++
        out.fail++
        out.problems.push(`${k}: skipped (${e.reason ?? 'no reason'}) — only manual controls may skip`)
      } else {
        out.fail++
        out.problems.push(`${k}: failed${e.reason ? ` (${e.reason})` : ''}`)
      }
    }
  }
  for (const k of Object.keys(ledger)) if (!wanted.has(k)) out.unknown.push(k)
  for (const k of out.unknown) out.problems.push(`${k}: not in the control list`)
  out.ok = out.problems.length === 0
  return out
}

// The REST writes a user action may cause (reads, location sync, summaries and the
// event relays every window sends are not user writes).
export const USER_WRITE = (e) =>
  e.method !== 'GET' &&
  !/^\/(items\/locate|items\/summary|events\/[^/]+|handoffs\/rebroadcast-pending|handoffs\/[^/]+\/(receipt|settled|rebroadcast|cancel))$/.test(e.route) &&
  !(e.method === 'POST' && e.route === '/reviews/recent')

/** Count journal entries by "METHOD /route" with item ids folded to :id. */
export function tally(entries) {
  const out = {}
  for (const e of entries.filter(USER_WRITE)) {
    const k = `${e.method} ${e.route.replace(/^\/items\/r[0-9a-f]{8,}$/, '/items/:id').replace(/\/handoffs\/[^/]+/, '/handoffs/:id')}`
    out[k] = (out[k] ?? 0) + 1
  }
  return out
}
