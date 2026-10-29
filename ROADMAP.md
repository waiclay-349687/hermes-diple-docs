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
| “Suggested edit” annotations: the comment is the replacement text, sent next to the passage | designing | _(issue not filed yet)_ |
| A baseline at send time and a diff on the card: what the AI changed in the passage | designing | _(issue not filed yet)_ |
| Resolve a suggested edit by code when the file now contains it, with undo | designing | _(issue not filed yet)_ |
| The AI's response shown under each annotation, with a per-batch summary | designing | _(issue not filed yet)_ |
| Four optional intents for a comment: question, disagree, change this, unsure (together with Diple) | designing | _(issue not filed yet)_ |

## Later

| Item | Status | Issue |
| --- | --- | --- |
| A “to confirm” group: answered annotations whose passage changed, confirmed in one pass | planned | — |
| Recognise a renamed or moved file and offer to carry its list over | planned | _(issue not filed yet)_ |
| Wider mapping of Rendered-view selections (tables, raw HTML, footnotes) | planned | _(issue not filed yet)_ |
| A cancel message in the hand-off protocol, so a timed-out hand-off can be recalled (both plugins) | planned | _(issue not filed yet)_ |
| Files with several hard links, and Windows | discussing | _(issue not filed yet)_ |

## Blocked

Waiting for an extension point or API from Hermes Desktop.

| Item | Status | Issue |
| --- | --- | --- |
| “New conversation” as a send target, once the SDK can create a session and return its id (`newChat()` only opens a draft today) | blocked | _(issue not filed yet)_ |
| Right-click “Annotate” on the document page, once Hermes Desktop offers a context-menu extension point for plugins | blocked | _(issue not filed yet)_ |
| A reliable “Open in Diple Docs” card next to other plugins that rewrite answers (the host keeps only the first rewrite) | blocked | _(issue not filed yet)_ |
| Document tabs that the app itself restores (today the plugin reopens them, within 24 hours) | blocked | — |

## Internal design debt

No user-visible change; done when a change touches the area anyway.

| Item | Status | Issue |
| --- | --- | --- |
| Document selections: one projection that converts both ways between the rendered text and the Markdown source | planned | — |
| Backend: a safe-read module separate from the SQLite lifecycle | planned | — |
| One interface for a document's session and lifecycle | planned | — |
