# Architecture

Diple Docs has a desktop half and a Python half, plus two shared packages bundled into it: a pure core and a small desktop kit. It talks to [Diple](https://github.com/waiclay-349687/hermes-diple) only through plugin events.

```text
Hermes Desktop (renderer)                       Hermes backend (Python)
┌────────────────────────────────┐              ┌───────────────────────────────────┐
│ plugin.js                      │   ctx.rest   │ python/ (plugin backend)          │
│  review/  document page, list, │ ───────────▶ │  dashboard/plugin_api.py  routes  │
│           editor, status bar,  │ ◀─────────── │  store.py  safe file reading,     │
│           marks, doc store,    │   plugin     │            SQLite (lists, recent, │
│           hand-off sender      │   events     │            hand-offs, settings)   │
│  shared/  REST client, i18n,   │              │  __init__.py  hooks: the "Open in │
│           settings             │              │            Diple Docs" card       │
└────────────────────────────────┘              └───────────────────────────────────┘
          ▲ bundled in                                  │ plugin.diple-docs.handoff
┌────────────────────────────────┐ ┌──────────────────┐ ▼ (broadcast to every window)
│ packages/core (pure logic)     │ │ desktop-kit      │ ┌───────────────────────────────┐
│  anchor  handoff-protocol      │ │ locales, i18n,   │ │ Diple — the chat plugin       │
│  copy-text  mark-look  ...     │ │ settings, menus  │ │  receipts, settled, batch.*   │
└────────────────────────────────┘ └──────────────────┘ └───────────────────────────────┘
```

## Desktop plugin (`plugins/diple-docs/desktop/src`)

- `review/index.js` — registration: the document tab, the command-palette entries, keybinds, the settings page, the transcript card for `::diple-docs{path=…}`, the recent-documents page, and the hand-off sender shared by all pages.
- `review/page.jsx` — one document page: toolbar, Rendered / Source view, selections, the draft, the floating editor (`float-editor.jsx`, placed by `float.js`), and the list in one of three layouts (`list-panel.js`: open beside the document, collapsed to the margin status bar `rail.jsx`, or a bottom bar on narrow pages; `placement.js` opens the tab where the host preview opens).
- `review/list.jsx` — the annotation list: filters, cards, the **⋯** bulk menu (`bulk.js`, with undo) and the send menu.
- `review/doc-store.js` — the file and its annotations: polling, reloading, re-anchoring after a change (`locate.js`, over core `anchor`), and optimistic writes with conflict detection.
- `review/md-map.js`, `dom-text.js`, `pick.js` — mapping a selection in the rendered view back to the Markdown source, and refusing when it is not reliable.
- `review/marks.js`, `highlights.js` — the marks on the original (CSS Custom Highlight API), with the same looks as Diple (core `MarkLook`).
- `review/handoff.js` — the sender side of the hand-off protocol: an adapter (timers, backend, notifications) over the shared state machine `Handoff.senderStep`.

Only `@hermes/plugin-sdk`, `react` and `react/jsx-runtime` are imported at runtime; everything else is bundled by esbuild (`scripts/build.mjs`). The export that produces this repository checks that every import resolves inside it.

## Shared packages

- `packages/core` — pure functions without DOM or host access: `anchor.js` (remember a passage, find it again after edits, never guess on ties), `handoff-protocol.js` (the hand-off state machines, with a Python twin checked against the same case files), `copy-text.js`, `mark-look.js`, `send-request.js` and the envelope used by Diple.
- `packages/desktop-kit` — the locale list and runtime, `dir` on the plugin's roots, the settings store, the resize handle and the send menu.

Both packages are also in Diple's repository, as independent copies: the two plugins share nothing at run time.

## Python backend (`plugins/diple-docs/python`)

- `store.py` — safe reading of a user-chosen Markdown file (realpath, suffix, size and encoding checks, protected locations, a no-follow walk with descriptor checks); the per-file annotation lists in SQLite through the host's `plugin_db` (`<hermes home>/plugin-data/diple-docs/data.db`), with a mutation counter per item for conflicts; recent documents; hand-off records and their settled results; the settings the hooks need.
- `dashboard/plugin_api.py` — REST routes under `/api/plugins/diple-docs/` used by the desktop half; `POST /handoffs` stores a hand-off and broadcasts it.
- `__init__.py` — `post_tool_call` records the `.md` files a turn wrote; `transform_llm_output` appends the “Open in Diple Docs” card to the answer.

## The hand-off to Diple

1. **Send** posts the hand-off (items with their origin: plugin, item id, revision, path, line) to this plugin's backend, which stores it and broadcasts `plugin.diple-docs.handoff`.
2. Diple, in every window, receives it; the window that owns the target session claims it, adds the items to that session's pending list (or submits them), and answers with `plugin.diple.handoff.receipt`.
3. The final word is `plugin.diple.handoff.settled` (delivered or not, per item). Until then the sender polls its backend and rebroadcasts on a backoff so a receiver can replay its result; nothing is ever run twice.

No answer within 3 seconds means “not confirmed”, not “not sent”: see [known limitations](known-limitations.md).

## Decisions

The reasons behind these choices are in the [ADRs](adr/README.md): one action for highlight and comment (0001), a per-file annotation list (0003), two plugins talking through plugin events (0004), plugin SQLite (0005), the hand-off state machines (0007), the names (0008), the desktop kit (0009), and the document page's layouts, placement and bulk actions (0012–0014).
