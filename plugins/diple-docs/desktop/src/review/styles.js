// CSS for the review page, list, cards, auto card and settings.
// Host design tokens only (V2 design §9, the host's DESIGN.md): theme variables
// for every colour, --radius-sm/--radius-md (4px for icon buttons), the host
// input chrome for the comment box, shadow-nous + --stroke-nous for floating
// surfaces, ~100–120ms functional motion that stops under reduced motion.
//
// Marks on the original (::highlight, see marks.js). ::highlight() paints
// background-color and text-decoration (style, colour, thickness) in the host's
// Chromium; it ignores text-underline-offset (V2-T P7, an internal host-contract check, not published).
//   The looks are @diple/core MarkLook, the same as in the chat: a state has
//   one fill (er-<base>) and, for a 批注, one line (er-<base>-line); 原文已变
//   is a wavy warning overlay (er-changed); the current item deepens the fill
//   over the status line and stays (no flash on the way back, V2.1 #1).
//   The chat's pins have no counterpart here (documents have the list instead).
import { MarkLook, PassageLook } from '@diple/core'
import { RESIZE_HANDLE_CSS, SEND_MENU_CSS } from '@diple/desktop-kit'

const ACCENT = MarkLook.ACCENT
const ANSWER = MarkLook.ANSWER
const WARN = MarkLook.WARN
const mix = (c, pct) => `color-mix(in srgb, ${c} ${pct}%, transparent)`
const HAIR = 'var(--ui-stroke-tertiary, var(--ui-stroke-secondary))'

