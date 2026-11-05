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
