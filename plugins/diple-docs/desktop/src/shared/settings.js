// Settings of Diple Docs.
//   language  — 'auto' | one of LOCALE_IDS (@diple/desktop-kit)
//   autoCard  — append the "open review" card after the AI writes a .md file

import { createSettingsStore, LANGUAGE_SETTINGS } from '@diple/desktop-kit'

export function normalizeSettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  return {
    language: LANGUAGE_SETTINGS.includes(s.language) ? s.language : 'auto',
    autoCard: typeof s.autoCard === 'boolean' ? s.autoCard : true
  }
}

/** Diple Docs settings: the shared store with these rules. */
export const createSettings = (storage) => createSettingsStore(storage, normalizeSettings)
