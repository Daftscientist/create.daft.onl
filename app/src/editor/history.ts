// Transactional history (docs/design/specs/editor.md, contract 5). Every change to a deck's slides is
// one transaction holding the slides before and after (immutable arrays, so this is cheap). ⌘Z undoes
// the newest `user` transaction of the open deck; an AI turn undoes only its own. A transaction whose
// slides changed since (another device, the agent, a later edit that wasn't undone) can't be undone
// blindly: slides that still match are reverted, the rest are reported.
import { useSyncExternalStore } from 'react'
import { getLibrary, updateSlides } from '../data/library'
import type { Deck, SlideDoc } from '../data/types'

export type Origin = 'user' | `ai:${string}` | 'remote'
export type Selection = { slide: string; ids: string[] }
export type Tx = { id: number; origin: Origin; deckId: string; label: string; before: SlideDoc[]; after: SlideDoc[]; selBefore?: Selection; selAfter?: Selection; extraBefore?: Partial<Deck>; extraAfter?: Partial<Deck> }

const CAP = 200
let seq = 0
const undoStack: Tx[] = []
const redoStack: Tx[] = []
const listeners = new Set<() => void>()
let version = 0
const emit = () => { version++; for (const l of listeners) l() }

const deckOf = (id: string) => { const d = getLibrary().entries[id]; return d?.type === 'deck' ? d : undefined }

/** Applies a change to a deck's slides as one transaction. Returns it (with the slides as stored). */
export function transact(deckId: string, slides: SlideDoc[], opts: { origin?: Origin; label: string; selBefore?: Selection; selAfter?: Selection; extra?: Partial<Deck>; from?: SlideDoc[] }): Tx | undefined {
  const d = deckOf(deckId)
  if (!d) return
  // `from`: the deck before a change that was saved in steps (text typed with idle saves) and is recorded once.
  const before = opts.from ?? d.slides
  const extraBefore = opts.extra ? Object.fromEntries(Object.keys(opts.extra).map((k) => [k, d[k as keyof Deck]])) as Partial<Deck> : undefined
  const after = updateSlides(deckId, slides, { extra: opts.extra })
  if (!after) return
  const tx: Tx = { id: ++seq, origin: opts.origin ?? 'user', deckId, label: opts.label, before, after, selBefore: opts.selBefore, selAfter: opts.selAfter, extraBefore, extraAfter: opts.extra }
  if (tx.origin === 'user') {
    undoStack.push(tx)
    if (undoStack.length > CAP) undoStack.shift()
    redoStack.length = 0
  } else aiTx.set(tx.origin, tx)
  emit()
  return tx
}

const aiTx = new Map<string, Tx>()

type Result = { ok: true; tx: Tx; skipped: number } | { ok: false; reason: string }

/** Moves a deck from `from` to `to` where it still matches `from`, slide by slide. */
function revert(tx: Tx, from: SlideDoc[], to: SlideDoc[], extra?: Partial<Deck>): { ok: boolean; skipped: number } {
  const d = deckOf(tx.deckId)
  if (!d) return { ok: false, skipped: 0 }
  if (d.slides === from) { updateSlides(tx.deckId, to, { exact: true, extra }); return { ok: true, skipped: 0 } }
  // The deck changed since. A transaction that only edited slides (same ids in the same order) can
  // still revert each slide nobody touched since; structural ones (insert, delete, reorder) can't.
  const same = (a: SlideDoc[], b: SlideDoc[]) => a.length === b.length && a.every((s, i) => s.id === b[i].id)
  if (!same(from, to)) return { ok: false, skipped: 0 }
  const fromById = new Map(from.map((s) => [s.id, s]))
  const toById = new Map(to.map((s) => [s.id, s]))
  let skipped = 0, changed = false
  const slides = d.slides.map((s) => {
    const f = fromById.get(s.id), t = toById.get(s.id)
    if (!f || !t || f === t) return s
    if (s === f || s.html === f.html) { changed = true; return t }
    skipped++
    return s
  })
  if (changed) updateSlides(tx.deckId, slides, { exact: true, extra })
  return { ok: changed, skipped }
}

export function undo(deckId: string): Result {
  const i = undoStack.findLastIndex((t) => t.deckId === deckId)
  if (i < 0) return { ok: false, reason: 'Nothing to undo' }
  const tx = undoStack[i]
  const r = revert(tx, tx.after, tx.before, tx.extraBefore)
  undoStack.splice(i, 1)
  if (!r.ok) { emit(); return { ok: false, reason: 'Can’t undo: the deck changed since (another device or Ream)' } }
  redoStack.push({ ...tx, before: deckOf(deckId)!.slides })
  emit()
  return { ok: true, tx, skipped: r.skipped }
}

export function redo(deckId: string): Result {
  const i = redoStack.findLastIndex((t) => t.deckId === deckId)
  if (i < 0) return { ok: false, reason: 'Nothing to redo' }
  const tx = redoStack[i]
  redoStack.splice(i, 1)
  const d = deckOf(deckId)!
  // Redo reapplies the slides that were undone, onto the deck as it is now.
  const r = revert(tx, tx.before, tx.after, tx.extraAfter)
  if (!r.ok) { emit(); return { ok: false, reason: 'Can’t redo: the deck changed since' } }
  undoStack.push({ ...tx, before: d.slides, after: deckOf(deckId)!.slides })
  emit()
  return { ok: true, tx, skipped: r.skipped }
}

/** Reverts an AI turn's transaction only. Slides changed since are skipped (and counted). */
export function undoAi(origin: `ai:${string}`): Result {
  const tx = aiTx.get(origin)
  if (!tx) return { ok: false, reason: 'Nothing to undo' }
  const r = revert(tx, tx.after, tx.before)
  aiTx.delete(origin)
  emit()
  return r.ok ? { ok: true, tx, skipped: r.skipped } : { ok: false, reason: 'Can’t undo: those slides changed since' }
}

export function useHistory(deckId: string) {
  useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => version)
  return {
    canUndo: undoStack.some((t) => t.deckId === deckId),
    canRedo: redoStack.some((t) => t.deckId === deckId),
    undoLabel: undoStack.findLast((t) => t.deckId === deckId)?.label,
    redoLabel: redoStack.findLast((t) => t.deckId === deckId)?.label,
  }
}

/** The last transaction's id: a bookmark for `userEditsSince`. */
export const historyMark = () => seq
/** What the user changed by hand since `mark`, oldest first: each change's label and the slide numbers it
 *  touched (in the deck's order now). Undone changes aren't included. */
export function userEditsSince(deckId: string, mark: number): { label: string; slides: number[] }[] {
  const d = deckOf(deckId)
  if (!d) return []
  const order = new Map(d.slides.map((x, i) => [x.id, i + 1]))
  return undoStack.filter((t) => t.deckId === deckId && t.id > mark && t.origin === 'user').map((t) => {
    const was = new Map(t.before.map((x) => [x.id, x.html]))
    const touched = t.after.filter((x) => was.get(x.id) !== x.html).map((x) => order.get(x.id)).filter((n): n is number => !!n)
    return { label: t.label, slides: [...new Set(touched)] }
  })
}
