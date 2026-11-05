// Shared drag state so every drop target (folder tiles, sidebar folders, the drop veil) agrees on
// what is being dragged and where it would land.
import { useSyncExternalStore } from 'react'

export const MIME = 'application/x-office-ids'

type DragState = { kind: 'none' } | { kind: 'internal'; ids: string[] } | { kind: 'external' }
type State = { drag: DragState; over: string | null } // over = folder id, '' = root, null = none

let state: State = { drag: { kind: 'none' }, over: null }
const listeners = new Set<() => void>()
const set = (next: Partial<State>) => {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}

export const useDnd = () =>
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)

export const startInternal = (ids: string[]) => set({ drag: { kind: 'internal', ids } })
export const startExternal = () => state.drag.kind !== 'external' && set({ drag: { kind: 'external' } })
export const setOver = (over: string | null) => state.over !== over && set({ over })
export const endDrag = () => set({ drag: { kind: 'none' }, over: null })
export const getDnd = () => state

export const hasFiles = (e: React.DragEvent | DragEvent) => !!e.dataTransfer?.types.includes('Files')
export const hasIds = (e: React.DragEvent | DragEvent) => !!e.dataTransfer?.types.includes(MIME)

/** Dwell on a folder while dragging to spring it open (Finder's spring-loaded folders). */
let dwell: { id: string; timer: number } | null = null
export function dwellOn(id: string | null, open: (id: string) => void) {
  if (dwell?.id === id) return
  if (dwell) clearTimeout(dwell.timer)
  dwell = id ? { id, timer: window.setTimeout(() => open(id), 700) } : null
}
