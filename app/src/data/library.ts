// The library store. The UI reads a synchronous in-memory snapshot (instant, optimistic); every change
// is diffed into mutations and written behind it to SQLite on OPFS (storage/db.worker.ts). If a write
// fails the snapshot is reloaded from the database, which is the source of truth.
// Engine work (import, export, backup) is still simulated until the domOXML worker exists.
import { useSyncExternalStore } from 'react'
import { claimOwnership, ownInMemory, persistStorage, storage } from '../storage/client'
import type { Mutation } from '../storage/protocol'
import { blankSlide, SAMPLE_IDS, sampleLibrary, sampleSlides } from './fixtures'
import { slideText as textOf } from '../slides/SlideView'
import type { Deck, Entry, ExportFormat, Folder, LibraryState, SlideDoc } from './types'
import { deviceId, noteLocalChange } from './sync'
import { toast } from './toasts'
import { confirm } from '../ui/Dialog'

const TRASH_DAYS = 30

let state: LibraryState = { entries: {}, lastBackupAt: null }
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }

// ---------- boot ----------
export type BootState = 'booting' | 'ready' | 'failed'
let boot: BootState = 'booting'
let bootError = ''
const setBoot = (b: BootState) => { boot = b; emit() }
export const useBoot = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => boot)
export const getBootError = () => bootError

function fromOpened(o: Awaited<ReturnType<typeof storage.open>>): LibraryState {
  const entries: Record<string, Entry> = {}
  for (const e of o.entries) {
    let x = e.type === 'deck' ? ({ ...e, ...(o.docs[e.id] as object) } as Deck) : e
    // Decks saved before slides became normalized HTML: samples get their domOXML version.
    if (x.type === 'deck' && (!Array.isArray(x.slides) || x.slides.some((sl) => typeof (sl as SlideDoc).html !== 'string'))) {
      const fresh = sampleSlides(x.id)
      x = { ...x, slides: fresh.length ? fresh : [blankSlide(`${x.id}-s1`, x.name)] }
    }
    // An import can't survive a reload (the engine work lives in memory): say so instead of spinning forever.
    if (x.type === 'deck' && x.status === 'importing') x = { ...x, status: 'failed', phase: undefined, error: 'The import was interrupted. Try again.' }
    entries[e.id] = x
  }
  return { entries, lastBackupAt: (o.meta.lastBackupAt as number | null) ?? null, tombstones: (o.meta.tombstones as Record<string, number> | undefined) ?? {}, settings: (o.meta.settings as LibraryState['settings']) ?? {} }
}

/** A new library starts empty. `?demo` fills it with the sample decks (for trying the UI). */
async function seed(demo: boolean) {
  const entries = demo ? sampleLibrary() : {}
  await storage.apply([
    ...Object.values(entries).flatMap(toMutations),
    { kind: 'meta', key: 'seeded', value: true },
    { kind: 'meta', key: 'samplesRemoved', value: true },
  ])
  return { entries, lastBackupAt: null }
}

/** Earlier builds seeded demo decks into every library (and sync carried them to the cloud). Removes
 *  them once, as ordinary deletions so the tombstones clear them from the cloud and other devices too.
 *  A sample folder stays if it holds anything of the user's. */
async function removeSeededSamples() {
  const all = Object.values(state.entries)
  const holdsUserWork = (folderId: string): boolean =>
    all.some((e) => e.parentId === folderId && (!SAMPLE_IDS.has(e.id) || (e.type === 'folder' && holdsUserWork(e.id))))
  const gone = all.filter((e) => SAMPLE_IDS.has(e.id) && !(e.type === 'folder' && holdsUserWork(e.id))).map((e) => e.id)
  if (gone.length) {
    const entries = { ...state.entries }
    for (const id of gone) delete entries[id]
    commit({ ...state, entries, lastBackupAt: null }, true)
  }
  await storage.apply([{ kind: 'meta', key: 'samplesRemoved', value: true }])
}

