// The sync engine, v2 (docs/architecture/SYNC.md). A cloud account's storage is the source of truth; this device
// keeps a small index (sync state below) and a cache (the library), and asks the provider only what changed since
// last time: Dropbox list_folder cursors, Drive changes.list page tokens, Graph delta links. A reload with nothing
// new costs one request.
//
// Cloud layout, flat in the provider's app folder:
//   ream.e.<id>.json          one deck or folder: its details, clock and device, and which content revision it uses
//   ream.d.<id>.<rev>.json    one deck's content (slides, theme), immutable: a new revision is a new file, written
//                             before the entry points at it, so a half-finished sync never leaves an entry pointing
//                             at content that isn't there, and two devices can't overwrite each other's content
//   ream.c.<deckId>.json      Ask's conversation for a deck
//   ream.settings.json        the account's settings (AI, appearance)
//   ream-key.json             only with end-to-end encryption: salt and check value, never the key
// Entry writes are conditional on the revision last seen (atomic on Dropbox and OneDrive; checked first on Drive).
// Libraries synced by v1 (ream-entries.json + ream-doc-<id>.json) are read once and rewritten in this layout.
import { scoped } from './accounts'
import { isSealed, open, seal, type KeyFile } from '../cloud/crypto'
import { CursorReset, RemoteConflict, type ChangeFeed, type CloudDrive } from '../cloud/types'
import { addConflictCopy, applyRemote, applyRemoteChats, applyRemoteSettings, getLibrary } from './library'
import type { Chat, Deck, Entry } from './types'

export const KEYFILE = 'ream-key.json'
const SETTINGS = 'ream.settings.json'
const LEGACY_ENTRIES = 'ream-entries.json'
const entryName = (id: string) => `ream.e.${id}.json`
const docFile = (id: string, rev: string) => `ream.d.${id}.${rev}.json`
const chatName = (id: string) => `ream.c.${id}.json`
const kindOf = (name: string): { kind: 'entry' | 'chat'; id: string } | { kind: 'settings' | 'doc' | 'other' } => {
  let m = /^ream\.e\.(.+)\.json$/.exec(name)
  if (m) return { kind: 'entry', id: m[1] }
  m = /^ream\.c\.(.+)\.json$/.exec(name)
  if (m) return { kind: 'chat', id: m[1] }
  if (name === SETTINGS) return { kind: 'settings' }
  return /^ream\.d\./.test(name) ? { kind: 'doc' } : { kind: 'other' }
}

type Meta = Omit<Deck, 'slides' | 'css' | 'size' | 'remote' | 'docRev'> | Entry
type RemoteEntry = { v: 2; id: string; clock: number; device: string; deleted?: true; entry?: Meta; doc?: { rev: string; clock: number } }
type Content = Pick<Deck, 'slides' | 'css' | 'size'> & { docClock?: number }

/** What this device knows about the account's storage: the provider's cursor, the revision of each file it has
 *  taken in, and per entry what was last in sync (so a change here and a change there can be told apart). */
type State = {
  cursor: string | null
  revs: Record<string, string>
  base: Record<string, { clock: number; docRev?: string; docClock?: number }>
  settingsClock: number
  chats: Record<string, number>
}
const STATE_KEY = scoped('ream.sync.v2')
const empty = (): State => ({ cursor: null, revs: {}, base: {}, settingsClock: 0, chats: {} })
export function loadState(): State {
  try { return { ...empty(), ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') } } catch { return empty() }
}
const saveState = (s: State) => localStorage.setItem(STATE_KEY, JSON.stringify(s))
export const resetState = () => localStorage.removeItem(STATE_KEY)

/** Local changes not yet in the account's storage. */
export function pendingCount(): number {
  const lib = getLibrary(), st = loadState()
  let n = 0
  for (const e of Object.values(lib.entries)) if ((e.clock ?? 0) > (st.base[e.id]?.clock ?? 0)) n++
  for (const [id, t] of Object.entries(lib.tombstones ?? {})) if (t > (st.base[id]?.clock ?? 0)) n++
  for (const [id, c] of Object.entries(lib.chats ?? {})) if (c.clock > (st.chats[id] ?? 0)) n++
  if ((lib.settings?.clock ?? 0) > st.settingsClock) n++
  return n
}

const meta = (e: Entry): Meta => (e.type === 'deck' ? (({ slides: _s, css: _c, size: _z, remote: _r, docRev: _d, ...m }) => m)(e) : e)

export type SyncContext = { drive: CloudDrive; device: string; deviceName: string; key: CryptoKey | null }

async function read<T>(ctx: SyncContext, name: string): Promise<{ data: T; rev: string } | null> {
  const got = await ctx.drive.get(name)
  if (!got) return null
  let text = got.text
  if (isSealed(text)) {
    if (!ctx.key) throw Object.assign(new Error('Library is encrypted'), { name: 'Locked' })
    text = await open(ctx.key, text)
  }
  return { data: JSON.parse(text) as T, rev: got.rev }
}
async function write(ctx: SyncContext, name: string, data: unknown, ifRev?: string | null) {
  const text = JSON.stringify(data)
  return ctx.drive.put(name, ctx.key ? await seal(ctx.key, text) : text, ifRev)
}
export async function readKeyFile(drive: CloudDrive): Promise<KeyFile | null> {
  const got = await drive.get(KEYFILE)
  return got ? (JSON.parse(got.text) as KeyFile) : null
}

/** A few at a time: providers throttle bursts, and one slow file shouldn't hold up the rest. */
async function each<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}
const newRev = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** One deck's content from the account (for decks whose slides aren't on this device yet). */
export async function fetchContent(ctx: SyncContext, id: string, rev: string): Promise<Content | null> {
  return (await read<Content>(ctx, docFile(id, rev)))?.data ?? null
}

