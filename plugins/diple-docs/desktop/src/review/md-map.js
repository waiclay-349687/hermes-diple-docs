// md-map: line up what the reader sees in the rendered (排版) view with the
// Markdown source, so an annotation picked in either view gets the same source
// range — and a source range can be painted back onto the rendered view.
//
// Interface (pure, no DOM):
//   project(src)                       → { plain, map }   rendered-like text of the source;
//                                                         map[i] = source offset of plain[i]
//   normalize(text)                    → whitespace collapsed to single spaces, trimmed
//   toSource(src, picked, at)          → { start, end } | null
//        picked: normalized text the reader selected; at: { index, total, occurrence, count }
//        describes where it sat in the rendered text (see pickOccurrence).
//   toRendered(src, start, end)        → { text, occurrence, count, ratio } | null
//   pickOccurrence(hits, want)         → index into hits, or -1
//
// The projection strips Markdown syntax (block markers, emphasis, code span
// delimiters, link destinations, HTML tags, entities, table pipes) the way
// the renderer drops it from the visible text. It is deliberately
// conservative: when a phrase cannot be matched exactly, toSource returns
// null and the caller asks the reader to pick in the source view instead of
// guessing a place.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
const PUNCT = /[!-/:-@[-`{-~]/
const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\u00a0'
const isWord = (c) => c !== undefined && /[\p{L}\p{N}]/u.test(c)

export function normalize(text) {
  return String(text ?? '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
}

class Out {
  constructor() {
    this.chars = []
    this.map = []
  }
  push(ch, at) {
    if (isSpace(ch)) return this.space(at)
    this.chars.push(ch)
    this.map.push(at)
  }
  space(at) {
    if (this.chars.length && this.chars[this.chars.length - 1] !== ' ') {
      this.chars.push(' ')
      this.map.push(at)
    }
  }
  done() {
    while (this.chars.length && this.chars[this.chars.length - 1] === ' ') {
      this.chars.pop()
      this.map.pop()
    }
    return { plain: this.chars.join(''), map: this.map }
  }
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
const THEMATIC = /^ {0,3}([-*_])( *\1){2,} *$/
const SETEXT = /^ {0,3}(=+|-+) *$/
const TABLE_DELIM = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/

/** Length of the block-syntax prefix of a line (indent, >, list marker, task box, heading #). */
function blockPrefix(line) {
  let i = 0
  for (;;) {
    const rest = line.slice(i)
    let m
    if ((m = rest.match(/^ {0,3}> ?/))) i += m[0].length
    else if ((m = rest.match(/^ {0,3}(?:[-*+]|\d{1,9}[.)])(?: +|$)/))) {
      i += m[0].length
      const box = line.slice(i).match(/^\[[ xX]\] +/)
      if (box) i += box[0].length
    } else if ((m = rest.match(/^ {0,3}#{1,6}(?: +|$)/))) {
      i += m[0].length
      return i
    } else return i + (rest.match(/^ {0,3}/)?.[0].length ?? 0)
  }
}

/** Inline pass over one line segment [from, to) of src. */
function inline(src, from, to, out, { table }) {
  let i = from
  // closing positions of link texts: index of ']' → index after the destination
  const linkEnds = new Map()
  // heading closing #s
  while (i < to) {
    const c = src[i]
    if (c === '\\' && i + 1 < to && PUNCT.test(src[i + 1])) {
      out.push(src[i + 1], i + 1)
      i += 2
      continue
    }
    if (c === '`') {
      let n = 0
      while (src[i + n] === '`') n++
      const close = src.indexOf('`'.repeat(n), i + n)
      if (close !== -1 && close < to && src[close + n] !== '`') {
        let s = i + n
        let e = close
        if (src[s] === ' ' && src[e - 1] === ' ' && e - s > 1) {
          s++
          e--
        }
        for (let k = s; k < e; k++) out.push(src[k], k)
        i = close + n
        continue
      }
      for (let k = 0; k < n; k++) out.push('`', i + k)
      i += n
      continue
    }
    if (linkEnds.has(i)) {
      i = linkEnds.get(i)
      continue
    }
    if (c === '!' && src[i + 1] === '[') {
      i++
      continue
    }
    if (c === '[') {
      const end = linkTarget(src, i, to)
      if (end) {
        linkEnds.set(end.close, end.after)
        i++
        continue
      }
      // footnote reference [^x] renders as a superscript label
      const fn = src.slice(i, to).match(/^\[\^([^\]\s]+)\]/)
      if (fn) {
        for (let k = 0; k < fn[1].length; k++) out.push(fn[1][k], i + 2 + k)
        i += fn[0].length
        continue
      }
    }
    if (c === '<') {
      const rest = src.slice(i, to)
      const auto = rest.match(/^<((?:https?|mailto|ftp):[^\s<>]*)>/i) || rest.match(/^<([^\s<>@]+@[^\s<>]+)>/)
      if (auto) {
        for (let k = 0; k < auto[1].length; k++) out.push(auto[1][k], i + 1 + k)
        i += auto[0].length
        continue
      }
      const tag = rest.match(/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/) || rest.match(/^<!--[\s\S]*?-->/)
      if (tag) {
        out.space(i)
        i += tag[0].length
        continue
      }
    }
    if (c === '&') {
      const ent = src.slice(i, Math.min(to, i + 10)).match(/^&(#?[A-Za-z0-9]+);/)
      if (ent) {
        const key = ent[1].toLowerCase()
        let ch = ENTITIES[key]
        if (!ch && /^#\d+$/.test(key)) ch = codePoint(Number(key.slice(1)))
        if (!ch && /^#x[0-9a-f]+$/.test(key)) ch = codePoint(parseInt(key.slice(2), 16))
        if (ch) {
          out.push(ch, i)
          i += ent[0].length
          continue
        }
      }
    }
    if (c === '*' || c === '_' || c === '~') {
      let n = 0
      while (src[i + n] === c) n++
      const prev = i > from ? src[i - 1] : ' '
      const next = i + n < to ? src[i + n] : ' '
      const literal =
        (isSpace(prev) && isSpace(next)) || (c === '_' && isWord(prev) && isWord(next)) || (c === '~' && n === 1)
      if (literal) for (let k = 0; k < n; k++) out.push(c, i + k)
      i += n
      continue
    }
    if (c === '|' && table) {
      out.space(i)
      i++
      continue
    }
    out.push(c, i)
    i++
  }
}

/** For a '[' at i: the matching ']' and the end of its (destination) or [ref], if it is a link. */
function linkTarget(src, i, to) {
  let depth = 0
  for (let k = i; k < to; k++) {
    const c = src[k]
    if (c === '\\') {
      k++
      continue
    }
    if (c === '`') return null
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) {
        if (src[k + 1] === '(') {
          let d = 0
          for (let j = k + 1; j < to; j++) {
            if (src[j] === '\\') {
              j++
              continue
            }
            if (src[j] === '(') d++
            else if (src[j] === ')' && --d === 0) return { close: k, after: j + 1 }
          }
          return null
        }
        if (src[k + 1] === '[') {
          const e = src.indexOf(']', k + 2)
          if (e !== -1 && e < to) return { close: k, after: e + 1 }
        }
        return null
      }
    }
  }
  return null
}

