# Cloud sync: exploration

Status: **exploration**, 2026-11-05. Goal from the user: link Google Drive and other cloud providers, fully
client-side, so your library follows you between devices and your "account" is the same everywhere.

## Verdict
Feasible with no server. Every endpoint involved accepts browser calls (CORS preflights tested 2026-11-05):

| Endpoint | Preflight from `https://office.daft.onl` |
|---|---|
| `api.dropboxapi.com/oauth2/token` | 200, `*` |
| `content.dropboxapi.com/2/files/upload` | 200, origin echoed |
| `oauth2.googleapis.com/token` | 200, origin echoed |
| `www.googleapis.com/drive/v3/files`, `/upload/drive/v3/files` | 200, origin echoed |
| `login.microsoftonline.com/consumers/oauth2/v2.0/token` | 200, `*` |
| `graph.microsoft.com/v1.0/me/drive/special/approot` | 200, `*` |

## Corrections to the common write-up
- **Google does not refresh silently in the browser.** Google Identity Services gives browser-only apps
  access tokens (about an hour) and **no refresh token**; a new token needs a user gesture. "Hidden iframe" renewal
  is not the GIS model. Design for it: sync keeps queuing locally and shows "Reconnect Google Drive" (one click).
- **Dropbox is the best fit.** PKCE with `token_access_type=offline` gives a refresh token with no app secret;
  access tokens last 4 h and refresh silently.
- **OneDrive (MSAL.js SPA):** refresh tokens last about 24 h, fixed and not sliding; after that the user signs in again.
  Silent renewal is attempted but not guaranteed.
- **Visibility differs:** Google `appDataFolder` (`drive.appdata`, a non-sensitive scope, so only basic verification) is
  hidden from the user. Dropbox `Apps/<name>` and OneDrive `approot` are visible. Hidden is tidy, but users then
  cannot see or rescue their own data from Drive, so we also offer a visible exports folder (`drive.file`).
- **Large files need not sit in memory.** An OPFS `File` is disk-backed; `file.slice()` streams chunks into each
  provider's resumable upload (Dropbox upload sessions, Drive resumable, Graph upload sessions).

## Design sketch
**Never sync the SQLite file.** Two devices editing would mean whole-database last-write-wins. Instead the
cloud folder holds three kinds of objects:

1. **Blobs**: images, media, fonts, by SHA-256. Immutable, upload once, never conflict.
2. **Documents**: one snapshot per deck revision (`docs/<id>/<rev>.json`, per-slide IR plus asset hashes).
   A new revision names its parent. Two revisions from the same parent on different devices = a conflict; at
   first we keep both ("Q3 review (conflict from Laptop)"). Later, per-slide or CRDT merging.
3. **Library log**: append-only small change records (rename, move, star, trash, create) stamped with a hybrid
   logical clock and device id, merged last-writer-wins *per field*. Two devices renaming different decks never collide.

SQLite on each device is a cache rebuilt from these. A new device signs in to a provider, downloads the log and
the latest revision of each document, fetches blobs lazily (covers first), then opens the UI.

**Change detection:** Dropbox `list_folder/continue` cursors, Drive `changes` with `spaces=appDataFolder`,
Graph `delta` on approot. Poll on focus and every few minutes; push changes debounced about 3 s after the last edit.

**Identity:** your account is the provider account. No account of ours exists. Linking a second provider later
can mirror the same workspace.

**Optional end-to-end encryption:** a passphrase-derived key (WebCrypto, PBKDF2/Argon2 → AES-GCM) encrypts
everything before upload, so the provider stores ciphertext only. This is a strong privacy story to pair
with "fully client-side".

## UI surface (to design with the office-ui skill)
- Settings → **Sync**: connect Dropbox / Google Drive / OneDrive, choose hidden or visible folder, encryption.
- Sidebar storage line becomes: "Synced with Dropbox · just now" / "3 changes waiting · Reconnect Google Drive".
- New-device first run: "Open your library from…" with provider buttons beside "Start fresh".
- Conflict copies appear in place with a clear badge and a "Compare" action.

## Other providers worth a look
- **iCloud**: CloudKit JS runs in the browser with the user's Apple ID private database.
- **Any synced desktop folder** (iCloud Drive, Dropbox desktop, Syncthing) via the File System Access API on
  Chromium: the "Automatic PPTX copies" idea in VISION.md, extended to the full workspace.
