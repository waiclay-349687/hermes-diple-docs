// locate: the way back from a card to the original words (V2 design §6, research §4.1).
//
//   scrollPlan({ rect, box, scrollTop, reduced }) → null | { top, behavior }
//     rect: the words' client rect; box: the scroll container's client rect.
//     Already comfortably in view → null (no scroll: one jump less for the eye).
//     Otherwise centre the words, smoothly; reduced motion jumps ('auto').
//     Words taller than the view put their first line near the top instead.
//   prefersReducedMotion(win?) → boolean

export const MARGIN = 24

export function scrollPlan({ rect, box, scrollTop = 0, reduced = false }) {
  if (!rect || !box) return null
  const height = box.height ?? box.bottom - box.top
  if (rect.top >= box.top + MARGIN && rect.bottom <= box.bottom - MARGIN) return null
  const tall = rect.bottom - rect.top > height - 2 * MARGIN
  const target = tall
    ? scrollTop + rect.top - box.top - MARGIN
    : scrollTop + (rect.top + rect.bottom) / 2 - (box.top + height / 2)
  return { top: Math.max(0, Math.round(target)), behavior: reduced ? 'auto' : 'smooth' }
}

export function prefersReducedMotion(win = typeof window !== 'undefined' ? window : undefined) {
  try {
    return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
  } catch {
    return false
  }
}
