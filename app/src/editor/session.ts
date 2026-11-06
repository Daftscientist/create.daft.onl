// The open deck's editor state: which slide is on the stage, what's selected, what's being edited,
// zoom and the right column. One editor is open at a time, so this is a module store.
import { useSyncExternalStore } from 'react'

export type Column = 'format' | 'ask' | null
export type EditorState = {
  deckId: string | null
  slideId: string | null
  /** Selected objects on the stage (top-level ids, or members of `scope`). */
  sel: string[]
  /** The group the selection is inside (after double-clicking into it). */
  scope: string | null
  /** The object whose text is being edited. */
  editing: string | null
  /** Slide rail selection (ids) and its range anchor; the stage slide is `slideId`. */
  railSel: string[]
  railAnchor: string | null
  zoom: number | 'fit'
  column: Column
  /** Slides the agent is changing right now: read-only on the canvas. */
  locked: string[]
  presenting: boolean
  /** Placing a comment: the next click on the slide drops a pin there. */
  commenting: boolean
  /** The viewer (tablets): nothing may change the deck. */
  readOnly: boolean
}

let state: EditorState = {
  deckId: null, slideId: null, sel: [], scope: null, editing: null, railSel: [], railAnchor: null,
  zoom: 'fit', column: null, locked: [], presenting: false, readOnly: false, commenting: false,
}
const listeners = new Set<() => void>()

export const getEditor = () => state
export function setEditor(update: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
  const u = typeof update === 'function' ? update(state) : update
  const next = { ...state, ...u }
  if (Object.keys(u).every((k) => next[k as keyof EditorState] === state[k as keyof EditorState])) return
  state = next
  for (const l of listeners) l()
}
export function useEditor<T>(pick: (s: EditorState) => T): T {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => pick(state))
}

/** Selects objects (clearing text editing). */
export const select = (sel: string[], scope: string | null = state.scope) => setEditor({ sel, scope, editing: null })
