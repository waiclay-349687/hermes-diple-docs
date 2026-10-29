// Diple Docs — desktop half. Entry point (W1-owned skeleton; W2c owns review/).
//
// deps = { api, settings, i18n }
// Read-only reviewer: the plugin never writes a document and never writes
// files next to one; its data lives in the plugin SQLite (ADR 0005).
// Talks to the Diple plugin only through plugin events (ADR 0004):
//   emits   plugin.diple-docs.handoff          (via POST /handoffs on its own backend)
//   listens plugin.diple.handoff.receipt / batch.sent / batch.answered

import { createApi } from './shared/api.js'
import { createI18n, PLUGIN_ID } from './shared/i18n.js'
import { createSettings } from './shared/settings.js'
import { installReview } from './review/index.js'

export default {
  id: PLUGIN_ID,
  name: 'Diple Docs · 圈批·文档', // i18n-allow: the host shows plugin names untranslated
  description: 'Review .md documents with annotations and send them through the Diple plugin.',
  register(ctx) {
    const settings = createSettings(ctx.storage)
    const deps = {
      api: createApi((path, opts) => ctx.rest(path, opts)),
      settings,
      i18n: createI18n(ctx, settings)
    }
    installReview(ctx, deps)
  }
}
