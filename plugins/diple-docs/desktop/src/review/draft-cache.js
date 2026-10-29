// draft-cache: the unsaved words of one file, kept in ctx.storage until they are
// written or explicitly dropped (R11 XR11-05). Never the database: a draft is not
// an item. R11-H: one SLOT per draft session (its draftId), so two drafts of one
// file — the restore bar's and the one being written — never share an entry
// (XR11b-05), and a clear after an answer is a compare-and-clear: it removes the
// slot only if that slot is still the one the operation was about.
//
//   const cache = createDraftCache(storage, path)
//   cache.list()                → slots, newest first
//   cache.get(draftId)          → slot | null
//   cache.write(slot)           by slot.draftId; a blank draft removes its slot
//   cache.remove(draftId)       an explicit 放弃 of that slot (no other)
//   cache.clearIf(draftId, ok)  removes the slot only if ok(slot) → true / false
//
// A slot is one of
//   { kind: 'draft', draftId, anchor, words, sig, anchorVersion, textVersion, at }
//        not saved yet; anchor (Anchor.makeAnchor) + sig relocate it on reopen
//   { kind: 'pending-edit', draftId, itemId, baseMutation, text, textVersion, at }
//        the draft WAS saved while the user typed on (XR11b-04): the words typed
//        meanwhile are an unsaved edit of item itemId, kept until that edit is
//        written or dropped (Esc / ×)
// The R11-F single entry ({ anchor, words, sig }) still reads, as one 'draft' slot.

export const draftKey = (path) => `draft:${path}`
export const LEGACY_ID = 'legacy'

const str = (v) => (typeof v === 'string' ? v : '')
const validSlot = (s) => {
  if (!s || typeof s !== 'object' || typeof s.draftId !== 'string' || !s.draftId) return false
  if (s.kind === 'pending-edit') return typeof s.itemId === 'string' && Boolean(s.itemId) && typeof s.text === 'string'
  return s.kind === 'draft' && Boolean(str(s.words).trim()) && Boolean(str(s.anchor?.text))
}

export function createDraftCache(storage, path, now = () => Date.now()) {
  const key = draftKey(path)
  const load = () => {
    let v = null
    try {
      v = storage?.get?.(key, null)
    } catch {
      return {}
    }
    if (!v || typeof v !== 'object') return {}
    if (v.slots && typeof v.slots === 'object') return Object.fromEntries(Object.entries(v.slots).filter(([id, s]) => validSlot(s) && s.draftId === id))
    const legacy = { kind: 'draft', draftId: LEGACY_ID, anchor: v.anchor, words: v.words, sig: v.sig ?? null, anchorVersion: 0, textVersion: 0, at: v.at ?? 0 }
    return validSlot(legacy) ? { [LEGACY_ID]: legacy } : {}
  }
  const save = (slots) => {
    try {
      if (Object.keys(slots).length) storage?.set?.(key, { v: 2, slots })
      else if (typeof storage?.remove === 'function') storage.remove(key)
      else storage?.set?.(key, null)
    } catch {}
  }
  const remove = (draftId) => {
    const slots = load()
    if (!(draftId in slots)) return false
    delete slots[draftId]
    save(slots)
    return true
  }
  return {
    list: () => Object.values(load()).sort((a, b) => (b.at ?? 0) - (a.at ?? 0)),
    get: (draftId) => load()[draftId] ?? null,
    write(slot) {
      if (!slot?.draftId) return
      const next = { ...slot, at: now() }
      if (!validSlot(next)) return void remove(slot.draftId)
      const slots = load()
      slots[slot.draftId] = next
      save(slots)
    },
    remove,
    clearIf(draftId, ok) {
      const s = load()[draftId]
      return s && ok?.(s) ? remove(draftId) : false
    }
  }
}