let cache = { src: null, value: null }

/** project() for the same source twice in a row is computed once (paint + pick on one document). */
/** A numeric character reference as CommonMark renders it: invalid → U+FFFD, never throws (XR-07). */
function codePoint(n) {
  if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\uFFFD'
  return String.fromCodePoint(n)
}

export function project(src) {
  const text = String(src ?? '')
  if (cache.src === text) return cache.value
  const value = projectUncached(text)
  cache = { src: text, value }
  return value
}

/** Display form of a Markdown snippet (syntax dropped, whitespace collapsed); not cached. */
export function plainText(src) {
  return projectUncached(String(src ?? '')).plain
}

function projectUncached(text) {
  const out = new Out()
  const lines = []
  for (let s = 0; s <= text.length; ) {
    const nl = text.indexOf('\n', s)
    const e = nl === -1 ? text.length : nl
    lines.push([s, e])
    if (nl === -1) break
    s = nl + 1
  }
  let fence = null
  let inTable = false
  for (let li = 0; li < lines.length; li++) {
    const [s, e] = lines[li]
    const line = text.slice(s, e).replace(/\r$/, '')
    if (fence) {
      const close = line.match(FENCE)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && !line.slice(close[0].length).trim()) {
        fence = null
        out.space(s)
        continue
      }
      for (let k = 0; k < line.length; k++) out.push(line[k], s + k)
      out.space(e)
      continue
    }
    const open = line.match(FENCE)
    if (open && !(open[1][0] === '`' && line.slice(open[0].length).includes('`'))) {
      fence = open[1]
      out.space(s)
      continue
    }
    const next = lines[li + 1] ? text.slice(lines[li + 1][0], lines[li + 1][1]) : ''
    if (TABLE_DELIM.test(line) && line.includes('-') && (line.includes('|') || inTable)) {
      inTable = true
      out.space(s)
      continue
    }
    if (!line.trim()) {
      inTable = false
      out.space(s)
      continue
    }
    if (THEMATIC.test(line) || (SETEXT.test(line) && li > 0 && text.slice(lines[li - 1][0], lines[li - 1][1]).trim())) {
      out.space(s)
      continue
    }
    const table = inTable || (line.includes('|') && TABLE_DELIM.test(next) && next.includes('-'))
    let from = s + blockPrefix(line)
    let to = e
    // closing sequence of an ATX heading: "## Title ##"
    if (/^ {0,3}#{1,6}( |$)/.test(line)) {
      const m = text.slice(from, to).match(/(?:^| +)#+ *$/)
      if (m) to -= m[0].length
    }
    if (table) {
      const lead = text.slice(from, to).match(/^ *\|/)
      if (lead) from += lead[0].length
    }
    inline(text, from, to, out, { table })
    out.space(e)
  }
  return out.done()
}

