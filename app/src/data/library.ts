// The library store. UI phase: state lives in memory and localStorage, and engine work (import,
// export, backup) is simulated with realistic timings so every UI state can be seen.
// The real implementation (SQLite on OPFS + domOXML worker) keeps this module's API.
import { useSyncExternalStore } from 'react'
import { blankTheme, sampleLibrary } from './fixtures'
import type { Deck, Entry, ExportFormat, Folder, LibraryState } from './types'
import { toast } from './toasts'

const KEY = 'office.ui.library.v1'
const TRASH_DAYS = 30

function load(): LibraryState {
  try {
    if (new URLSearchParams(location.search).has('reset')) localStorage.removeItem(KEY)
    if (new URLSearchParams(location.search).has('empty')) return { entries: {}, lastBackupAt: null }
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as LibraryState
  } catch {
    /* storage unavailable: fall through to the sample library */
  }
  return { entries: sampleLibrary(), lastBackupAt: Date.now() - 2 * 86_400_000 }
}

let state: LibraryState = load()
const listeners = new Set<() => void>()

function commit(next: LibraryState) {
  state = next
  try {
    if (!new URLSearchParams(location.search).has('empty')) localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* quota or private mode: the UI keeps working in memory */
  }
  for (const l of listeners) l()
}

function patch(id: string, update: Partial<Deck> | Partial<Folder>) {
  const prev = state.entries[id]
  if (!prev) return
  commit({ ...state, entries: { ...state.entries, [id]: { ...prev, ...update } as Entry } })
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

export function slideText(d: Deck): string[] {
  return d.slides.map((sl) => {
    switch (sl.kind) {
      case 'title': return [sl.eyebrow, sl.title, sl.subtitle].filter(Boolean).join(' ')
      case 'bullets': return [sl.title, ...sl.items].join(' ')
      case 'stat': return [sl.value, sl.label, sl.note].filter(Boolean).join(' ')
      case 'chart': return [sl.title, ...sl.labels].join(' ')
      case 'quote': return `${sl.text} ${sl.by}`
      case 'split': return [sl.tag, sl.title, sl.body].filter(Boolean).join(' ')
      case 'grid': return [sl.title, ...sl.cells.flatMap((c) => [c.label, c.value])].join(' ')
      case 'section': return sl.title
    }
  })
}

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
  patch(deckId, { openedAt: Date.now() })
}

export function setLastSlide(deckId: string, index: number) {
  patch(deckId, { lastSlide: index })
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

export function trash(ids: string[]) {
  const now = Date.now()
  const entries = { ...state.entries }
  for (const i of ids) if (entries[i]) entries[i] = { ...entries[i], trashedAt: now }
  commit({ ...state, entries })
  const name = ids.length === 1 ? `“${state.entries[ids[0]]?.name}”` : plural(ids.length, 'item')
  toast({
    message: `Moved ${name} to Trash`,
    action: { label: 'Undo', run: () => restore(ids, true) },
  })
}

export function restore(ids: string[], quiet = false) {
  const entries = { ...state.entries }
  for (const i of ids) {
    const e = entries[i]
    if (!e) continue
    // A deck whose folder is gone or trashed comes back to the top level.
    const parent = e.parentId ? entries[e.parentId] : undefined
    const parentId = parent && parent.trashedAt === null ? e.parentId : null
    entries[i] = { ...e, trashedAt: null, parentId }
  }
  commit({ ...state, entries })
  if (!quiet) toast({ message: `Restored ${ids.length === 1 ? `“${state.entries[ids[0]]?.name}”` : plural(ids.length, 'item')}` })
}

export function deleteForever(ids: string[]) {
  const n = ids.length
  remove(ids)
  toast({ message: `Deleted ${plural(n, 'item')} permanently` })
}

export function emptyTrash() {
  const ids = Object.values(state.entries).filter((e) => e.trashedAt !== null).map((e) => e.id)
  if (ids.length) deleteForever(ids)
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
    sizeBytes: 24_000, theme: blankTheme, lastSlide: 0, status: 'ready',
    slides: [{ kind: 'title', title: 'Untitled deck', subtitle: 'Click to add a subtitle' }],
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
      sizeBytes: file.size, theme: blankTheme, lastSlide: 0, status: 'importing', phase: 'queued', progress: 0,
      slides: [{ kind: 'title', eyebrow: 'Imported', title: base, subtitle: 'Converted on this device' }],
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
