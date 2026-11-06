# Accounts (spec)

Status: building, 2026-11-06. Replaces the "local library + optional sync to one provider" model.

## The idea (from the user)
You sign in to Ream with **Dropbox, Google Drive, OneDrive, or locally**. Whatever you choose *is* the backing
of the app: no "local filesystem plus remote sync" framing. You can be signed in to several at once (several of
each provider, and several isolated local accounts), and switch between them with a picker. Third-party accounts
show their profile picture; local accounts get a generated monogram. When an account's session isn't valid, Ream
says so before you act, and switching to it walks you through signing in again.

## Model
- `Account = { id, kind: 'local' | 'dropbox' | 'google' | 'onedrive', name, email?, avatar?, hue, remoteId?, addedAt }`.
  Registry in `localStorage['ream.accounts.v1'] = { accounts, active }`.
- **Every account is an isolated library on this device.** Its own SQLite file in its own OPFS pool directory, its own
  blob directory, its own sync base, sync state, provider tokens and encryption key. Tabs can have different
  accounts open at once (the single-tab lock is per account).
- A cloud account's local library is a cache of the cloud copy (offline first, edits never wait on the network). Only
  the active account syncs.
- The first account has id `default` and uses the pre-accounts storage names, so existing libraries migrate with no
  copying: a local-only library becomes a local account "This device"; a library linked to Dropbox/Drive/OneDrive
  becomes that provider's account (name, email, avatar from the old sync state).
- AI settings (provider keys, models, voice) live in each account's library and sync with it (the design from
  docs/architecture/AI.md: a key added on one device works on the others). Open question for the user: keys in a
  cloud account are stored readable by that provider unless end-to-end encryption is on.
- Switching account first ends text editing and waits for every write to reach storage (a failed save cancels the
  switch), then reloads into it. Each tab remembers its own account (sessionStorage); the registry's `active` is only
  what a fresh launch opens. Registry writes re-read first; the legacy `default` id is used once, ever.

## Session validity
| Provider | Lasts | When the switcher opens | Picking an invalid one |
|---|---|---|---|
| Dropbox | refresh token, silent | refresh attempted silently | sign-in window (forced reauth to the same account) |
| OneDrive | ~24 h refresh token | `acquireTokenSilent` | sign-in window with that account hinted |
| Google | ~1 h, no refresh | token expiry checked | Google's window with `login_hint`; usually one click |

- Invalid rows show an amber "Sign in again" under the email. Choosing one opens the provider's window in the click
  (popup blockers need the gesture), then switches. Cancelling leaves you where you were, with an inline
  "Open this device's copy" (changes wait until you sign in).
- Signed in as the **wrong** provider account (e.g. picked another Google account in the window): say so
  ("That's a different Google account: alex@… is already added / was added") and add it as its own account
  instead of mixing libraries.
- While the active account is invalid: amber dot on the avatar everywhere it shows; the account menu's top row says
  "Signed out of Dropbox · 3 changes waiting" with **Sign in again**; the existing in-flow notice and first-edit
  toast stay. Edits are never blocked (they're local first).

## Surfaces
### First run (no accounts, no old library)
One screen, the only time Ream shows something before your files: "Where should Ream keep your work?" Four large
rows: Dropbox (recommended: stays signed in), Google Drive, OneDrive, On this device. Each row: provider mark, name,
one-line truth ("Stays signed in", "Signs you out about hourly", "Sign in about once a day", "Private to this
browser; back it up yourself"). Picking a cloud opens its window; success goes straight to the files (with
"Getting your library from Dropbox…" while the first pull runs). Local asks nothing.

### Account switcher
- **Desktop**: top of the sidebar replaces the brand lockup: avatar (24) + account name + caret, Settings gear stays
  to its right. Convention: Notion/Slack workspace switcher. Click → popover (300 wide):
  - Header card: avatar 40, name, email or "On this device", provider badge, status line (Synced · just now /
    Signed out · Sign in again / Offline).
  - Other accounts: one row each (avatar 28 with provider badge at its corner, name, email, status). ⌘1–9 hints.
  - "Add account" (opens the chooser dialog: the same four rows as first run, plus "Another local account").
  - "Manage accounts" → Settings → Accounts.
- **Mobile**: avatar (32) at the right of the Home and Files headers, before the gear. Tap → bottom sheet with the
  same content; rows ≥ 56 tall.
- Avatars: provider photo (`referrerPolicy=no-referrer`, falls back to monogram on error). Local: monogram (first
  letter) on a soft gradient from the account's hue; a small laptop glyph badge. Cloud badges are the provider mark.

### Settings → Accounts (replaces Sync)
One card per account: avatar, name (editable for local), email, provider, status, last sync, storage used on this
device. Actions: Switch to, Sign in again (when invalid), Sync now (active), Encryption (cloud), Remove from this
device (confirm: "Deletes this device's copy. Your files stay in Dropbox." / local: "Deletes everything in it.
Download a backup first."). Device name stays (it labels conflicts).

## States
Switching (brief "Opening Alex's Dropbox…" overlay until reload), first pull (progress in the status line),
offline (switch still works: opens the device copy), locked (encrypted: passphrase on open), removing the active
account (switches to the next, or first-run if none).

## Review (2026-11-06, Codex high, pre-build)
17 findings. Accepted and built: verified re-sign-in (staged credentials restored on a different person's sign-in,
remoteId filled on first silent check), no borrowed Dropbox refresh tokens, transient errors are not "signed out",
per-tab account, registry re-read writes + legacyClaimed, save barrier before switching, OPFS probe adopts a
pre-accounts library, removal forgets credentials locally (never revokes), OneDrive never falls back to the first
cached account, per-attempt popup names + COOP-safe close detection + cancel that invalidates a late sign-in,
"Open without signing in" offered before any popup, Google wording "access expired", real backup file.
Deferred (pre-existing sync engine, own task): resumable encryption generations, immutable doc revisions, Google
non-atomic conditional writes, in-flight local edits during sync, sync gated on ownership/boot, cooperative tab
handoff. Rejected: none outright; ⌘1–9 was never built.