export function bootLibrary() {
  if (new URLSearchParams(location.search).has('memory')) {
    ownInMemory()
    state = { entries: sampleLibrary(), lastBackupAt: null }
    toast({ message: 'Nothing is being saved in this mode. Reload without ?memory to use your library.', duration: 8000 })
    return setBoot('ready')
  }
  claimOwnership(async () => {
    try {
      const params = new URLSearchParams(location.search)
      const demo = params.has('demo')
      if (params.has('reset') || params.has('empty') || demo) {
        await storage.wipe()
        history.replaceState(null, '', location.pathname)
      }
      const opened = await storage.open()
      state = opened.meta.seeded ? fromOpened(opened) : await seed(demo)
      if (opened.meta.seeded && !opened.meta.samplesRemoved) await removeSeededSamples()
      setBoot('ready')
    } catch (e) {
      bootError = (e as Error).message
      setBoot('failed')
    }
  })
}

// ---------- persistence ----------
function toMutations(e: Entry): Mutation[] {
  if (e.type !== 'deck') return [{ kind: 'entry', entry: e }]
  const { slides, ...meta } = e
  return [{ kind: 'entry', entry: meta as Entry }, { kind: 'doc', id: e.id, doc: { slides } }]
}

function diff(prev: LibraryState, next: LibraryState): Mutation[] {
  const out: Mutation[] = []
  for (const [id, e] of Object.entries(next.entries)) {
    const p = prev.entries[id]
    if (p === e) continue
    if (!p || e.type !== 'deck' || p.type !== 'deck' || p.slides !== e.slides) out.push(...toMutations(e))
    else out.push(toMutations(e)[0])
  }
  for (const id of Object.keys(prev.entries)) if (!(id in next.entries)) out.push({ kind: 'delete', id })
  if (prev.lastBackupAt !== next.lastBackupAt) out.push({ kind: 'meta', key: 'lastBackupAt', value: next.lastBackupAt })
  if (prev.tombstones !== next.tombstones) out.push({ kind: 'meta', key: 'tombstones', value: next.tombstones ?? {} })
  if (prev.settings !== next.settings) out.push({ kind: 'meta', key: 'settings', value: next.settings ?? {} })
  return out
}

let writing = Promise.resolve()
let askedPersist = false
// Hybrid logical clock: never goes backwards, even if the system clock does.
let lastClock = 0
export const tick = () => (lastClock = Math.max(Date.now(), lastClock + 1))

/** Local changes get a clock and device stamp (and deletions a tombstone) so sync can merge them. */
function stamp(prev: LibraryState, next: LibraryState): LibraryState {
  let entries = next.entries
  let tombstones = next.tombstones ?? prev.tombstones ?? {}
  const device = deviceId()
  for (const [id, e] of Object.entries(next.entries)) {
    const p = prev.entries[id]
    if (p === e) continue
    const docChanged = e.type === 'deck' && (!p || p.type !== 'deck' || p.slides !== e.slides)
    const t = tick()
    if (entries === next.entries) entries = { ...entries }
    entries[id] = { ...e, clock: t, device, ...(docChanged ? { docClock: t } : {}) } as Entry
  }
  const gone = Object.keys(prev.entries).filter((id) => !(id in next.entries))
  if (gone.length) { tombstones = { ...tombstones }; for (const id of gone) tombstones[id] = tick() }
  return { ...next, entries, tombstones }
}

/** `quiet`: view state (last opened, last slide) still syncs but never prompts about paused sync.
 *  `origin: 'remote'`: changes pulled from the cloud, applied without restamping them as local edits. */
