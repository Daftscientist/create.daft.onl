// UI-side handle to the storage worker, plus single-tab ownership (the OPFS pool is exclusive).
import { useSyncExternalStore } from 'react'
import type { Mutation, Op, Opened, Response } from './protocol'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

function call<T>(req: Op, transfer: Transferable[] = []): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./db.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<Response>) => {
      const p = pending.get(ev.data.id)
      if (!p) return
      pending.delete(ev.data.id)
      if (ev.data.ok) p.resolve(ev.data.result)
      else p.reject(Object.assign(new Error(ev.data.error.message), { name: ev.data.error.name }))
    }
  }
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ ...req, id }, transfer)
  })
}

export const storage = {
  open: () => call<Opened>({ op: 'open' }),
  apply: (mutations: Mutation[]) => call<null>({ op: 'apply', mutations }),
  wipe: () => call<null>({ op: 'wipe' }),
  putBlob: (hash: string, bytes: ArrayBuffer) => call<null>({ op: 'putBlob', hash, bytes }, [bytes]),
  getBlob: (hash: string) => call<File | null>({ op: 'getBlob', hash }),
}

// ---------- ownership ----------
// One tab owns the library at a time. Others show "Open in another tab" with "Use here", which steals the
// lock; the previous owner learns it lost the lock and shows "Moved to another tab".

export type Ownership = 'acquiring' | 'owner' | 'elsewhere' | 'lost' | 'unsupported'
let ownership: Ownership = 'acquiring'
const listeners = new Set<() => void>()
const set = (o: Ownership) => { ownership = o; listeners.forEach((l) => l()) }
let onOwned: (() => void) | null = null

const LOCK = 'ream-library'

function hold(steal: boolean) {
  navigator.locks.request(LOCK, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
    if (!lock) return set('elsewhere')
    set('owner')
    onOwned?.()
    await new Promise(() => {}) // hold until stolen or the tab closes
  }).catch((e: Error) => {
    if (e.name === 'AbortError') {
      worker?.terminate()
      worker = null
      set('lost')
    }
  })
}

export function claimOwnership(whenOwned: () => void) {
  onOwned = whenOwned
  if (!('locks' in navigator) || !('storage' in navigator) || !('getDirectory' in navigator.storage)) return set('unsupported')
  hold(false)
}

export const takeOver = () => hold(true)

/** ?memory mode: nothing is stored, so there is nothing to own. */
export const ownInMemory = () => set('owner')

export const useOwnership = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => ownership)

export async function persistStorage(): Promise<boolean> {
  try { return (await navigator.storage.persisted()) || (await navigator.storage.persist()) } catch { return false }
}