export const REVIEW_CSS = `
::highlight(er-pending) { ${MarkLook.fill('pending')}; }
::highlight(er-pending-line) { ${MarkLook.line('pending')}; }
::highlight(er-highlight) { ${MarkLook.fill('pending')}; }
::highlight(er-sent) { ${MarkLook.fill('sent')}; }
::highlight(er-sent-line) { ${MarkLook.line('sent')}; }
::highlight(er-answered) { ${MarkLook.fill('answered')}; }
::highlight(er-answered-line) { ${MarkLook.line('answered')}; }
::highlight(er-resolved-line) { ${MarkLook.line('resolved')}; }
::highlight(er-changed) { ${MarkLook.line('changed')}; }
::highlight(er-active) { ${MarkLook.fill('active')}; }
::highlight(er-draft) { ${MarkLook.fill('active')}; }

.er-page { container-type: inline-size; display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--ui-text-primary); }
.er-head { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid ${HAIR}; min-height: 44px; flex-wrap: wrap; }
.er-head-title { display: flex; flex-direction: column; min-width: 0; flex: 1 1 200px; }
.er-head-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.er-head-dir { font-size: 11px; color: var(--ui-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.er-head-tools { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.er-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: var(--radius-md); color: var(--ui-text-secondary); background: var(--ui-bg-quaternary, ${mix('var(--ui-text-quaternary)', 14)}); white-space: nowrap; }
.er-sync { font-size: 11px; color: var(--ui-text-tertiary); white-space: nowrap; }
.er-banner { display: flex; align-items: center; gap: 8px; padding: 6px 14px; font-size: 12px; border-bottom: 1px solid ${HAIR}; color: var(--ui-text-secondary); background: ${mix(WARN, 8)}; animation: er-fade 120ms ease-out; }
.er-banner.is-info { background: ${mix(ACCENT, 6)}; }
.er-banner > span { flex: 1; }
.er-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) var(--er-list-w, 340px); }
.er-body[data-er-list-mode="rail"] { grid-template-columns: minmax(0, 1fr) 28px; }
.er-body[data-er-list-mode="sheet"] { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto; }
.er-body[data-er-list-mode="sheet"][data-er-sheet="open"] { grid-template-rows: minmax(0, 1fr) minmax(0, 45%); }
.er-sheet { min-height: 0; display: flex; flex-direction: column; border-top: 1px solid ${HAIR}; }
.er-sheet > .er-list { flex: 1; border-inline-start: none; border-top: 1px solid ${HAIR}; }
.er-sheet-bar { display: flex; align-items: center; gap: 4px; height: 36px; padding: 0 8px; box-sizing: border-box; flex: none; }
.er-sheet-bar .er-spacer { flex: 1; }
.er-sheet-title { font-size: 12px; font-weight: 600; color: var(--ui-text-primary); }
.er-list-toggle { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 5px; border: 0; border-radius: var(--radius-sm, 4px); background: transparent; color: var(--ui-text-secondary); font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap; transition: background-color 100ms ease-out, color 100ms ease-out; }
.er-list-toggle:hover, .er-list-toggle:focus-visible { background: var(--ui-control-hover-background, var(--ui-bg-tertiary)); color: var(--ui-text-primary); outline: none; transition: none; }
.er-list-toggle .codicon { font-size: 13px; }
.er-unhandled { min-width: 14px; padding: 0 3px; box-sizing: border-box; border-radius: var(--radius-sm, 4px); font: 600 10px/14px var(--dt-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; text-align: center; color: ${ACCENT}; background: ${mix(ACCENT, 12)}; }
.er-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: var(--radius-sm, 4px); background: transparent; color: var(--ui-text-secondary); cursor: pointer; flex: none; }
.er-icon-btn:hover:not(:disabled), .er-icon-btn:focus-visible { background: var(--ui-control-hover-background, var(--ui-bg-tertiary)); color: var(--ui-text-primary); outline: none; }
.er-icon-btn:disabled { opacity: 0.4; cursor: default; }
.er-icon-btn .codicon { font-size: 13px; }
.er-list-tools { display: inline-flex; align-items: center; gap: 2px; margin-inline-start: auto; flex: none; font-weight: 400; }
.er-rail { position: relative; min-height: 0; display: flex; flex-direction: column; align-items: center; border-inline-start: 1px solid ${HAIR}; }
.er-rail-top { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 0 4px; flex: none; }
.er-rail-track { position: relative; flex: 1; width: 100%; margin: 4px 0 10px; }
.er-tick { position: absolute; inset-inline: 2px; height: 9px; margin-top: -4px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.er-tick::after { content: ''; position: absolute; inset-inline: 2px; top: 3px; height: 3px; border-radius: 1px; background: var(--er-tick, ${ACCENT}); }
.er-tick:hover::after, .er-tick:focus-visible::after, .er-tick.is-active::after { top: 2px; height: 5px; inset-inline: 0; }
.er-tick:focus-visible { outline: 1px solid ${mix(ACCENT, 60)}; outline-offset: 0; }
.er-tick-pending { --er-tick: ${ACCENT}; }
.er-tick-sent { --er-tick: ${mix(ACCENT, 45)}; }
.er-tick-answered { --er-tick: ${ANSWER}; }
.er-tick-changed { --er-tick: ${WARN}; }
.er-tick-resolved { --er-tick: var(--ui-text-quaternary); }
.er-preview { position: absolute; z-index: 20; inset-inline-end: calc(100% + 6px); width: 280px; max-width: 60vw; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--stroke-nous, ${HAIR}); border-radius: var(--radius-md); background: var(--ui-bg-elevated, var(--ui-bg-editor)); box-shadow: var(--shadow-nous, var(--shadow-md)); color: var(--ui-text-primary); pointer-events: auto; animation: er-fade 100ms ease-out; }
.er-preview .er-preview-quote { max-height: 4.8em; }
.er-preview-comment { font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; max-height: 9em; overflow: hidden; }
.er-preview-comment > * { font-size: inherit; line-height: inherit; }
.er-preview-comment :is(p, ul, ol) { margin: 0 0 0.35em; }
.er-preview-comment.is-empty { color: var(--ui-text-quaternary); }
.er-docwrap { position: relative; min-height: 0; overflow: auto; }
.er-doc { padding: 18px 28px 64px; max-width: 900px; margin: 0 auto; cursor: text; user-select: text; -webkit-user-select: text; }
.er-quote, .er-comment { user-select: text; -webkit-user-select: text; }
.er-doc:focus { outline: none; }
.er-doc:focus-visible { outline: 1px solid ${mix(ACCENT, 50)}; outline-offset: -1px; }
.er-source { font-family: var(--dt-font-mono, var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)); font-size: 12px; line-height: 1.7; padding: 14px 0 64px; counter-reset: er-line; }
.er-line { white-space: pre-wrap; word-break: break-word; padding: 0 20px 0 58px; position: relative; min-height: 1.7em; }
.er-line::before { counter-increment: er-line; content: counter(er-line); position: absolute; left: 0; width: 44px; text-align: right; color: var(--ui-text-quaternary); user-select: none; -webkit-user-select: none; }
.er-line.is-flagged::before { color: var(--ui-text-secondary); }
.er-md-fallback { white-space: pre-wrap; }
.er-pickbtn { position: absolute; z-index: 7; /* above an open draft's editor (V3-D3: the button under it could not be clicked) */ display: inline-flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: var(--radius-md); font-size: 12px; line-height: 18px; border: 1px solid var(--stroke-nous, ${HAIR}); background: var(--ui-bg-elevated, var(--ui-bg-editor)); color: var(--ui-text-primary); box-shadow: var(--shadow-nous, var(--shadow-md)); cursor: pointer; transform-origin: top left; animation: er-pop 120ms ease-out; transition: background-color 100ms ease-out; }
.er-pickbtn:hover { background: var(--ui-control-hover-background, var(--ui-bg-elevated)); transition: none; }
.er-pickbtn:focus-visible { outline: 1px solid ${ACCENT}; outline-offset: 1px; }
.er-state { padding: 40px 24px; text-align: center; color: var(--ui-text-secondary); font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 10px; }
.er-state-title { font-weight: 600; color: var(--ui-text-primary); }
.er-list { position: relative; min-height: 0; display: flex; flex-direction: column; border-inline-start: 1px solid ${HAIR}; }
.er-list-head { padding: 8px 12px 6px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.er-list-title { display: flex; align-items: center; gap: 6px; min-height: 22px; font-weight: 600; font-size: 12px; min-width: 0; }
.er-list-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.er-count { flex: none; font: 500 11px/16px var(--dt-font-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; color: var(--ui-text-tertiary); }
/* one row: scrolls sideways when the labels do not fit (long languages, a narrow list) */
.er-filters { display: flex; flex-wrap: nowrap; gap: 2px; overflow-x: auto; overscroll-behavior-x: contain; scrollbar-width: none; margin: 0 -4px; padding: 0 4px; mask-image: linear-gradient(to right, transparent 0, currentColor 4px, currentColor calc(100% - 12px), transparent 100%); }
.er-filters::-webkit-scrollbar { display: none; }
.er-filter { flex: none; white-space: nowrap; font-size: 11px; line-height: 16px; padding: 2px 7px; border-radius: var(--radius-md); border: none; background: none; color: var(--ui-text-tertiary); cursor: pointer; transition: background-color 100ms ease-out, color 100ms ease-out; }
.er-filter:hover { background: var(--ui-row-hover-background, ${mix('var(--ui-text-quaternary)', 12)}); color: var(--ui-text-secondary); transition: none; }
.er-filter.is-active { color: var(--ui-text-primary); background: var(--ui-control-active-background, ${mix(ACCENT, 8)}); }
.er-filter:focus-visible { outline: 1px solid ${mix(ACCENT, 60)}; outline-offset: -1px; }
.er-filter b { font-weight: 500; margin-inline-start: 4px; color: var(--ui-text-quaternary); font-variant-numeric: tabular-nums; }
.er-filter.is-active b { color: var(--ui-text-tertiary); }
.er-target { flex: 1; min-width: 0; font-size: 11px; font-weight: 400; color: var(--ui-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.er-bulk { display: flex; align-items: center; gap: 8px; min-width: 0; }
.er-bulk > .er-send-menu-wrap { flex: none; }
.er-more-wrap { display: inline-flex; }
/* the page toolbar's list switch (V3-D2 #1) */
.er-panel-switch { display: inline-flex; align-items: center; justify-content: center; gap: 3px; min-width: 24px; height: 24px; padding: 0 4px; box-sizing: border-box; border: 0; border-radius: var(--radius-sm, 4px); background: transparent; color: var(--ui-text-secondary); cursor: pointer; transition: background-color 100ms ease-out, color 100ms ease-out; }
.er-panel-switch:hover, .er-panel-switch:focus-visible { background: var(--ui-control-hover-background, var(--ui-bg-tertiary)); color: var(--ui-text-primary); outline: none; transition: none; }
.er-panel-switch:focus-visible { box-shadow: 0 0 0 1px ${mix(ACCENT, 60)}; }
.er-panel-switch .codicon { font-size: 14px; }
.er-panel-switch:dir(rtl) .codicon { transform: scaleX(-1); }
.er-filters:dir(rtl) { mask-image: linear-gradient(to left, transparent 0, currentColor 4px, currentColor calc(100% - 12px), transparent 100%); }
/* the editor under the passage (V3-D2 #3): the chat's V2.1 editor tokens */
.er-float { position: absolute; z-index: 6; width: 320px; max-width: calc(100% - 16px); box-sizing: border-box; padding: 10px; display: flex; flex-direction: column; gap: 8px; border: 1px solid var(--stroke-nous, ${HAIR}); border-radius: var(--radius-md); background: var(--ui-bg-elevated, var(--ui-bg-editor)); box-shadow: var(--shadow-nous, var(--shadow-md)); color: var(--ui-text-primary); cursor: auto; transform-origin: 0 0; animation: er-pop 120ms ease-out; }
.er-float[data-side="top"] { transform-origin: 0 100%; }
/* a draft with words clicked away from: kept, a small shake (the chat's) */
.er-float[data-shake] { animation: er-shake .26s ease-out; }
@keyframes er-shake { 20% { transform: translateX(-3px); } 45% { transform: translateX(3px); } 70% { transform: translateX(-2px); } 100% { transform: none; } }
.er-float-head { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ui-text-tertiary); margin: -2px -4px -2px 0; }
.er-float-head .er-spacer { flex: 1; }
.er-float-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.er-float .er-editor { resize: none; font-size: 13px; min-height: 56px; max-height: 180px; }
.er-float-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; margin: 0 0 -2px -2px; }
.er-float-actions { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 6px; margin-inline-start: auto; max-width: 100%; }
.er-pbtn, .er-sbtn { display: inline-flex; align-items: center; height: 24px; padding: 0 10px; border-radius: var(--radius-md); font: 500 12px/1 var(--dt-font-sans, system-ui, sans-serif); white-space: nowrap; cursor: pointer; flex: none; }
.er-pbtn { border: 0; background: ${ACCENT}; color: var(--ui-bg-editor, var(--ui-bg-elevated)); }
.er-pbtn:hover { background: color-mix(in srgb, ${ACCENT} 88%, var(--ui-text-primary)); }
.er-sbtn { border: 1px solid var(--ui-stroke-secondary); background: transparent; color: var(--ui-text-secondary); }
.er-sbtn:hover:not(:disabled) { background: var(--ui-control-hover-background); color: var(--ui-text-primary); }
.er-sbtn:disabled { opacity: 0.45; cursor: default; }
.er-pbtn:focus-visible, .er-sbtn:focus-visible { outline: 2px solid ${ACCENT}; outline-offset: 1px; }
.er-send-menu-wrap, .er-send-one-wrap { position: relative; display: inline-flex; }
.er-send-menu-wrap > button, .er-send-menu-wrap button { white-space: nowrap; gap: 4px; }
.er-send-one { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: var(--radius-sm, 4px); background: transparent; color: var(--ui-text-secondary); cursor: pointer; }
.er-send-one:hover:not(:disabled), .er-send-one:focus-visible, .er-send-one[aria-expanded="true"] { background: var(--ui-control-hover-background, var(--ui-bg-tertiary)); color: var(--ui-text-primary); outline: none; }
.er-send-one:disabled { opacity: 0.4; cursor: default; }
.er-send-one .codicon { font-size: 13px; }
.er-items { flex: 1; min-height: 0; overflow: auto; padding: 4px 10px 24px; display: flex; flex-direction: column; gap: 6px; }
.er-card { border: 1px solid ${HAIR}; border-radius: var(--radius-md); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; background: transparent; cursor: pointer; outline: none; animation: er-fade 120ms ease-out; transition: border-color 100ms ease-out, background-color 100ms ease-out; }
.er-card:hover { border-color: var(--ui-stroke-secondary); background: var(--ui-row-hover-background, transparent); transition: none; }
.er-card:focus-visible { box-shadow: 0 0 0 2px ${mix(ACCENT, 35)}; }
.er-card.is-active { border-color: ${mix(ACCENT, 38)}; background: var(--ui-bg-quinary, transparent); }
.er-card.is-resolved { opacity: 0.7; }
.er-card-top { display: flex; align-items: center; flex-wrap: wrap; gap: 2px 6px; font-size: 11px; color: var(--ui-text-tertiary); }
.er-card-top > :is(.er-status, .er-chip, .er-line-no) { white-space: nowrap; }
.er-card-top .er-line-no { margin-inline-start: auto; font-variant-numeric: tabular-nums; }
.er-index { min-width: 16px; height: 16px; padding: 0 3px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-sm); font: 600 10px/1 var(--dt-font-mono, ui-monospace, monospace); color: ${ACCENT}; box-shadow: inset 0 0 0 1px ${mix(ACCENT, 45)}; }
.er-card[data-er-mark="pending"] .er-index { background: ${ACCENT}; color: var(--dt-primary-foreground, var(--ui-bg-editor)); box-shadow: none; }
.er-card[data-er-mark="sent"] .er-index, .er-card[data-er-mark="resolved"] .er-index { color: var(--ui-text-tertiary); box-shadow: inset 0 0 0 1px var(--ui-stroke-primary); }
.er-card[data-er-mark="answered"] .er-index { color: ${ANSWER}; background: ${mix(ANSWER, 12)}; box-shadow: none; }
.er-status { font-size: 11px; line-height: 16px; padding: 0 5px; border-radius: var(--radius-sm); font-weight: 500; }
.er-status-pending { color: ${ACCENT}; background: ${mix(ACCENT, 12)}; }
.er-status-sent { color: var(--ui-text-secondary); background: ${mix(ACCENT, 6)}; box-shadow: inset 0 0 0 1px ${mix(ACCENT, 22)}; }
.er-status-answered { color: ${ANSWER}; background: ${mix(ANSWER, 12)}; }
.er-status-resolved { color: var(--ui-text-tertiary); background: var(--ui-bg-quaternary, ${mix('var(--ui-text-quaternary)', 14)}); }
.er-status-changed { color: ${WARN}; background: ${mix(WARN, 12)}; }
.er-quote { position: relative; font-size: 12px; line-height: 1.55; color: var(--ui-text-secondary); padding: 0; }
${PassageLook.css('.er-quote', { maxHeight: '7.75em' })}
.er-float .er-float-quote { max-height: 7.75em; }
.er-card.is-active .er-quote { max-height: 18em; }
.er-quote > * { font-size: inherit; line-height: inherit; color: inherit; }
.er-quote :is(p, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6, table) { margin: 0 0 0.35em; font-size: inherit; line-height: inherit; }
.er-quote :is(p, ul, ol, blockquote, pre, h1, h2, h3, h4, h5, h6, table):last-child { margin-bottom: 0; }
.er-quote :is(h1, h2, h3, h4, h5, h6) { font-weight: 600; color: var(--ui-text-primary); }
.er-quote :is(ul, ol) { padding-inline-start: 1.2em; }
.er-comment { font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.er-comment.is-empty { color: var(--ui-text-quaternary); }
.er-editor { width: 100%; box-sizing: border-box; resize: vertical; min-height: 54px; font: inherit; font-size: 12.5px; line-height: 1.5; padding: 6px 8px; border-radius: var(--radius-md); border: 1px solid color-mix(in srgb, var(--dt-composer-ring, var(--ui-base)) var(--dt-input-border, 10%), transparent); background: transparent; color: var(--ui-text-primary); box-shadow: var(--dt-input-inset, none); outline: none; transition: border-color 200ms ease-out, box-shadow 200ms ease-out; }
.er-editor::placeholder { color: var(--ui-text-quaternary); }
.er-editor:hover { border-color: color-mix(in srgb, var(--dt-composer-ring, var(--ui-base)) calc(var(--dt-input-border, 10%) * 2), transparent); }
.er-editor:focus, .er-editor.desktop-input-chrome:focus { border-color: ${ACCENT}; box-shadow: 0 0 0 3px ${mix(ACCENT, 16)}; outline: none; }
.er-actions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; animation: er-fade 120ms ease-out; }
.er-actions .er-spacer { flex: 1; }
.er-sessions { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 11px; color: var(--ui-text-tertiary); }
.er-session { font-size: 11px; line-height: 16px; padding: 0 6px; border-radius: var(--radius-md); border: 1px solid ${HAIR}; background: none; color: var(--ui-text-secondary); cursor: pointer; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: border-color 100ms ease-out, color 100ms ease-out; }
.er-session:hover, .er-session:focus-visible { color: var(--ui-text-primary); border-color: ${mix(ACCENT, 60)}; outline: none; transition: none; }
.er-hint { font-size: 11px; color: var(--ui-text-tertiary); }
.er-hint-changed { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.er-group { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--ui-text-tertiary); background: none; border: none; padding: 6px 2px 2px; cursor: pointer; }
.er-group:hover { color: var(--ui-text-secondary); }
.er-group:focus-visible { outline: 1px solid ${mix(ACCENT, 60)}; }
.er-btn-fallback { font-size: 12px; padding: 3px 9px; border-radius: 0; border: none; background: var(--ui-bg-quaternary, none); color: var(--ui-text-primary); cursor: pointer; }
.er-btn-fallback:disabled { opacity: 0.5; cursor: default; }
.er-seg { display: inline-flex; border: 1px solid ${HAIR}; border-radius: var(--radius-md); overflow: hidden; }
.er-seg-btn { font-size: 12px; padding: 2px 10px; background: none; border: none; color: var(--ui-text-secondary); cursor: pointer; }
.er-seg-btn.is-active { background: var(--ui-control-active-background, ${mix(ACCENT, 10)}); color: var(--ui-text-primary); }
.er-spinner { display: inline-block; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--ui-stroke-secondary); border-top-color: ${ACCENT}; animation: er-spin 0.8s linear infinite; }
@keyframes er-spin { to { transform: rotate(360deg); } }
@keyframes er-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes er-pop { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
.er-dcard { display: flex; align-items: center; gap: 10px; padding: 8px 12px; margin: 6px 0; border: 1px solid ${HAIR}; border-radius: var(--radius-md); max-width: 520px; background: var(--ui-widget-surface-background, transparent); }
.er-dcard-main { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.er-dcard-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.er-dcard-sub { font-size: 11px; color: var(--ui-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.er-dcard.is-invalid { color: var(--ui-text-tertiary); font-size: 12px; }
.er-home { padding: 20px 24px; max-width: 720px; display: flex; flex-direction: column; gap: 12px; }
.er-home h2 { font-size: 15px; margin: 0; }
.er-home-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-md); border: 1px solid ${HAIR}; cursor: pointer; background: none; color: inherit; text-align: start; width: 100%; font: inherit; transition: border-color 100ms ease-out, background-color 100ms ease-out; }
.er-home-row:hover, .er-home-row:focus-visible { border-color: var(--ui-stroke-secondary); background: var(--ui-row-hover-background, transparent); outline: none; transition: none; }
.er-settings { display: flex; flex-direction: column; gap: 18px; padding: 4px 0; max-width: 640px; }
/* the host switch does not mirror its thumb in RTL; keep the switch itself LTR (V2.1 overflow, ar) */
.er-settings [role="switch"] { direction: ltr; }
.er-settings-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.er-settings-row label { font-size: 13px; font-weight: 500; }
.er-choice { min-width: 9.5rem; }
.er-choice-native { height: 28px; padding: 0 6px; border: 1px solid ${HAIR}; border-radius: var(--radius-md); background: var(--ui-bg-secondary); color: inherit; font: inherit; }
.er-settings-hint { font-size: 12px; color: var(--ui-text-tertiary); margin-top: 2px; }
.er-settings-degraded { font-size: 12px; color: ${WARN}; }
.er-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
${SEND_MENU_CSS}
${RESIZE_HANDLE_CSS}
@media (prefers-reduced-motion: reduce) {
  .er-page *, .er-dcard, .er-settings * { animation: none !important; transition: none !important; }
  .er-spinner { animation: none; }
}
`
