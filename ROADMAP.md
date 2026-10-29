# Roadmap

This file and the [issues](https://github.com/waiclay-349687/hermes-diple-docs/issues) are how the project is tracked. Both are updated with every push to this repository.

Status words: **in progress**, **planned**, **designing** (being shaped, discussion welcome, nothing built yet), **discussing** (no decision yet), **blocked** (waits for the host), **tracking** (an upstream change we follow).

What has already shipped is in [CHANGELOG.md](CHANGELOG.md). The chat side of the family has its own roadmap: [Diple's ROADMAP](https://github.com/waiclay-349687/hermes-diple/blob/main/ROADMAP.md).

## Now

Being built for the next version, after v0.1.0.

Nothing is being built right now; the next pick comes from the list below.

## Next

| Item | Status | Issue |
| --- | --- | --- |
| “Suggested edit” annotations: the comment is the replacement text, sent next to the passage | designing | [#1](https://github.com/waiclay-349687/hermes-diple-docs/issues/1) |
| A baseline at send time and a diff on the card: what the AI changed in the passage | designing | [#2](https://github.com/waiclay-349687/hermes-diple-docs/issues/2) |
| Resolve a suggested edit by code when the file now contains it, with undo | designing | [#3](https://github.com/waiclay-349687/hermes-diple-docs/issues/3) |
| The AI's response shown under each annotation, with a per-batch summary | designing | [#4](https://github.com/waiclay-349687/hermes-diple-docs/issues/4) |
| Four optional intents for a comment: question, disagree, change this, unsure (together with Diple) | designing | [#5](https://github.com/waiclay-349687/hermes-diple-docs/issues/5) |

## Later

| Item | Status | Issue |
| --- | --- | --- |
| A “to confirm” group: answered annotations whose passage changed, confirmed in one pass | planned | — |
| Recognise a renamed or moved file and offer to carry its list over | planned | [#10](https://github.com/waiclay-349687/hermes-diple-docs/issues/10) |
| Wider mapping of Rendered-view selections (tables, raw HTML, footnotes) | planned | [#9](https://github.com/waiclay-349687/hermes-diple-docs/issues/9) |
| A cancel message in the hand-off protocol, so a timed-out hand-off can be recalled (both plugins) | planned | [#12](https://github.com/waiclay-349687/hermes-diple-docs/issues/12) |
| Files with several hard links, and Windows | discussing | [#11](https://github.com/waiclay-349687/hermes-diple-docs/issues/11) |

## Blocked

Waiting for an extension point or API from Hermes Desktop.

| Item | Status | Issue |
| --- | --- | --- |
| “New conversation” as a send target, once the SDK can create a session and return its id (`newChat()` only opens a draft today) | blocked | [#6](https://github.com/waiclay-349687/hermes-diple-docs/issues/6) |
| Right-click “Annotate” on the document page, once Hermes Desktop offers a context-menu extension point for plugins | blocked | [#7](https://github.com/waiclay-349687/hermes-diple-docs/issues/7) |
| A reliable “Open in Diple Docs” card next to other plugins that rewrite answers (the host keeps only the first rewrite) | blocked | [#8](https://github.com/waiclay-349687/hermes-diple-docs/issues/8) |
| Document tabs that the app itself restores (today the plugin reopens them, within 24 hours) | blocked | — |

## Internal design debt

No user-visible change; done when a change touches the area anyway.

| Item | Status | Issue |
| --- | --- | --- |
| Document selections: one projection that converts both ways between the rendered text and the Markdown source | planned | — |
| Backend: a safe-read module separate from the SQLite lifecycle | planned | — |
| One interface for a document's session and lifecycle | planned | — |
