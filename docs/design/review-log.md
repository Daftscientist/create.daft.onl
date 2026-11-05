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
