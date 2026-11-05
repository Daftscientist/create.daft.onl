# Spec: Settings, storage and cloud sync

Status: draft for review, 2026-11-05. Constraints: DESIGN.md, VISION.md, docs/architecture/SYNC.md.

## Entry points
| Where | Element | Why there |
|---|---|---|
| Desktop sidebar footer | Gear `IconButton` beside the storage/sync status, label "Settings", hint ⌘, | The footer already speaks about storage and sync, the things settings mostly control (Superlist, Linear put settings at the sidebar foot). |
| Desktop | ⌘, (Ctrl+,) anywhere; "Settings" in ⌘K | macOS convention. |
| Mobile | "Settings" row at the bottom of the Files root, under the storage card; also in search actions | Files is where storage lives; no avatar exists because there is no account. |

## Layout
- **Desktop**: route `/settings/<section>`. The library sidebar is replaced by a settings sidebar (same component and
  metrics as the library sidebar): "← Library" back row, then sections. The panel shows one section at a time, max
  width 680px, left aligned. No modal: settings has enough depth to deserve a page, and links/back must work.
- **Mobile**: `/settings` is a grouped list (iOS Settings convention) pushing to `/settings/<section>` with LargeTitle and BackButton.
- Every control writes immediately (no Save button), with a toast only for actions that do work (backup, connect).

## Sections and rows
Rows use one shared `SettingRow` (label, description under it, control on the right; stacks on mobile).

1. **General**: Appearance (System / Light / Dark segmented) · Default download format (PowerPoint / HTML) ·
   Open decks in (Viewer / Editor, once the editor exists, hidden until then) · Reduce motion (System / On).
2. **Storage**: usage meter (decks, media, fonts, from `navigator.storage.estimate`), "Persistent storage: On / Ask
   browser" with a button that calls `navigator.storage.persist()` · Back up now · Restore from backup… · Last backup time ·
   Export every deck (.zip of .pptx). Danger zone (separate group, `--danger` text): "Delete all local data…" with
   a typed confirmation.
3. **Sync** (see flow below): providers list (Dropbox, Google Drive, OneDrive) as cards with mark, status line,
   and Connect / Disconnect · Folder visibility (Hidden app folder / Visible "Ream" folder) · End-to-end encryption
   (off by default; turning on asks for a passphrase twice and warns it cannot be recovered) · "Sync now" · This device's name.
4. **AI**: "Coming later" note at the top in this phase. Providers list (ChatGPT plan, OpenAI API key, Anthropic API key,
   OpenRouter, Local model) each with Connect / key field, stored only in this browser; default model picker.
   Shown so the shape is reviewable; marked as preview, actions disabled with a clear reason.
5. **Keyboard shortcuts**: read-only reference generated from the same keymap the app uses.
6. **About**: version, "Everything stays on this device unless you connect a sync provider", open-source link, licences.

## Sync status and reconnect flow
States per provider: `syncing` · `up to date` · `waiting (n changes)` · `needs reconnect` · `offline` · `error` · `conflict`.

| Surface | Shows | Behaviour |
|---|---|---|
| Sidebar footer status (always) | Dot + one line: "Synced with Dropbox · just now", "Syncing 3 changes…", "Offline · 3 changes waiting", "**Reconnect Google Drive** · 3 changes waiting" | Amber dot for needs-reconnect, red for error. The line is a button: reconnect states start the reconnect directly (it is a user gesture, which Google requires); others open Settings → Sync. |
| Reconnect banner (first load) | Slim paper banner at the top of the panel: "Google Drive needs you to reconnect to bring in changes from your other devices." [Reconnect] [Not now] | Only when a provider was linked and has no valid token at boot. "Not now" hides the banner for this session; the footer status stays amber. Never a modal: the library is fully usable offline. |
| Token expires mid-session | One toast "Google Drive disconnected · Reconnect" (action). Not repeated in the same session. | Changes keep queueing locally; the footer shows the waiting count. |
| Mobile | Same banner atop Recents; status + Reconnect inside the Files storage card. | |
| New device, first run | Empty state offers "Open your library from Dropbox / Google Drive / OneDrive" beside Import and New deck. | Pulls the library before showing it, with phase progress. |
| Conflict | The conflicting copy appears in place with a "Conflict" badge: "Q3 review (from Laptop)". Menu adds "Compare…" and "Keep this one". | Never silently overwrites. |