export type SyncResult = { pulled: number; pushed: number; conflicts: number; first: boolean }

/** One sync: what changed there comes in, what changed here goes out. `onFirst` reports progress only for an
 *  account's first sync on this device (later syncs are silent). */
export async function syncOnce(ctx: SyncContext, onFirst?: (label: string, done: number, total: number) => void): Promise<SyncResult> {
  const st = loadState()
  const first = st.cursor === null && !Object.keys(st.base).length
  let feed: ChangeFeed
  try { feed = await ctx.drive.changes(st.cursor) } catch (e) {
    if (!(e instanceof CursorReset)) throw e
    feed = await ctx.drive.changes(null)
  }
  // A full listing (first sync, or the provider reset the cursor) tells us which files exist; anything we knew of
  // that isn't listed is gone.
  if (feed.full) for (const name of Object.keys(st.revs)) if (!feed.changed.some((f) => f.name === name)) delete st.revs[name]
  for (const name of feed.removed) delete st.revs[name]

  const fresh = feed.changed.filter((f) => st.revs[f.name] !== f.rev)
  const entryFiles = fresh.filter((f) => kindOf(f.name).kind === 'entry')
  const chatFiles = fresh.filter((f) => kindOf(f.name).kind === 'chat')
  const settingsFile = fresh.find((f) => f.name === SETTINGS)

  // ---- a library synced by v1: take it in once, then it's written out in this layout below ----
  let legacy: Entry[] = []
  if (feed.full && !feed.changed.some((f) => kindOf(f.name).kind === 'entry') && feed.changed.some((f) => f.name === LEGACY_ENTRIES)) {
    legacy = await readLegacy(ctx, onFirst)
  }

  // ---- in: entries changed elsewhere ----
  const lib = getLibrary()
  const captured = new Map(Object.values(lib.entries).map((e) => [e.id, e.clock ?? 0]))
  const remotes: { r: RemoteEntry; rev: string; name: string }[] = []
  let done = 0
  await each(entryFiles, 6, async (f) => {
    const got = await read<RemoteEntry>(ctx, f.name)
    if (got) remotes.push({ r: got.data, rev: got.rev, name: f.name })
    if (first) onFirst?.('Getting your library', ++done, entryFiles.length)
  })
  // v1 decks this device already has (it was syncing them) stay as they are here; they're all written out below.
  const upserts: Entry[] = legacy.filter((e) => !lib.entries[e.id]), deletes: string[] = [], conflicts: Deck[] = []
  const contentNow: { id: string; rev: string; deck: Deck }[] = []
  const theirCopies: { r: RemoteEntry; rev: string }[] = []
  // First sync: the most recent decks come with their slides; the rest arrive in the background (and on open).
  const recent = new Set(remotes.filter((x) => x.r.entry?.type === 'deck' && !x.r.deleted).sort((a, b) => ((b.r.entry as Deck).openedAt ?? (b.r.entry as Deck).modifiedAt) - ((a.r.entry as Deck).openedAt ?? (a.r.entry as Deck).modifiedAt)).slice(0, 8).map((x) => x.r.id))
  for (const { r, rev, name } of remotes) {
    st.revs[name] = rev
    const L = lib.entries[r.id], B = st.base[r.id], T = lib.tombstones?.[r.id]
    const localClock = L?.clock ?? T ?? 0
    const localDirty = localClock > (B?.clock ?? 0)
    const remoteWins = !localDirty || r.clock > localClock || (r.clock === localClock && r.device > ctx.device)
    if (!remoteWins) {
      // Ours is newer and goes out below. If both sides changed the slides since they last agreed, theirs is kept
      // as a copy here (and reaches the other device as a new deck) instead of being overwritten.
      if (r.doc && r.entry?.type === 'deck' && L?.type === 'deck' && !L.remote && r.doc.rev !== B?.docRev && (L.docClock ?? 0) > (B?.docClock ?? 0)) theirCopies.push({ r, rev: r.doc.rev })
      continue
    }
    st.base[r.id] = { clock: r.clock, docRev: r.doc?.rev, docClock: r.doc?.clock }
    if (r.deleted || !r.entry) { if (L) deletes.push(r.id); continue }
    if (r.entry.type === 'folder') { upserts.push({ ...r.entry, clock: r.clock, device: r.device } as Entry); continue }
    const local = L?.type === 'deck' ? L : undefined
    const docChanged = !!r.doc && r.doc.rev !== local?.docRev
    // Both sides changed the slides since they last agreed: this device's version is kept as a copy.
    if (docChanged && local && !local.remote && (local.docClock ?? 0) > (B?.docClock ?? 0)) conflicts.push(local)
    const deck: Deck = { ...(local ?? { slides: [], lastSlide: 0, status: 'ready', sizeBytes: 0 }), ...(r.entry as Deck), clock: r.clock, device: r.device, docClock: r.doc?.clock ?? local?.docClock, docRev: r.doc?.rev ?? local?.docRev } as Deck
    if (docChanged && r.doc) {
      if (!first || recent.has(r.id)) contentNow.push({ id: r.id, rev: r.doc.rev, deck })
      else upserts.push({ ...deck, remote: true })
    } else upserts.push(deck)
  }
  done = 0
  await each(contentNow, 4, async ({ id, rev, deck }) => {
    const c = await fetchContent(ctx, id, rev)
    upserts.push(c ? { ...deck, slides: c.slides, css: c.css, size: c.size, remote: undefined } : { ...deck, remote: true })
    if (first) onFirst?.('Getting your decks', ++done, contentNow.length)
  })
  // Anything edited here while those requests were out stays as edited (it goes out next time).
  const now = getLibrary().entries
  const safe = upserts.filter((e) => !captured.has(e.id) || (now[e.id]?.clock ?? 0) === captured.get(e.id))
  applyRemote({ upserts: safe, deletes: deletes.filter((id) => (now[id]?.clock ?? 0) === captured.get(id)) })
  for (const c of conflicts) addConflictCopy(c, ctx.deviceName)
  for (const { r, rev } of theirCopies) {
    const c = await fetchContent(ctx, r.id, rev)
    if (c) addConflictCopy({ ...(r.entry as Deck), slides: c.slides, css: c.css, size: c.size } as Deck, 'another device')
  }

  // ---- in: settings and conversations ----
  if (settingsFile) {
    const got = await read<{ clock?: number }>(ctx, SETTINGS)
    if (got) {
      st.revs[SETTINGS] = got.rev
      const localClock = getLibrary().settings?.clock ?? 0
      if ((got.data.clock ?? 0) > localClock) { applyRemoteSettings(got.data); st.settingsClock = got.data.clock ?? 0 }
    }
  }
  if (chatFiles.length) {
    const changed: Record<string, Chat | null> = {}
    await each(chatFiles, 4, async (f) => {
      const id = (kindOf(f.name) as { id: string }).id
      const got = await read<Chat>(ctx, f.name)
      if (!got) return
      st.revs[f.name] = got.rev
      const mine = getLibrary().chats?.[id]
      if (!mine || got.data.clock > mine.clock) { changed[id] = got.data.turns.length ? got.data : null; st.chats[id] = got.data.clock }
    })
    if (Object.keys(changed).length) applyRemoteChats(changed)
  }

  // ---- out: what changed here ----
  const pushed = await pushLocal(ctx, st)
  st.cursor = feed.cursor
  saveState(st)
  return { pulled: safe.length + deletes.length, pushed, conflicts: conflicts.length + theirCopies.length, first }
}