function commit(next: LibraryState, quiet = false, origin: 'local' | 'remote' = 'local') {
  const prev = state
  if (origin === 'local') next = stamp(prev, next)
  state = next
  emit()
  const mutations = diff(prev, next)
  if (!mutations.length) return
  if (origin === 'local') noteLocalChange(1, quiet)
  if (new URLSearchParams(location.search).has('memory')) return
  if (!askedPersist) { askedPersist = true; void persistStorage() }
  writing = writing.then(async () => { await storage.apply(mutations) }).catch(async (e: Error) => {
    toast({ message: e.name === 'QuotaExceededError' ? 'Couldn’t save: browser storage is full. Free space in Settings → Storage.' : 'Couldn’t save that change. Your library was reloaded.', tone: 'danger' })
    try { state = fromOpened(await storage.open()); emit() } catch { /* keep in-memory state */ }
  })
}

function patch(id: string, update: Partial<Deck> | Partial<Folder>, quiet = false) {
  const prev = state.entries[id]
  if (!prev) return
  commit({ ...state, entries: { ...state.entries, [id]: { ...prev, ...update } as Entry } }, quiet)
}

export function useLibrary(): LibraryState {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
}

export const getLibrary = () => state

// ---------- queries ----------

export const isLive = (e: Entry) => e.trashedAt === null
export const decks = (s: LibraryState) => Object.values(s.entries).filter((e): e is Deck => e.type === 'deck')
export const folders = (s: LibraryState) => Object.values(s.entries).filter((e): e is Folder => e.type === 'folder')

export function recents(s: LibraryState, limit = 12): Deck[] {
  return decks(s)
    .filter((d) => isLive(d))
    .sort((a, b) => (b.openedAt ?? b.modifiedAt) - (a.openedAt ?? a.modifiedAt) || a.name.localeCompare(b.name))
    .slice(0, limit)
}

export function childrenOf(s: LibraryState, parentId: string | null): Entry[] {
  return Object.values(s.entries).filter((e) => e.parentId === parentId && isLive(e))
}

export function deckCount(s: LibraryState, folderId: string): number {
  let n = 0
  for (const e of Object.values(s.entries)) {
    if (!isLive(e)) continue
    if (e.parentId === folderId) n += e.type === 'deck' ? 1 : deckCount(s, e.id)
  }
  return n
}

export function pathTo(s: LibraryState, id: string | null): Folder[] {
  const out: Folder[] = []
  let cur = id ? s.entries[id] : undefined
  while (cur && cur.type === 'folder') {
    out.unshift(cur)
    cur = cur.parentId ? s.entries[cur.parentId] : undefined
  }
  return out
}

export function isWithin(s: LibraryState, id: string, ancestorId: string): boolean {
  let cur: Entry | undefined = s.entries[id]
  while (cur) {
    if (cur.id === ancestorId) return true
    cur = cur.parentId ? s.entries[cur.parentId] : undefined
  }
  return false
}

export function coverFor(s: LibraryState, folderId: string): Deck | undefined {
  return decks(s)
    .filter((d) => isLive(d) && isWithin(s, d.id, folderId))
    .sort((a, b) => b.modifiedAt - a.modifiedAt)[0]
}

export const slideText = (d: Deck): string[] => d.slides.map(textOf)

// ---------- names ----------

function uniqueName(base: string, parentId: string | null, type: Entry['type']): string {
  const taken = new Set(childrenOf(state, parentId).filter((e) => e.type === type).map((e) => e.name.toLowerCase()))
  if (!taken.has(base.toLowerCase())) return base
  for (let i = 2; ; i++) {
    const name = `${base} ${i}`
    if (!taken.has(name.toLowerCase())) return name
  }
}

const id = () => Math.random().toString(36).slice(2, 10)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// ---------- actions (optimistic, with Undo) ----------

export function openDeck(deckId: string) {
  patch(deckId, { openedAt: Date.now() }, true)
}

/** Replaces one slide (agent edits, later the editor). A real edit: it prompts about paused sync. */
export function updateSlide(deckId: string, index: number, slide: SlideDoc) {
  const d = state.entries[deckId]
  if (!d || d.type !== 'deck') return
  const slides = d.slides.slice()
  slides[index] = slide
  patch(deckId, { slides, modifiedAt: Date.now() })
}

