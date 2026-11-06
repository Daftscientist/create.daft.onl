# Review log

One row per adversarial review run. "New" counts confirmed findings not raised by an earlier run or lower
effort on the same subject, which is how we learn whether escalating reasoning pays off.

| Date | Subject | Reviewer | Effort | Raised | Confirmed | New | Notes |
|---|---|---|---|---|---|---|---|
| 2026-11-05 | VISION v1 | Claude subagent (general-purpose) | — | 21 | 20 | 21 | Unique: multi-tab OPFS lock, focus vs coral, toast/selection-bar stacking, veil vs folder targets |
| 2026-11-05 | VISION v1 | Codex gpt-6.1-sol | high | 19 | 19 | 6 | Unique: Home vs Files IA, shell switching/tablets, gesture arbitration, mobile Present + new-deck-to-editor, foundations table, stable sorting |

## Triage of VISION v1 → v2

Accepted (both reviewers unless noted): storage/backup as UI (blocker) · truthful engine states · measured
contrast · material tiers (solid sidebar) · Finder activation model + Quick Look · command inventory · mobile tabs as
destinations only · folder silhouette + spring-loaded drop · static ground · slide-level search · import failure states ·
lists at scale · reduced-motion coverage · faithful document colours · Home vs Files (Codex) · shell switching (Codex) ·
gesture arbitration (Codex) · Present button / new deck → editor (Codex) · foundations table (Codex) · multi-tab
ownership (Claude) · focus ring gap + selection badge (Claude) · bottom stack rules (Claude) · veil vs folder (Claude).

Modified: both said to remove one-click downloads from cards. **Kept**, because the user asked for one-click PPTX/HTML
download with real marks, but made always visible, labelled by format, with no hidden remembered default.

Went further than asked: Claude proposed Quick Look as the main preview with hover-scrub kept as secondary; hover-scrub is
dropped entirely, since both reviewers showed it changes a file's identifying cover on mere hover.
| 2026-11-05 | VISION v2 | Codex gpt-6.1-sol | xhigh | 14 | 14 | 14 | Escalation paid off: zero overlap with round 1. Unique: storage-full rescue, keep originals, "sync" contract, restore merge, new-tab read-only viewers, offline engine readiness, Enter open-vs-rename conflict, creation destination in derived views, mobile Files/New folder, Edit entry, Select mode exits, drops over cards, glass budget on mobile, full names on touch |

## Triage of VISION v2 (xhigh)

Adopted into DESIGN.md now (UI phase): keyboard map (Enter open, F2 rename, Space Quick Look, ⌘/Ctrl-Space toggle,
⇧-arrows extend) · "Recents" and "Files" as the only names in both shells · creation from derived views targets the
Files root and says so · external drops accepted over the whole content area, folders override · toasts and ⌘K are
solid (glass budget) · full name at the top of every action sheet · mobile Select mode: Done, Select all, disabled at
zero · Download original kept for imported decks · Restore beside Back up.

Deferred to the business-logic phase (recorded in VISION.md §Engine-phase contracts): storage-full rescue state ·
"Automatic PPTX copies" contract instead of "sync" · restore preview/merge rules · read-only viewers for new tabs and
explicit ownership transfer · offline engine readiness ("Connect once to enable import and export offline") ·
mobile Edit entry once the editor exists.
| 2026-11-05 | Built home UI (screenshots) | Codex gpt-6.1-sol | high | 21 | 21 | 21 | First post-build run. Found a data bug (folder trash not subtree-aware), contrast failures (--ink-3 3.2:1, select 3.8:1 on ground), a11y (aria-hidden slides, div rows), missing mobile Rename, unconfirmed permanent delete, drag dwell ending the drag, list-row overflow near breakpoint |

## Triage of built UI (high)
All 21 accepted. Fixed in this pass: 1–8, 10–12, 14–19, 20 (label), 21; 9 (scroll restore on return + Back exits Select mode); 13 (palette creation honours the current folder).
Deferred: 9 (preserving selection/overlays across a shell switch), 13 (selected-file commands inside ⌘K), 20 (explanation panel for simplified slides needs real coverage data from the engine).
| 2026-11-05 | Specs: settings + AI panel | Claude subagent | — | 24 | 24 | 24 | Staleness-based prompting, connect/merge sheet, account mismatch, SyncStatus in deck header, --warn token, Notice primitive, provider honesty ranking |
| 2026-11-05 | Specs: settings + AI panel | Codex gpt-6.1-sol | high | 24 | 24 | 7 | Overlapped Claude on 17. New: device-vs-library IA, scoped local data removal, multi-dimensional status, restore preview flow, no shimmer, Demo agent label, stable slide-ID context |
| 2026-11-06 | Spec: deck editor (phase plan + phase 1) | Claude subagent | — | 22 | 21 | 22 | Per-node IR exactness, export-time IR op batch (no Python on interaction path), transactional undo with origins, AI-run slide lock, honest saving, Esc ladder, blob store, units in pt/cm/in, halo + magenta guides |
| 2026-11-06 | Spec: deck editor (phase plan + phase 1) | Codex gpt-6.1-sol | high | 23 | 22 | 11 | Overlapped Claude on 12. New: three text-formatting targets with selection bookmark, union geometry rules, select-under + object list, Present mode, rail state model, section order by selection, group/lock/align in phase 1; crop deferred, formatting dock rejected |
| 2026-11-06 | Deck editor (built, phase 1 + later-phase features) | Codex GPT 6.1 Sol | high | 24 raised / 21 confirmed (2 blockers: stage hidden from screen readers; property changes during text editing overwritten by the next text save). Fixed: accessible object list + announcements, commit-before-op, own text-edit history, exact-occurrence replace, viewer read-only paths, honest saving while typing + rescue download, text-first/arrange-first section order, vertical-align state, proportional multi resize (drag and typed), object list beside properties + rename, rail focus, text-bar focus return and placement, unit-aware arrow steps, contrast (text-bar labels, distance pills), dark-mode transparency fallback, Format from 1100px, Present suspends editor keys + solid Exit, two-layer transitions, honest a11y copy, blue focus (DESIGN.md), light-mode paper shadow. Deferred: remote-change conflict notice, mixed states across a selection, scrub preview/cancel, snap hysteresis | first level |
| 2026-11-06 | Deck editor (built, after round-1 fixes) | Codex GPT 6.1 Sol | xhigh | 18 raised / 18 confirmed, 9 new vs high (text edit hidden from screen readers; viewer bypasses via Find and drops; negative chart values; header Undo vs text history; Arrange vs canvas bounds for rotated members; column docking at 1180px; field accessible names; pressed vs hover state; app Reduce motion in Present; phone Present). All fixed: live editor exposed as a labelled textbox, read-only enforced at the op boundary, signed chart axes, header Undo uses the text's history, one bounds calculation, dock only with ≥640px of slide, named fields and labelled rows, distinct pressed style, app motion setting honoured, phone Present uses the full show; plus mixed states across a selection, one persistent object navigator, paragraph-level find with highlight, overflow marker and auto-grow after any change, more text-bar positions, honest Morph label, scrub with preview and Esc, per-deck session restore. xhigh found more than high: worth escalating for core surfaces | second level |
