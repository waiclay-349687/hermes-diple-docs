# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Planned work is in [ROADMAP.md](ROADMAP.md).

## [0.1.0] - 2026-10-30

First public version. It was built and used privately alongside [Diple](https://github.com/waiclay-349687/hermes-diple) (from v0.2.2 on, Diple's README points here), and is now a repository of its own.

### Added

**Opening documents**

- A read-only document page for `.md` and `.markdown` files, in its own tab. It opens where the Hermes preview opens: beside the chat, on its right; further documents stack into the same area (with an open Hermes preview, into the preview's area).
- Open from the command palette (“Diple Docs: Open document…”, a file picker), from “Diple Docs: Recent documents…” and the recent-document rows, or from the recent-documents page.
- An “Open in Diple Docs” card at the end of an answer whose turn wrote a `.md` file (`write_file` or `patch`); it shows how many annotations the file already has. It can be switched off in the settings. Files the AI wrote are also added to Recent documents.
- **Rendered** and **Source** views (remembered), **Reload**, **Reveal in Finder**, and a “Synced · <time>” line. Open document tabs come back after a reload of the app (within 24 hours).
- The page follows the file: it polls for changes, reloads (waiting while you write a comment, with **Refresh now**), and tells you when the file is gone, keeping the list until it returns.
- Safe reading: files over 5 MB, non-UTF-8 text, anything that is not a regular file, files with several hard links and locations that hold credentials or internal Hermes data are refused with a message that says why.

**Annotating**

- Select text in the document and click **Annotate** (or press <kbd>⌘⇧E</kbd> on the page). The editor opens directly below the passage, fully on screen, and the document does not scroll; the passage keeps a light temporary shade while you write.
- Nothing is stored until you save: **Save** with a comment makes a comment (the AI must answer it), **Save** with an empty box makes a highlight. Only then does it enter the list, the margin status bar and the database, and become the current annotation. **Save and send** saves first, then sends it to the current conversation.
- Leaving a draft: an empty one is dropped by <kbd>Esc</kbd> or a click outside, without a trace. One with text is never lost by a click outside (the editor shakes gently), by switching to another annotation, or by closing or reloading the page (it is restored where you left it); only <kbd>Esc</kbd> or **×** discards it. Selecting another passage and clicking **Annotate** replaces an empty draft and keeps a written one.
- A draft follows the file: after a refresh it moves with its passage; when the passage is gone, the editor keeps your text and asks you to select the passage again. If another window saved the same passage meanwhile, you choose **Keep existing**, **Replace with mine** or **Merge**.
- Annotating a passage that is already annotated opens the existing annotation. The editor's replace icon picks a new original from the current selection, for a draft or a saved annotation.
- <kbd>Enter</kbd> saves, <kbd>Shift</kbd>+<kbd>Enter</kbd> adds a line; an <kbd>Enter</kbd> that confirms an input-method candidate never saves.
- Marks on the original: a highlight is shaded, a comment is shaded and underlined, the current annotation is deeper, and an annotation whose passage changed gets a wavy warning line. The looks are the same as in Diple.
- In the Rendered view, a selection is mapped back to the exact source text; where it cannot be mapped reliably (tables, raw HTML, footnotes), the page asks you to select it in the Source view instead of guessing.

**The annotation list**

- Every annotation of the file in document order, with the line, the status, the passage and the comment rendered as Markdown. Filters: All, To send, Sent, Answered, Original changed, Resolved; resolved ones are grouped at the end.
- On a card: click to go to the passage, **Edit comment**, **Mark resolved** / **Reopen**, **Delete** (with undo), and send this one. A sent card names the conversation it went to, with a link that opens it.
- Previous / next open annotation in the list header.
- The **⋯** menu: clear all, clear resolved, clear sent / answered, clear “original changed”, clear the filtered ones, mark all resolved, copy all as Markdown. Every clear can be undone from the notice that follows.
- Show or hide the list with the switch at the right end of the toolbar, which also shows how many are still open (<kbd>⌘⌥B</kbd>). Drag the list's edge to resize it; drag it narrow enough and it folds away. Width and state are remembered.
- The margin status bar when the list is hidden: one tick per annotation at its place in the document, coloured by status, with previous / next at its top; the switch in the toolbar brings the list back. Hover or focus a tick for a preview, click it to go there.
- A narrow page (beside a docked chat, for example) keeps the list beside the document as long as both fit; below that it becomes a bottom bar with a count, folding open and shut.
- After a file change, each annotation is found again from its context; when that is not certain it is marked **Original changed**, keeps the old text, and the card offers **Pick new original**.
- Conflicts across windows: saving a comment that was changed or resolved elsewhere keeps your draft and lets you overwrite or discard.

**Sending (with Diple)**

- **Send N ▾**: choose this one or all unsent in the file, then the current conversation (with its title) to add them to its pending list or send at once, or **Copy for AI** (Markdown). Recent conversations are offered as targets too.
- The hand-off to Diple goes through plugin events with its own receipts, retries and final results (ADR 0004, ADR 0007): the cards show **In pending list**, **Submitted, waiting for confirmation**, **Sent** and **Answered**; annotations that did not go out come back as unsent, with the reason.
- When Diple does not confirm within 3 seconds (10 seconds when the target is another conversation, which Diple opens first) you are told so (it may still be working); a late confirmation is announced and the list updates. Annotations from an unconfirmed hand-off ask before being sent again.
- Without Diple (or with it turned off), a banner says sending is unavailable while the list keeps working. **Copy for AI** in the send menu does not need Diple: the menu always opens, and only the targets that need Diple are disabled.

**Everywhere**

- The plugin UI in all nine Hermes Desktop languages, following the app or a language picked in the settings; Arabic is right-to-left.
- Settings: language, the “Open in Diple Docs” card, the shortcuts, reset. The surfaces you work in show no keycaps; the settings page lists the shortcuts.
- A self-check that says, once, which features run degraded on an older Hermes Desktop.

> **Unofficial.** Diple Docs is a community plugin for Hermes Desktop. It is not made, reviewed or supported by Nous Research or the Hermes Agent project.

[Unreleased]: https://github.com/waiclay-349687/hermes-diple-docs/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/waiclay-349687/hermes-diple-docs/releases/tag/v0.1.0
