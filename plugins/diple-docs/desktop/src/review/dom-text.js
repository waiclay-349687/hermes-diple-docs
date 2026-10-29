// dom-text: the visible text of a rendered document as one normalized string,
// with a way back to DOM positions. Used to turn a reader's selection into a
// source range (via md-map) and a source range back into DOM Ranges for the
// highlight paint.
//
//   const idx = indexText(root)
//   idx.text                         normalized text (single spaces, block boundaries = space)
//   idx.offsetOf(node, offset)       → normalized index of a DOM point inside root, or -1
//   idx.rangeFor(start, end)         → DOM Range covering normalized [start, end), or null
//
// Text inside buttons, svg and aria-hidden chrome (code block headers, copy
// buttons) is skipped: it is not part of the document.

const BLOCK = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BR', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY',
  'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
])
const SKIP = 'button, svg, [aria-hidden="true"], [data-diple-docs-skip], script, style, input, textarea, select'
const WS = /[\s\u00a0]/

export function indexText(root) {
  const chars = []
  const nodes = [] // per char: text node
  const offs = [] // per char: offset in that node
  const starts = new Map() // text node → [{ raw, norm }] checkpoints
  let pendingSpace = false

  const emitSpace = () => {
    if (chars.length) pendingSpace = true
  }

  const walk = (el) => {
    for (let n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        const data = n.data
        const cps = []
        for (let i = 0; i < data.length; i++) {
          const c = data[i]
          cps.push(chars.length + (pendingSpace && !WS.test(c) ? 1 : 0))
          if (WS.test(c)) {
            emitSpace()
            continue
          }
          if (pendingSpace) {
            chars.push(' ')
            nodes.push(n)
            offs.push(i)
            pendingSpace = false
          }
          chars.push(c)
          nodes.push(n)
          offs.push(i)
        }
        cps.push(chars.length)
        starts.set(n, cps)
      } else if (n.nodeType === 1) {
        if (n.matches?.(SKIP)) continue
        const block = BLOCK.has(n.tagName)
        if (block) emitSpace()
        walk(n)
        if (block) emitSpace()
      }
    }
  }
  walk(root)
  const text = chars.join('')

  function offsetOf(node, offset) {
    if (!root.contains(node)) return -1
    if (node.nodeType === 3) {
      const cps = starts.get(node)
      if (!cps) return -1
      return Math.min(cps[Math.max(0, Math.min(offset, cps.length - 1))], text.length)
    }
    // element point: the first text at or after child[offset]
    const doc = root.ownerDocument
    const walker = doc.createTreeWalker(root, 4)
    const probe = doc.createRange()
    probe.setStart(node, offset)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const r = doc.createRange()
      r.selectNodeContents(t)
      if (r.compareBoundaryPoints(0 /* START_TO_START */, probe) >= 0 && starts.has(t)) return starts.get(t)[0]
    }
    return text.length
  }

  function rangeFor(start, end) {
    let s = start
    let e = end - 1
    while (s < e && chars[s] === ' ') s++
    while (e > s && chars[e] === ' ') e--
    if (s > e || s < 0 || e >= chars.length) return null
    const r = root.ownerDocument.createRange()
    r.setStart(nodes[s], offs[s])
    r.setEnd(nodes[e], offs[e] + 1)
    return r
  }

  return { text, offsetOf, rangeFor }
}