async function pushLocal(ctx: SyncContext, st: State): Promise<number> {
  const lib = getLibrary()
  let pushed = 0
  const dirty = Object.values(lib.entries).filter((e) => (e.clock ?? 0) > (st.base[e.id]?.clock ?? 0))
  const conflict = { hit: false }
  await each(dirty, 4, async (e) => {
    const B = st.base[e.id]
    let docRev = e.type === 'deck' ? e.docRev ?? B?.docRev : undefined
    const oldRev = docRev
    // New content goes to a new file first; the entry then points at it.
    if (e.type === 'deck' && !e.remote && (!docRev || (e.docClock ?? 0) > (B?.docClock ?? -1))) {
      docRev = newRev()
      await write(ctx, docFile(e.id, docRev), { slides: e.slides, css: e.css, size: e.size, docClock: e.docClock } satisfies Content, null)
    }
    const name = entryName(e.id)
    const file: RemoteEntry = { v: 2, id: e.id, clock: e.clock ?? 0, device: e.device ?? ctx.device, entry: meta(e), ...(e.type === 'deck' && docRev ? { doc: { rev: docRev, clock: e.docClock ?? 0 } } : {}) }
    try {
      const res = await write(ctx, name, file, st.revs[name] ?? null)
      st.revs[name] = res.rev
    } catch (err) {
      if (!(err instanceof RemoteConflict)) throw err
      // Changed elsewhere since we last looked: the next sync takes theirs in first and decides.
      conflict.hit = true
      if (docRev !== oldRev) await ctx.drive.remove(docFile(e.id, docRev!)).catch(() => {})
      return
    }
    st.base[e.id] = { clock: file.clock, docRev, docClock: file.doc?.clock }
    if (e.type === 'deck' && docRev !== e.docRev) applyRemote({ upserts: [{ ...(getLibrary().entries[e.id] as Deck), docRev }], deletes: [] })
    if (oldRev && oldRev !== docRev) await ctx.drive.remove(docFile(e.id, oldRev)).catch(() => {})
    pushed++
  })
  // Deleted for good here.
  for (const [id, t] of Object.entries(lib.tombstones ?? {})) {
    if (t <= (st.base[id]?.clock ?? 0)) continue
    const name = entryName(id)
    try {
      const res = await write(ctx, name, { v: 2, id, clock: t, device: ctx.device, deleted: true } satisfies RemoteEntry, st.revs[name] ?? null)
      st.revs[name] = res.rev
    } catch (err) { if (err instanceof RemoteConflict) { conflict.hit = true; continue } throw err }
    const rev = st.base[id]?.docRev
    if (rev) await ctx.drive.remove(docFile(id, rev)).catch(() => {})
    st.base[id] = { clock: t }
    pushed++
  }
  // Settings and conversations.
  const settings = lib.settings ?? {}
  if ((settings.clock ?? 0) > st.settingsClock) {
    try { st.revs[SETTINGS] = (await write(ctx, SETTINGS, settings, st.revs[SETTINGS] ?? null)).rev; st.settingsClock = settings.clock ?? 0; pushed++ }
    catch (err) { if (!(err instanceof RemoteConflict)) throw err; conflict.hit = true }
  }
  for (const [id, c] of Object.entries(lib.chats ?? {})) {
    if (c.clock <= (st.chats[id] ?? 0)) continue
    const name = chatName(id)
    try { st.revs[name] = (await write(ctx, name, c, st.revs[name] ?? null)).rev; st.chats[id] = c.clock; pushed++ }
    catch (err) { if (!(err instanceof RemoteConflict)) throw err; conflict.hit = true }
  }
  return pushed
}