export function setLastSlide(deckId: string, index: number) {
  if ((state.entries[deckId] as Deck | undefined)?.lastSlide === index) return
  patch(deckId, { lastSlide: index }, true)
}

export function rename(entryId: string, name: string): boolean {
  const trimmed = name.trim()
  const e = state.entries[entryId]
  if (!e || !trimmed || trimmed === e.name) return false
  const prev = e.name
  patch(entryId, { name: trimmed, modifiedAt: Date.now() })
  toast({ message: `Renamed to “${trimmed}”`, action: { label: 'Undo', run: () => patch(entryId, { name: prev }) } })
  return true
}

export function toggleStar(ids: string[]) {
  const on = ids.some((i) => !state.entries[i]?.starred)
  const entries = { ...state.entries }
  for (const i of ids) if (entries[i]) entries[i] = { ...entries[i], starred: on }
  commit({ ...state, entries })
}

export function duplicate(deckId: string): string | undefined {
  const d = state.entries[deckId]
  if (!d || d.type !== 'deck') return
  const copy: Deck = {
    ...d, id: `d-${id()}`, name: uniqueName(`${d.name} copy`, d.parentId, 'deck'),
    createdAt: Date.now(), modifiedAt: Date.now(), openedAt: null, starred: false,
  }
  commit({ ...state, entries: { ...state.entries, [copy.id]: copy } })
  toast({ message: `Duplicated as “${copy.name}”`, action: { label: 'Undo', run: () => remove([copy.id]) } })
  return copy.id
}

function remove(ids: string[]) {
  const entries = { ...state.entries }
  for (const i of ids) delete entries[i]
  commit({ ...state, entries })
}

export function move(ids: string[], folderId: string | null): number {
  const movable = ids.filter((i) => {
    const e = state.entries[i]
    if (!e || e.parentId === folderId) return false
    return !(e.type === 'folder' && folderId && isWithin(state, folderId, e.id))
  })
  if (!movable.length) return 0
  const before = movable.map((i) => [i, state.entries[i].parentId] as const)
  const entries = { ...state.entries }
  for (const i of movable) entries[i] = { ...entries[i], parentId: folderId }
  commit({ ...state, entries })
  const where = folderId ? (state.entries[folderId] as Folder).name : 'Files'
  toast({
    message: movable.length === 1 ? `Moved “${entries[movable[0]].name}” to ${where}` : `Moved ${movable.length} items to ${where}`,
    action: {
      label: 'Undo',
      run: () => {
        const back = { ...state.entries }
        for (const [i, p] of before) if (back[i]) back[i] = { ...back[i], parentId: p }
        commit({ ...state, entries: back })
      },
    },
  })
  return movable.length
}

function subtree(id: string): string[] {
  const out = [id]
  for (const e of Object.values(state.entries)) if (e.parentId === id && e.trashedAt === null) out.push(...subtree(e.id))
  return out
}

/** Trashing a folder takes everything inside it along, so nothing inside stays visible elsewhere. */
export function trash(ids: string[]) {
  const now = Date.now()
  const entries = { ...state.entries }
  let inside = 0
  for (const root of ids) {
    if (!entries[root] || entries[root].trashedAt !== null) continue
    for (const i of subtree(root)) {
      entries[i] = { ...entries[i], trashedAt: now, trashedRoot: root }
      if (i !== root && entries[i].type === 'deck') inside++
    }
  }
  commit({ ...state, entries })
  const name = ids.length === 1 ? `“${state.entries[ids[0]]?.name}”` : plural(ids.length, 'item')
  toast({
    message: `Moved ${name}${inside ? ` and ${plural(inside, 'deck')} inside` : ''} to Trash`,
    action: { label: 'Undo', run: () => restore(ids, true) },
  })
}

/** Trash shows only what was trashed directly; its contents come back with it. */
export const isTrashRoot = (e: Entry) => e.trashedAt !== null && (e.trashedRoot ?? e.id) === e.id

