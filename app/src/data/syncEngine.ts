// The sync engine (docs/architecture/SYNC.md). Cloud layout, all inside the provider's app folder:
//   ream-entries.json   every deck and folder's metadata, each with its own clock and device (merged per entry)
//   ream-doc-<id>.json  one deck's content (normalized HTML slides), with its content clock
//   ream-key.json       present only with end-to-end encryption: salt + check value, never the key
// Never syncs the SQLite file. Writes to ream-entries.json are conditional, so two devices syncing at
// once re-read and merge instead of overwriting each other.
import { scoped } from './accounts'
import { isSealed, open, seal, type KeyFile } from '../cloud/crypto'
import { RemoteConflict, type CloudDrive } from '../cloud/types'
import { addConflictCopy, applyRemote, applyRemoteSettings, getLibrary } from './library'
import type { Deck, Entry } from './types'

export const ENTRIES = 'ream-entries.json'
export const KEYFILE = 'ream-key.json'
export const SETTINGS = 'ream-settings.json'
const docName = (id: string) => `ream-doc-${id}.json`

type Meta = Omit<Deck, 'slides' | 'css' | 'size'> | Entry
type RemoteEntry = { entry?: Meta; clock: number; device: string; deleted?: true }
export type EntriesFile = { format: 1; entries: Record<string, RemoteEntry>; devices: Record<string, { name: string; seen: number }> }
type Base = { entries: Record<string, number>; docs: Record<string, number> }

const BASE_KEY = scoped('ream.sync.base')
export function loadBase(): Base {
  try { return { entries: {}, docs: {}, ...JSON.parse(localStorage.getItem(BASE_KEY) ?? '{}') } } catch { return { entries: {}, docs: {} } }
}
const saveBase = (b: Base) => localStorage.setItem(BASE_KEY, JSON.stringify(b))
export const resetBase = () => localStorage.removeItem(BASE_KEY)

/** Local changes not yet in the cloud. */
export function pendingCount(): number {
  const lib = getLibrary(), base = loadBase()
  let n = 0
  for (const e of Object.values(lib.entries)) if ((e.clock ?? 0) > (base.entries[e.id] ?? 0)) n++
  for (const [id, t] of Object.entries(lib.tombstones ?? {})) if (t > (base.entries[id] ?? 0)) n++
  return n
}

const meta = (e: Entry): Meta => (e.type === 'deck' ? (({ slides: _s, css: _c, size: _z, ...m }) => m)(e) : e)

export type SyncContext = { drive: CloudDrive; device: string; deviceName: string; key: CryptoKey | null }

async function read(ctx: SyncContext, name: string): Promise<{ data: unknown; rev: string } | null> {
  const got = await ctx.drive.get(name)
  if (!got) return null
  let text = got.text
  if (isSealed(text)) {
    if (!ctx.key) throw Object.assign(new Error('Library is encrypted'), { name: 'Locked' })
    text = await open(ctx.key, text)
  }
  return { data: JSON.parse(text), rev: got.rev }
}
async function write(ctx: SyncContext, name: string, data: unknown, ifRev?: string | null) {
  const text = JSON.stringify(data)
  return ctx.drive.put(name, ctx.key ? await seal(ctx.key, text) : text, ifRev)
}

export async function readKeyFile(drive: CloudDrive): Promise<KeyFile | null> {
  const got = await drive.get(KEYFILE)
  return got ? (JSON.parse(got.text) as KeyFile) : null
}

export type SyncResult = { pulled: number; pushed: number; conflicts: number; otherDevice: { name: string; at: number } | null }

