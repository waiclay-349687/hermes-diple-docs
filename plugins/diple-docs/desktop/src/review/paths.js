// THE suffix rule on the desktop side (XR1-09); the backend's is_review_path
// is the authority, this mirrors it so the UI can refuse early.
export const REVIEW_SUFFIXES = ['.md', '.markdown']

export function isReviewPath(path) {
  return typeof path === 'string' && REVIEW_SUFFIXES.some((s) => path.toLowerCase().endsWith(s))
}

export function isAbsolutePath(path) {
  return typeof path === 'string' && /^(\/|~\/|[A-Za-z]:[\\/]|\\\\)/.test(path)
}