## Naturalness references
Linear and Raycast settings (full page, sectioned sidebar), iOS Settings (mobile grouped lists), Dropbox and Obsidian Sync
(status line, conflict copies), 1Password (encryption warning language).

## Review round 1 (Claude subagent, 24 findings): decisions now binding
- **Banner on staleness, not token** (blocker): Google tokens last ~1h, so token-invalid is true on almost every load.
  Show the first-load `Notice` only when local changes are waiting, or the last successful pull is >12h old and another
  device has been active since. Copy is about staleness: "Last synced with Google Drive 2 days ago. Reconnect to bring in
  changes from Laptop." After two "Not now", stay quiet until a new reason appears. Offline suppresses all prompts.
- **Connect sheet** after OAuth, before first sync: "Merge with the library in Google Drive" (default; keeps both, marks
  conflicts) · "Use only the library in Google Drive" (requires a backup first, inline Back up) · "Upload this library"
  (only when the remote is empty). First upload shows phase + bytes.
- **OAuth outcomes**: popup blocked (inline retry, a new gesture) · cancelled (silent, back to amber) · scope unticked
  ("Ream needs access to its app folder") · **different account** (refuse: "That's ana@…, this library syncs with leo@…").
  The linked account email shows on the provider card and in the notice.
- **`SyncStatus` composition** used in the sidebar footer AND the deck header subtitle ("Edited just now · Not synced
  · Reconnect"). The line opens Settings → Sync; "Reconnect" is a separate text button (the OAuth gesture).
  Priority: locked > needs reconnect > error > conflict > offline > syncing > up to date. v1: one provider at a time.
  When connected, the sync line replaces "Stored in this browser"; Back up moves into the ⋯ menu.
- **`--warn` token** (ochre, distinct from Deck coral, ≥3:1 on frame/panel) and always paired with an icon
  (CloudSlash/CloudWarning); colour is never the only cue.
- **`Notice` primitive** in ui/ (paper, icon, message, ≤2 actions, dismiss) for reconnect, persistence-denied and
  quota notices. Decided synchronously at first paint; scrolls with content; on mobile sits under the large title.
- **Error table with copy**: revoked access → needs reconnect · provider full ("Google Drive is full · 3 changes
  waiting [Open Google Drive]") · folder deleted remotely ("Ream's folder was deleted from Dropbox [Upload again]") ·
  rate limited (silent retry with backoff) · local quota full during pull. Conflict footer: "2 conflicts · Review"
  (filters Files). "Keep this one" moves the other copy to Trash with Undo. "Compare…" cut from v1.
- **Locked state** for encrypted libraries: "Dropbox library is encrypted · Enter passphrase"; wrong passphrase stays
  inline and never clears the field; enabling shows "Encrypting 214 files · 38%"; passphrase change re-wraps the key only.
- **Folder visibility** only on the Google card: "Also keep PowerPoint copies in a visible “Ream” folder" (asks for
  `drive.file` when switched on). Dropbox/OneDrive cards: "Stored in Apps/Ream [Open in Dropbox]".
- **Connect sheet ranks providers honestly**: "Dropbox: stays connected" · "OneDrive: sign in about daily" ·
  "Google Drive: reconnect about hourly when changes are waiting". Dropbox is the default recommendation, and on iPhone
  Home Screen installs Google may not work (to be tested on a real phone).
- **Mid-session toast**: "Google Drive paused · Reconnect", 10s, only when a change is actually waiting, deferred during Present.
- **New device**: show the library as soon as the log arrives; covers fill in; footer "Bringing in 214 decks · 38%".
- **Removed**: "Default download format" (contradicts always-visible format buttons). AI section only behind `?preview=ai`.
- **Mobile**: gear IconButton (44px) in the Files header; storage/sync card above the entries under Starred/Trash.
  Segmented gets `size="lg"` (44px). Settings returns to the route it was opened from; Esc leaves on desktop.
  "Delete all local data" copy names what happens to the cloud copy.
