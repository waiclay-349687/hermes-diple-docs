// i18n of Diple Docs: its message bundles and its id, run by the shared
// locale runtime (@diple/desktop-kit createLocaleRuntime — app locale or a
// pinned one, en fallback, `dir` on the plugin's roots, the AI-facing language).
//
//   const i18n = createI18n(ctx, settings)
//   i18n.t(key, ...args)    → string (non-React code)
//   i18n.useT()             → t, re-rendering on app-locale or pin change
//   i18n.locale()           → the effective UI locale (one of LOCALE_IDS)
//   i18n.useLocale()        → the same, reactive (for `dir` on plugin roots)
//   i18n.envelopeLang()     → 'zh' | 'en' (zh, zh-hant → zh; others → en)
//   i18n.lang()             → alias of envelopeLang()
//
// Keys are namespaced by module: common.*, review.*.
// zh and en live in each module's messages.js; the other locales live in
// ../locales/<id>.js, and a key missing there falls back to en.

import { createLocaleRuntime, mergeBundles, messageKeys, translateIn } from '@diple/desktop-kit'

import common from './messages.js'
import review from '../review/messages.js'
import { EXTRA_LOCALES } from '../locales/index.js'

export { LOCALE_IDS, LOCALE_NAMES, dirOf, envelopeLangOf } from '@diple/desktop-kit'
export { mergeBundles, messageKeys }

export const PLUGIN_ID = 'diple-docs'
export const BUNDLES = { common, review }
export const LOCALES = mergeBundles(BUNDLES, EXTRA_LOCALES)
const ROOTS = '.er-page, [data-diple-docs-settings], [data-diple-docs-card]'

export const translateWith = (locale, key, args = []) => translateIn(LOCALES, locale, key, args)

export const createI18n = (ctx, settings) => createLocaleRuntime(ctx, settings, { pluginId: PLUGIN_ID, locales: LOCALES, roots: ROOTS })