/** One full sync: pull, merge, push. Safe to call repeatedly; retries when another device wins a race. */
export async function syncOnce(ctx: SyncContext, onProgress?: (label: string, done: number, total: number) => void): Promise<SyncResult> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const remoteRead = await read(ctx, ENTRIES)
    const remote: EntriesFile = (remoteRead?.data as EntriesFile) ?? { format: 1, entries: {}, devices: {} }
    const lib = getLibrary()
    const base = loadBase()
    const local = lib.entries
    const tombs = lib.tombstones ?? {}
    const merged: Record<string, RemoteEntry> = { ...remote.entries }
    const upserts: Entry[] = []
    const deletes: string[] = []
    const docPull: string[] = []
    const docPush: Deck[] = []
    const conflictCopies: Deck[] = []
    const ids = new Set([...Object.keys(local), ...Object.keys(remote.entries), ...Object.keys(tombs)])

    for (const id of ids) {
      const L = local[id]
      const R = remote.entries[id]
      const T = tombs[id]
      const localClock = L?.clock ?? T ?? 0
      const remoteWins = R && (R.clock > localClock || (R.clock === localClock && R.device > ctx.device))
      if (remoteWins) {
        if (R.deleted) { if (L) deletes.push(id); continue }
        const rm = R.entry as Meta
        if (rm.type === 'deck') {
          const remoteDoc = (rm as Deck).docClock ?? 0
          const localDoc = L?.type === 'deck' ? L.docClock ?? 0 : -1
          if (remoteDoc > localDoc) {
            if (L?.type === 'deck' && localDoc > (base.docs[id] ?? 0)) conflictCopies.push(L)
            docPull.push(id)
            continue
          }
          if (L?.type === 'deck') upserts.push({ ...L, ...rm } as Deck)
        } else upserts.push(rm as Entry)
      } else if (L) {
        merged[id] = { entry: meta(L), clock: L.clock ?? 0, device: L.device ?? ctx.device }
        if (L.type === 'deck' && (L.docClock ?? 0) > (((R?.entry as Deck | undefined)?.docClock) ?? -1)) docPush.push(L)
      } else if (T !== undefined) {
        merged[id] = { clock: T, device: ctx.device, deleted: true }
      }
    }

    // Pull deck content that changed elsewhere.
    let done = 0
    const total = docPull.length + docPush.length
    for (const id of docPull) {
      onProgress?.('Bringing in changes', done++, total)
      const got = await read(ctx, docName(id))
      const rm = remote.entries[id].entry as Deck
      if (got) upserts.push({ ...rm, ...(got.data as Pick<Deck, 'slides' | 'css' | 'size'>) } as Deck)
    }
    // Push deck content that changed here.
    for (const d of docPush) {
      onProgress?.('Sending changes', done++, total)
      await write(ctx, docName(d.id), { slides: d.slides, css: d.css, size: d.size, docClock: d.docClock })
    }
    // Deleted decks: remove their content files too (best effort).
    for (const [id, r] of Object.entries(merged)) if (r.deleted && remote.entries[id] && !remote.entries[id].deleted) await ctx.drive.remove(docName(id)).catch(() => {})

    const devices = { ...remote.devices, [ctx.device]: { name: ctx.deviceName, seen: Date.now() } }
    try {
      await write(ctx, ENTRIES, { format: 1, entries: merged, devices } satisfies EntriesFile, remoteRead ? remoteRead.rev : null)
    } catch (e) {
      if (e instanceof RemoteConflict) continue // another device synced meanwhile: merge again
      throw e
    }

    applyRemote({ upserts, deletes })
    await syncSettings(ctx)
    for (const c of conflictCopies) addConflictCopy(c, ctx.deviceName)
    saveBase({
      entries: Object.fromEntries(Object.entries(merged).map(([id, r]) => [id, r.clock])),
      docs: { ...base.docs, ...Object.fromEntries(Object.values(getLibrary().entries).filter((e): e is Deck => e.type === 'deck').map((d) => [d.id, d.docClock ?? 0])) },
    })
    const others = Object.entries(devices).filter(([id]) => id !== ctx.device).sort((a, b) => b[1].seen - a[1].seen)
    return {
      pulled: upserts.length + deletes.length,
      pushed: docPush.length,
      conflicts: conflictCopies.length,
      otherDevice: others[0] ? { name: others[0][1].name, at: others[0][1].seen } : null,
    }
  }
  throw new Error('Another device kept syncing at the same time. Try again in a moment.')
}

/** Re-uploads every synced file under a new key (or none): used when encryption is turned on or off. */
/** Library settings: newest clock wins, whole file. */
async function syncSettings(ctx: SyncContext) {
  const local = getLibrary().settings ?? {}
  const remote = await read(ctx, SETTINGS)
  const r = (remote?.data ?? {}) as { clock?: number }
  if ((r.clock ?? 0) > (local.clock ?? 0)) applyRemoteSettings(r)
  else if ((local.clock ?? 0) > (r.clock ?? 0)) await write(ctx, SETTINGS, local)
}

export async function rewriteAll(ctx: SyncContext, from: CryptoKey | null, onProgress?: (done: number, total: number) => void) {
  const files = (await ctx.drive.list()).filter((f) => f.name === ENTRIES || f.name === SETTINGS || f.name.startsWith('ream-doc-'))
  let i = 0
  for (const f of files) {
    onProgress?.(i++, files.length)
    const got = await read({ ...ctx, key: from }, f.name)
    if (got) await write(ctx, f.name, got.data)
  }
}