/** v1 libraries: one entries file plus a content file per deck. Read once; everything is marked as changed here so
 *  the v2 files get written. */
async function readLegacy(ctx: SyncContext, onFirst?: (label: string, done: number, total: number) => void): Promise<Entry[]> {
  type V1 = { entries: Record<string, { entry?: Meta; clock: number; device: string; deleted?: true }> }
  const got = await read<V1>(ctx, LEGACY_ENTRIES)
  if (!got) return []
  const live = Object.entries(got.data.entries).filter(([, r]) => !r.deleted && r.entry)
  const out: Entry[] = []
  let done = 0
  await each(live, 4, async ([id, r]) => {
    const e = r.entry as Entry
    if (e.type === 'deck') {
      const doc = await read<Content>(ctx, `ream-doc-${id}.json`)
      out.push({ ...(e as Deck), slides: doc?.data.slides ?? [], css: doc?.data.css, size: doc?.data.size, clock: Date.now(), device: ctx.device, docClock: Date.now() } as Deck)
    } else out.push({ ...e, clock: Date.now(), device: ctx.device } as Entry)
    onFirst?.('Updating your library', ++done, live.length)
  })
  return out
}

/** Re-uploads every file under a new key (or none): turning encryption on or off. */
export async function rewriteAll(ctx: SyncContext, from: CryptoKey | null, onProgress?: (done: number, total: number) => void) {
  const files = (await ctx.drive.list()).filter((f) => f.name.startsWith('ream.'))
  let i = 0
  for (const f of files) {
    onProgress?.(i++, files.length)
    const got = await read({ ...ctx, key: from }, f.name)
    if (got) await write(ctx, f.name, got.data)
  }
  resetState()
}