export function restore(ids: string[], quiet = false) {
  const entries = { ...state.entries }
  for (const root of ids) {
    for (const e of Object.values(entries)) {
      if (e.trashedAt === null || (e.trashedRoot ?? e.id) !== root) continue
      const isRoot = e.id === root
      // A root whose folder is gone or trashed comes back to the top level.
      const parent = isRoot && e.parentId ? entries[e.parentId] : undefined
      const parentId = !isRoot ? e.parentId : parent && parent.trashedAt === null ? e.parentId : null
      entries[e.id] = { ...e, trashedAt: null, trashedRoot: undefined, parentId }
    }
  }
  commit({ ...state, entries })
  if (!quiet) toast({ message: `Restored ${ids.length === 1 ? `“${state.entries[ids[0]]?.name}”` : plural(ids.length, 'item')}` })
}

export function deleteForever(ids: string[]) {
  const all = new Set<string>()
  for (const root of ids) for (const e of Object.values(state.entries)) if (e.id === root || e.trashedRoot === root) all.add(e.id)
  remove([...all])
  toast({ message: `Deleted ${plural(ids.length, 'item')} permanently` })
}

/** Permanent deletion always asks first and names exactly what goes (review: it ran unconfirmed). */
export async function askDeleteForever(ids: string[]) {
  if (!ids.length) return
  const all = Object.values(state.entries).filter((e) => ids.includes(e.trashedRoot ?? e.id) && e.trashedAt !== null)
  const n = all.filter((e) => e.type === 'deck').length
  const what = ids.length === 1 ? `“${state.entries[ids[0]]?.name}”` : plural(ids.length, 'item')
  const ok = await confirm({
    title: `Delete ${what} permanently?`,
    body: `${n ? `${plural(n, 'deck')} will be deleted from this browser` : 'This will be deleted from this browser'} and can’t be restored.`,
    confirmLabel: 'Delete permanently',
    danger: true,
  })
  if (ok) deleteForever(ids)
}

export function emptyTrash() {
  void askDeleteForever(Object.values(state.entries).filter(isTrashRoot).map((e) => e.id))
}

export const trashDaysLeft = (e: Entry) =>
  e.trashedAt === null ? TRASH_DAYS : Math.max(0, TRASH_DAYS - Math.floor((Date.now() - e.trashedAt) / 86_400_000))

export function newFolder(parentId: string | null): string {
  const f: Folder = {
    type: 'folder', id: `f-${id()}`, name: uniqueName('New folder', parentId, 'folder'), parentId,
    createdAt: Date.now(), modifiedAt: Date.now(), starred: false, trashedAt: null,
  }
  commit({ ...state, entries: { ...state.entries, [f.id]: f } })
  return f.id
}

export function newDeck(parentId: string | null): string {
  const d: Deck = {
    type: 'deck', id: `d-${id()}`, name: uniqueName('Untitled deck', parentId, 'deck'), parentId,
    createdAt: Date.now(), modifiedAt: Date.now(), openedAt: Date.now(), starred: false, trashedAt: null,
    sizeBytes: 24_000, lastSlide: 0, status: 'ready',
    slides: [blankSlide(`s-${id()}`, 'Untitled deck')],
  }
  commit({ ...state, entries: { ...state.entries, [d.id]: d } })
  return d.id
}

// ---------- simulated engine work ----------

const PHASES = ['queued', 'reading', 'converting', 'saving'] as const

