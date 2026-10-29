# Contributing

Thanks for your interest. This is a small hobby project; issues with a clear reproduction or a concrete use case help most. For a larger change, please open an issue first.

## Layout

| Path | What |
| --- | --- |
| `packages/core/` | Pure shared logic: anchors (finding a passage again after edits), the hand-off protocol, copy formats, mark looks. No DOM, no host. Shared with [Diple](https://github.com/waiclay-349687/hermes-diple). |
| `packages/desktop-kit/` | Locales, the language runtime and the settings store, shared with Diple. |
| `plugins/diple-docs/desktop/src/` | The desktop plugin (bundled into one `plugin.js`). Imports only `@hermes/plugin-sdk`, `react`, `react/jsx-runtime`. |
| `plugins/diple-docs/python/` | The Python backend: safe file reading, the per-file annotation lists in SQLite, the hand-off records, REST routes (`dashboard/plugin_api.py`), and the hooks for the “Open in Diple Docs” card. |
| `tests/desktop/` | jsdom tests that drive the plugin from `register(ctx)` against an SDK stub. |
| `tests/python/` | pytest for the backend (temp `HERMES_HOME`, never your real one). |
| `docs/adr/` | Architecture decision records (Chinese). |

## Build and test

```bash
npm install
npm test          # core + desktop tests (node --test)
npm run test:ci   # the same, one file at a time (what CI runs; avoids a timing flake)
npm run build     # → dist/diple-docs/plugin.js
npm run test:py   # Python backend tests
```

Requirements: Node.js 22+, and for the Python tests a Hermes Agent checkout plus Python 3.11. The backend imports a few host modules (`hermes_constants`, `plugins.plugin_storage`, `hermes_cli.plugin_events`, `agent.file_safety`, `hermes_state` for conversation titles), so `scripts/pytest.sh` puts the checkout on `PYTHONPATH`:

- default: `~/.hermes/hermes-agent` and its venv (read only; pytest is installed into `tests/.pydeps`, not into the venv);
- otherwise: `HERMES_AGENT_ROOT=<checkout> PYTHON=<python with fastapi, httpx, pyyaml, ruamel.yaml, pytest> npm run test:py`.

CI does the second: it checks out Hermes Agent at the tested commit (`bf0203a`) and runs the whole Python suite.

Install into a Hermes home for manual testing (always pass `--home`; the script never guesses one):

```bash
node scripts/install.mjs --home <hermes home> --no-enable
hermes plugins enable diple-docs
```

To try sending, install [Diple](https://github.com/waiclay-349687/hermes-diple) into the same Hermes home.

## The two repositories

Diple Docs and Diple are developed together in one private monorepo and exported into two public repositories. The shared packages (`packages/core`, `packages/desktop-kit`) are copied into both; a change to them is released in both repositories.

Tests are split by what they load: a test that uses only this plugin (and the shared packages) is here, one that uses only Diple is in its repository, and the shared-package tests are in both. The tests that load both plugins at once stay in the private monorepo: `tests/desktop/handoff-r3.test.mjs`, `tests/desktop/handoff-r4.test.mjs`, `tests/desktop/handoff-r5.test.mjs`, `tests/desktop/v2x-marks-docs.test.mjs`. The protocol between the two plugins is still covered here, from this side, by `packages/core/test/handoff-*.test.mjs`, `tests/desktop/handoff-r6.test.mjs` and `tests/python/test_handoff_r6.py`, and the receiving side by Diple's own tests. Real-app end-to-end scripts (an isolated Hermes Desktop sandbox driven over CDP) are not published.

## Conventions

- Sources may use JSX; esbuild bundles them into one plain ESM `plugin.js`. No hard-coded colors (theme variables only).
- UI strings live in `messages.js` and `locales/*.js`; every key must exist in every language (a test enforces it).
- While an IME is composing, Enter never submits.
- The plugin never writes a document, and never writes files next to one.
- Every user-visible change goes into `CHANGELOG.md` under **Unreleased**, and the README, ROADMAP and issues are kept in step with each push.
