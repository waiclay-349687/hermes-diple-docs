**English** | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | [Français](README.fr.md) | [Deutsch](README.de.md) | [Español](README.es.md)

# Diple Docs — highlight and comment on Markdown documents for the AI (Hermes Desktop plugin)

Open a `.md` file in Hermes Desktop, highlight passages and write comments on them, and hand them to the AI in your chat; each annotation keeps its place in the file and shows whether it was sent, answered or resolved.

> **The name.** A *diple* (›) is the mark ancient Greek scribes put in the margin to point a line to its commentary. Diple Docs (圈批·文档) is the document member of the family; [Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) is the chat member.

> **Unofficial.** This is a community plugin. It is not made, reviewed or supported by Nous Research or the Hermes Agent project.

## Features

- **A read-only document page** — opens a `.md` / `.markdown` file in its own tab, in the same place as the Hermes preview: beside the chat, on its right. **Rendered** and **Source** views, **Reload**, and **Reveal in Finder**. The plugin never edits the document.
- **Annotate a selection** — select text and click **Annotate**. The editor opens directly below the passage and the selection keeps a light temporary shade, so you can see what you are annotating. Nothing is added yet.
- **Saved means listed** — **Save** with a comment makes a *comment* (the AI must answer it); **Save** with the box left empty makes a *highlight* (background only). Only then does the annotation enter the list and become the current one. An empty draft is dropped when you click outside or press <kbd>Esc</kbd>. A draft with text is not lost when you click outside, switch to another annotation, close the page or reload it; only <kbd>Esc</kbd> or **×** discards it. When the file is refreshed, the draft follows its passage; if the passage cannot be found, you are asked to select it again. If another window saved the same passage meanwhile, you choose: **Keep existing**, **Replace with mine** or **Merge**.
- **The annotation list** — every annotation of the file in document order, with filters (All, To send, Sent, Answered, Original changed, Resolved). On a card: jump to the passage, edit the comment, mark resolved or reopen, delete (with undo), send this one.
- **Previous / next open annotation** — two arrows in the list header (and in the margin status bar) step through what is still unresolved.
- **Clear in bulk, with undo** — the list's **⋯** menu clears all, the resolved, the sent or answered, the "original changed" ones or the filtered ones, marks all resolved, or copies all as Markdown. Every clear can be undone.
- **Show or hide the list from the toolbar** — the switch at the right end of the document's toolbar (it shows how many are still open). Hidden, the list leaves a **margin status bar**: one tick per annotation at its place in the document, coloured by status; hover a tick to preview it, click it to go there.
- **Narrow windows** — when the page is too narrow for the list beside the document, the list becomes a bottom bar that folds open and shut.
- **Follows file changes** — when the file changes on disk the page reloads (it waits while you are writing a comment) and finds each passage again. A passage it cannot find any more is marked **Original changed** and keeps the old text, with **Pick new original** on the card.
- **Hand it to the chat** — **Send N ▾** hands annotations to [Diple](https://github.com/waiclay-349687/hermes-diple): into the conversation's pending list, to go with your next message, or sent right away. The card then shows **Sent** and, once the AI has answered, **Answered**, with a link to the conversation. **Copy for AI** in the same menu copies them as Markdown instead.
- **"Open in Diple Docs" in the chat** — when the AI writes a `.md` file, a card at the end of its answer opens it for annotating (can be switched off). Recent documents are also in the command palette.

The plugin UI is available in every Hermes Desktop language: **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch and Español** (Arabic right-to-left). It follows the app language by default; you can also pick one in the plugin's settings.

## Screenshots

All screenshots use the Simplified Chinese UI and a made-up sample document.

The comment editor directly below the selected passage; the margin status bar on the right:

![The editor below a selected passage, with the comment box and Save and send / Save buttons (in Chinese)](docs/screenshots/editor.png)

The list header: previous / next open annotation, the **⋯** menu with the bulk actions, the filters and the first cards:

![The annotation list with its ⋯ menu open: clear all, clear resolved, clear sent/answered, clear original changed, mark all resolved, copy all as Markdown (in Chinese)](docs/screenshots/list-menu.png)

The list hidden from the toolbar: the margin status bar with one tick per annotation (light and dark theme):

![The document with the list hidden and a narrow status bar of coloured ticks on the right edge (in Chinese)](docs/screenshots/rail.png)

![The same in the dark theme](docs/screenshots/rail-dark.png)

A narrow page: the list as a bottom bar:

![A narrow document page with the annotation list as a bottom bar (in Chinese)](docs/screenshots/narrow.png)

The screenshots were taken in a sandbox, before the last change to the editor: there, a new annotation already had its number while its editor was open; now it gets one when you save.

## Install

The plugin has two halves: a desktop plugin (`plugin.js`) and a small Python backend (`plugins/diple-docs/`). Both are needed. To send annotations to the chat, also install [Diple](https://github.com/waiclay-349687/hermes-diple) (see “Companion” below). In the commands below `~/.hermes` is your Hermes home; for a named profile use `~/.hermes/profiles/<name>` instead.

### Option A: download a release

1. Download `plugin.js`, `plugin.js.sha256`, `diple-docs-python-0.1.0.zip` and `diple-docs-python-0.1.0.zip.sha256` from the [latest release](https://github.com/waiclay-349687/hermes-diple-docs/releases), and check them:

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-docs-python-0.1.0.zip.sha256
   ```

2. Put them in place:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple-docs ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple-docs/plugin.js
   unzip -o diple-docs-python-0.1.0.zip -d ~/.hermes/plugins/
   ```

3. Enable the backend and restart Hermes Desktop:

   ```bash
   hermes plugins enable diple-docs
   ```

### Option B: from source

Needs Node.js 22 or newer.

```bash
git clone https://github.com/waiclay-349687/hermes-diple-docs.git
cd hermes-diple-docs
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple-docs
```

`scripts/install.mjs` builds `plugin.js` and copies both halves into the Hermes home given by `--home` (it never guesses one). Restart Hermes Desktop afterwards: the Python half loads only at app start.

## Usage

1. Open a document: in the command palette (<kbd>⌘K</kbd>) choose “Diple Docs: Open document…” or “Diple Docs: Recent documents…”, or click **Open** on an “Open in Diple Docs” card in the chat.
2. Select a passage and click **Annotate**. Type a comment, or leave the box empty for a highlight, and click **Save** (or press <kbd>Enter</kbd>; <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line). The annotation appears in the list and as a shade on the passage.
3. Keep going. Use the arrows in the list header to step through what is still open, and the toolbar switch to hide the list when you want the width back.
4. Open **Send N ▾**: choose this one or all unsent in the file, then the current conversation, to add them to its pending list or send them now. Or choose **Copy for AI**.
5. When the AI has answered, the cards say **Answered**. Mark what is settled as resolved, and clear it from the **⋯** menu when you are done.

**Save and send** in the editor saves first, then sends that one annotation to the current conversation.

### Shortcuts

| Action | Default | Notes |
| --- | --- | --- |
| Annotate the selection on the document page | <kbd>⌘⇧E</kbd> | The same chord as Diple's, handled by the page itself; you can also bind “Annotate selection (document page)” in the app's keyboard settings |
| Show or hide the annotation list | <kbd>⌘⌥B</kbd> | Rebindable |
| Previous / next open annotation | none | Bind them in the app's keyboard settings |

The surfaces you work in (button, editor, list, status bar) do not show these keycaps; the plugin's settings page lists them.

On Windows and Linux, <kbd>⌘</kbd> is <kbd>Ctrl</kbd>. The command palette (<kbd>⌘K</kbd>) also has “Annotate selection (document page)” and “Diple Docs: Settings” (in your UI language).

## Settings

Open them from the command palette (“Diple Docs: Settings”) or from Settings in the app.

| Setting | Default | What it does |
| --- | --- | --- |
| Language | Follow app | Follow app, or one of the nine languages, each shown in its own name. |
| Add an “Open in Diple Docs” card after the AI writes a `.md` file | on | A card at the end of the answer opens the file it wrote. Off: open it from the command palette instead. |
| Shortcuts | — | The page lists the shortcuts above; rebind them in the app's keyboard settings. |
| Reset | — | Restores the defaults. |

## How it works

### What the AI receives

Diple Docs does not talk to the AI itself. **Send** hands the annotations to Diple through plugin events (the hand-off protocol, [ADR 0007](docs/adr/README.md)); Diple puts them into the conversation's pending list next to annotations taken in the chat and sends them the way it sends its own: the chat bubble stays short, and the AI receives each passage in full with its file and line, your comment, and the rule to answer every comment. Diple reports back what was sent and what was answered, and the cards follow.

**Copy for AI** puts the same annotations on the clipboard as Markdown (the passage as a quote, then your comment), for any chat or tool.

### Each annotation's place

An annotation stores its passage, the line, and enough of the surrounding text to find it again. After the file changes, the plugin looks for the passage in the new text; when the context is not unique enough to be sure, it does not guess: the annotation is marked **Original changed** and keeps the text as it was.

### Where data is stored

- Annotations, their state and the list of recent documents: SQLite at `~/.hermes/plugin-data/diple-docs/data.db`, keyed by the file's path. Nothing is written next to your documents.
- Layout choices (list width, hidden or shown, the view): the desktop plugin storage of Hermes Desktop (keys prefixed `hermes.plugin.diple-docs.`).

Design decisions are recorded in [docs/adr](docs/adr/README.md) and the overall structure in [docs/architecture.md](docs/architecture.md).

## Privacy

Everything stays on your machine. The plugin makes no network requests of its own and has no telemetry. It reads only the documents you open, and refuses locations that hold credentials or internal Hermes data (for example `~/.ssh` or the Hermes `.env`). Annotations reach your model provider only when you send them to a conversation, exactly like text you type.

## Known limitations

The main ones (full list with reasons in [docs/known-limitations.md](docs/known-limitations.md)):

- Sending needs Diple. Without it, the first send waits 3 seconds for an answer (10 seconds when the target is another conversation, which Diple opens first), then the page says Diple is not responding and turns sending off; the list, the comments, **Copy for AI** and **Copy all as Markdown** keep working.
- The send target is always an existing conversation: a new one cannot be created from here, because the SDK's `newChat()` returns no session id. _(issue not filed yet)_
- In the Rendered view, a selection inside a table, raw HTML or a footnote may not line up with the source; the page then asks you to select it again in the Source view.
- A renamed or moved file starts with an empty list.
- If another plugin also rewrites the AI's answers, the “Open in Diple Docs” card can be lost (the host keeps only the first rewrite); the file is still in Recent documents.

## Compatibility

Tested with Hermes Agent **v0.22.5 (2026.9.24)**, commit `bf0203a` (2026-10-22), on macOS, together with Diple 0.2.2. It needs Hermes Desktop (the CLI alone does not load desktop plugins). Other versions may work but have not been tested; please report what you find.

## Companion: Diple

[Diple](https://github.com/waiclay-349687/hermes-diple) (圈批) is the chat member of the family: highlight and comment on passages of a conversation, keep them in a pending list above the composer, and send them with your next message; the AI answers every comment and you can jump between each answer and its passage.

- **Without Diple**: opening documents, annotating, the list, filters, resolving, the margin status bar, **Copy for AI** in the send menu and **Copy all as Markdown** all work. Only sending to a conversation needs Diple.
- **With Diple**: **Send N ▾** puts the document's annotations into the conversation's pending list, beside the ones taken in the chat, as chips above the composer; they go out with your next message, or at once when you pick the conversation itself in the menu. The AI's answers mark which comment they answer, and the cards here turn **Sent**, then **Answered**.

The two are separate plugins with separate repositories and releases; install either or both. They share no code at run time: each bundles its own copy of the shared core.

## How this differs

Hermes Desktop's own preview shows a Markdown file and can edit it. Diple Docs never edits: it is for reviewing. It keeps a list of annotations per file across sessions, finds them again after the file changes, tracks each one from to-send to answered to resolved, and hands them to the chat through Diple.

## Roadmap and issues

- [ROADMAP.md](ROADMAP.md) — what is being worked on now, next and later.
- [Issues](https://github.com/waiclay-349687/hermes-diple-docs/issues) — open questions, design discussions and known limitations.
- [CHANGELOG.md](CHANGELOG.md) — what changed in each version.
- [CONTRIBUTING.md](CONTRIBUTING.md) — building and testing.

## License

[MIT](LICENSE).