export function importFiles(files: { name: string; size: number }[], parentId: string | null) {
  for (const file of files) {
    const deckId = `d-${id()}`
    const base = file.name.replace(/\.pptx$/i, '')
    const d: Deck = {
      type: 'deck', id: deckId, name: uniqueName(base, parentId, 'deck'), parentId,
      createdAt: Date.now(), modifiedAt: Date.now(), openedAt: Date.now(), starred: false, trashedAt: null,
      sizeBytes: file.size, lastSlide: 0, status: 'importing', phase: 'queued', progress: 0,
      slides: [blankSlide(`s-${id()}`, base)],
    }
    commit({ ...state, entries: { ...state.entries, [deckId]: d } })
    const fails = /locked|password/i.test(file.name)
    let step = 0
    const tick = () => {
      const cur = state.entries[deckId]
      if (!cur || cur.type !== 'deck') return
      step++
      if (fails && step === 2) {
        patch(deckId, { status: 'failed', phase: undefined, error: 'It’s password-protected. Remove the password in PowerPoint and import again.' })
        return
      }
      if (step >= PHASES.length) {
        patch(deckId, { status: 'ready', phase: undefined, progress: 1 })
        toast({ message: `Imported “${cur.name}”` })
        return
      }
      patch(deckId, { phase: PHASES[step], progress: step / PHASES.length })
      setTimeout(tick, 700 + Math.random() * 600)
    }
    setTimeout(tick, 500)
  }
}

export function retryImport(deckId: string) {
  const d = state.entries[deckId]
  if (!d || d.type !== 'deck') return
  remove([deckId])
  importFiles([{ name: `${d.name.replace(/locked|password/gi, '').trim() || 'Deck'}.pptx`, size: d.sizeBytes }], d.parentId)
}

let engineWarm = false
export function download(ids: string[], format: ExportFormat) {
  const items = ids.map((i) => state.entries[i]).filter((e): e is Deck => e?.type === 'deck' && e.status === 'ready')
  if (!items.length) return
  const ext = format === 'pptx' ? 'pptx' : 'html'
  const label = items.length === 1 ? `${items[0].name}.${ext}` : `${items.length} decks (.zip)`
  const done = () => toast({ message: `Downloaded ${label}`, tone: 'ok' })
  if (engineWarm) return void setTimeout(done, 350)
  const t = toast({ message: `Preparing ${label}…`, busy: true, duration: Infinity })
  setTimeout(() => {
    engineWarm = true
    t.dismiss()
    done()
  }, 1600)
}

export function backUp() {
  const n = decks(state).filter(isLive).length
  const t = toast({ message: `Backing up ${plural(n, 'deck')}…`, busy: true, duration: Infinity })
  setTimeout(() => {
    t.dismiss()
    commit({ ...state, lastBackupAt: Date.now() })
    toast({ message: `Backed up ${plural(n, 'deck')}`, tone: 'ok' })
  }, 1400)
}

// ---------- sync engine hooks ----------

/** Applies entries and deck content pulled from the cloud (no restamping, no "paused" prompts). */
export function applyRemote(change: { upserts: Entry[]; deletes: string[] }) {
  if (!change.upserts.length && !change.deletes.length) return
  const entries = { ...state.entries }
  for (const e of change.upserts) entries[e.id] = e
  for (const id of change.deletes) delete entries[id]
  commit({ ...state, entries }, true, 'remote')
}

/** Keeps this device's version of a deck that also changed elsewhere, as a visible copy. */
export function addConflictCopy(d: Deck, deviceName: string) {
  const copy: Deck = { ...d, id: `d-${id()}`, name: uniqueName(`${d.name} (from ${deviceName})`, d.parentId, 'deck'), modifiedAt: Date.now() }
  commit({ ...state, entries: { ...state.entries, [copy.id]: copy } })
}

/** Library-wide settings (synced). A local change stamps the clock so it wins over older copies. */
export function setLibrarySettings(update: Record<string, unknown>) {
  commit({ ...state, settings: { ...state.settings, ...update, clock: tick() } })
}
/** Settings pulled from the cloud, applied as-is. */
export function applyRemoteSettings(settings: LibraryState['settings']) {
  commit({ ...state, settings }, true, 'remote')
}

/** Replaces a deck's slides in one change (agent edits, reorders). */
export function updateSlides(deckId: string, slides: SlideDoc[]) {
  const d = state.entries[deckId]
  if (!d || d.type !== 'deck') return
  patch(deckId, { slides, modifiedAt: Date.now() })
}
