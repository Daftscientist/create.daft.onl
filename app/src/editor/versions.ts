// Local version history (spec phase 6). While a deck is being edited, a copy of it is kept at most
// every 10 minutes (and when it's opened), in this browser only (IndexedDB), up to 40 per deck.
// Restoring is an ordinary, undoable change.
import { scoped } from '../data/accounts'
import type { Deck, SlideDoc, SlideSize } from '../data/types'

export type Version = { id: string; deckId: string; at: number; slides: SlideDoc[]; css?: string; size?: SlideSize; count: number }
const DB = scoped('ream-versions'), STORE = 'versions', EVERY = 10 * 60_000, CAP = 40

let db: Promise<IDBDatabase> | null = null
function open(): Promise<IDBDatabase> {
  return (db ??= new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => { const s = req.result.createObjectStore(STORE, { keyPath: 'id' }); s.createIndex('deck', 'deckId') }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  }))
}
const tx = async (mode: IDBTransactionMode) => (await open()).transaction(STORE, mode).objectStore(STORE)
const done = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) })

export async function listVersions(deckId: string): Promise<Version[]> {
  try {
    const all = await done((await tx('readonly')).index('deck').getAll(deckId)) as Version[]
    return all.sort((a, b) => b.at - a.at)
  } catch { return [] }
}

const last = new Map<string, { at: number; slides: SlideDoc[] }>()
/** Keeps a copy of the deck if the last one is old enough and the deck changed since. */
export async function maybeKeep(deck: Deck, force = false) {
  const prev = last.get(deck.id)
  if (prev && (prev.slides === deck.slides || (!force && Date.now() - prev.at < EVERY))) return
  last.set(deck.id, { at: Date.now(), slides: deck.slides })
  try {
    const versions = await listVersions(deck.id)
    if (versions[0] && JSON.stringify(versions[0].slides.map((s) => s.html)) === JSON.stringify(deck.slides.map((s) => s.html))) return
    const store = await tx('readwrite')
    await done(store.put({ id: `${deck.id}@${Date.now()}`, deckId: deck.id, at: Date.now(), slides: deck.slides, css: deck.css, size: deck.size, count: deck.slides.length } satisfies Version))
    for (const old of versions.slice(CAP - 1)) await done((await tx('readwrite')).delete(old.id))
  } catch { /* history is a convenience: a full or blocked store just keeps fewer versions */ }
}