function hitsOf(hay, needle) {
  const hits = []
  if (!needle) return hits
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) hits.push(i)
  return hits
}

/**
 * Choose among hits the one that corresponds to `want` = { occurrence, count, ratio }:
 * the same occurrence number when both sides see the same number of hits,
 * else the hit closest to the same relative position.
 */
export function pickOccurrence(hits, want, length) {
  if (!hits.length) return -1
  if (hits.length === 1) return 0
  if (want.count === hits.length && want.occurrence < hits.length) return want.occurrence
  let best = -1
  let bestD = Infinity
  for (let k = 0; k < hits.length; k++) {
    const d = Math.abs(hits[k] / Math.max(1, length) - want.ratio)
    if (d < bestD) {
      bestD = d
      best = k
    }
  }
  return best
}

/** Where `picked` (normalized) sits inside `hay` (normalized) given its start index there. */
export function describe(hay, picked, index) {
  const hits = hitsOf(hay, picked)
  const occurrence = Math.max(0, hits.indexOf(index))
  return { occurrence, count: hits.length, ratio: index / Math.max(1, hay.length) }
}

export function toSource(src, picked, at) {
  const needle = normalize(picked)
  if (!needle) return null
  const { plain, map } = project(src)
  const hits = hitsOf(plain, needle)
  const k = pickOccurrence(hits, at ?? { occurrence: 0, count: hits.length, ratio: 0 }, plain.length)
  if (k < 0) return null
  const ps = hits[k]
  const pe = ps + needle.length
  return { start: map[ps], end: map[pe - 1] + 1 }
}

export function toRendered(src, start, end) {
  const { plain, map } = project(src)
  let ps = -1
  let pe = -1
  for (let i = 0; i < map.length; i++) {
    if (ps === -1 && map[i] >= start && map[i] < end && plain[i] !== ' ') ps = i
    if (map[i] >= start && map[i] < end && plain[i] !== ' ') pe = i + 1
    if (map[i] >= end) break
  }
  if (ps === -1) return null
  const text = plain.slice(ps, pe)
  return { text, ...describe(plain, text, ps) }
}
