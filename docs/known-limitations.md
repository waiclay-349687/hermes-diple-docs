# Known limitations

Each entry says what happens, why, and what would remove it. Most come from host facts a plugin cannot change. Entries with an issue link are tracked there. The chat side has its own list: [Diple's known limitations](https://github.com/waiclay-349687/hermes-diple/blob/main/docs/known-limitations.md).

## Sending needs Diple

Diple Docs does not send anything to the AI itself: it hands annotations to [Diple](https://github.com/waiclay-349687/hermes-diple) through plugin events.

- **Without Diple**: the first send waits 3 seconds for a receipt, then the page shows a banner (“Diple is not responding”) and turns off the send targets that need it. Opening, annotating, the list, resolving, the status bar, **Copy for AI** (the **Send N ▾** menu still opens) and **Copy all as Markdown** (in the **⋯** menu) keep working.
- **Diple turned off** for annotation in the app: the banner shows at once.
- After installing or enabling Diple, click **Check again** on the banner.

## Timed-out hand-offs

When Diple does not confirm a hand-off within 3 seconds, the page says it was **not confirmed** — not that nothing was sent. Diple has no cancel channel, so the hand-off cannot be recalled; the page only stops rebroadcasting it.

- A receipt that arrives later is announced in the window that sent it; after a reload the announcement is gone, but the list shows the right state.
- Annotations from a hand-off that timed out in the last 10 minutes ask before being sent again (**Send anyway** replays the old hand-off; only if there is nothing to replay is a new one offered, after a second confirmation).
- The “waiting for confirmation” timers live in the sending window. A correction that arrives more than about 11 minutes later only changes the list's state. _(issue not filed yet)_

## The send target

The target is always an existing conversation: the current one or a recent one. “New conversation” is not offered, because the SDK's `newChat()` returns no session id. _(issue not filed yet)_

## The “Open in Diple Docs” card

The card is added by the `transform_llm_output` hook. The host calls every plugin's hook but keeps only the **first non-empty** result, and the order is the plugin folders' name order (not the order in `plugins.enabled`). A plugin that sorts before `diple-docs` and rewrites answers makes the card disappear; one that sorts after it loses its own rewrite. Every `.md` file the AI writes is also added to Recent documents, so it can be opened from the command palette. _(issue not filed yet)_

## <kbd>⌘⇧E</kbd> is shared with Diple

The host dispatches a chord to the first plugin action that registered it, and a plugin action cannot pass it on. So this plugin's “Annotate selection (document page)” has **no default chord**: the document page listens for <kbd>⌘⇧E</kbd> itself, only when the selection is in its document. Diple sees the page's marker and stays silent there. You can bind another key in the app's keyboard settings.

## Selections in the Rendered view

A selection in the Rendered view is mapped back to the Markdown source. For tables, raw HTML, footnotes and some other structures the mapping can be ambiguous; the page then does not guess a position and asks you to select the passage in the **Source** view. _(issue not filed yet)_

## Finding passages again after a change

- Duplicate passages: the stored line number only tells identical copies apart in the very version the annotation was taken in. After a change, a position is carried over only when the page saw the old version and both directions of alignment agree; otherwise the annotation is marked **Original changed**. Inserting a copy of the same block nearby, or seeing a change only after a reload, can therefore turn a findable annotation into “original changed”; **Pick new original** on the card fixes it.
- A region squeezed between two unrelated edits cannot be carried over by common prefix and suffix when the document has other copies of its context.
- A text that occurs more than 20 000 times is always treated as ambiguous.

## Files and paths

- Annotation lists are keyed by the file's path, normalised literally (`a/../b.md` is `b.md`), not resolved through symbolic links: two paths to one file have two lists, and a renamed or moved file starts with an empty list. _(issue not filed yet)_
- Reading is restricted to regular `.md` / `.markdown` files up to 5 MB of UTF-8 text. Locations that hold credentials or internal Hermes data are refused (for example `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, and the Hermes home's `.env`, `auth.json`, `auth/`, `mcp-tokens/`, `vault/`). The plugin's list is its own copy; the host's own read rules are applied too when the host module can be imported, and a failure there refuses the read.
- **Files with several hard links are refused**: a hard link is an alias that a path check cannot see. Open a copy instead. _(issue not filed yet)_
- Every directory on the way must be openable for reading; folders that allow search but not listing fail. Platforms without directory file descriptors (Windows) are not supported.
- Between the check and the open, the same path can still be swapped for another single-link `.md` file in an allowed location; it is then read (it passed the same checks). A swap after opening does not change what is read.
- The plugin allows you to open Markdown anywhere you choose; there is no workspace sandbox. A card from the AI only opens the page; it is not a permission, and every read goes through the checks above.

## Tabs and windows

- Hermes Desktop does not keep plugin tabs across a reload or restart; the plugin remembers open documents (for 24 hours) and reopens them when it starts.
- Conversation names come from the session title, or else from the first user message (through an internal host function; if that changes, “Untitled conversation” is shown).
