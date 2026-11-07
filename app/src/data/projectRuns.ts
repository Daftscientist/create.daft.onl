// Project chats as live state (spec: projects v2). A run belongs to its chat, not to a component: it keeps going
// while you open a deck or another page, and only Stop (or the project going away) ends it. Each project remembers
// its open chat and the unsent draft (per account). Conversations are saved to the library (synced) as they settle.
import { useSyncExternalStore } from 'react'
import type { ModelMessage } from 'ai'
import { scoped } from './accounts'
import type { Attachment } from './ai/agent'
import { runProjectAgent, type DeckWork } from './ai/projectAgent'
import { chatFor, getLibrary, projectChats, setChat, trash, updateSlides } from './library'
import { summariseBlocks } from '../genui/transcript'
import { toast } from './toasts'
import type { SlideDoc } from './types'

export type Item = { kind: 'text'; text: string } | { kind: 'step'; label: string; deck?: string }
/** A deck a turn worked on, as kept in the chat. Made decks keep only a fingerprint (Undo moves them to Trash). */
export type Work = { deckId: string; name: string; created: boolean; before?: SlideDoc[]; after?: SlideDoc[]; madeKey?: string; summary?: string; undone?: boolean }
export type Turn = { prompt: string; files?: string[]; /** Sent by pressing a button in an interactive block (its title). */ from?: string; log: Item[]; text: string; thought?: string; error?: string; decks?: Work[]; state: 'running' | 'done' | 'stopped'; startedAt: number; ms?: number }
export type Thread = { id: string; turns: Turn[]; line: string | null; lineDeck: string | null; vision: boolean }

const DWELL = 1600
const threads = new Map<string, Thread>()
const runs = new Map<string, { abort: AbortController; vision: ((c: 'retry' | 'continue') => void) | null; sched: { shownAt: number; next: { label: string; deck: string | null } | null; timer: number } }>()
const openChat = new Map<string, string>()
const listeners = new Set<() => void>()
let version = 0
const emit = () => { version++; for (const l of listeners) l() }
export const useRuns = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => version)

const newThreadId = (projectId: string) => `${projectId}~${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`

/** The chat a project shows: the one you last had open, else its newest, else a fresh one. */
export function currentChat(projectId: string): string {
  const known = openChat.get(projectId)
  if (known) return known
  const newest = projectChats(getLibrary(), projectId)[0]?.id
  const id = newest ?? newThreadId(projectId)
  openChat.set(projectId, id)
  return id
}
export function openChatIn(projectId: string, threadId: string) { openChat.set(projectId, threadId); emit() }
/** Starts another chat; the current one stays in the list. */
export function newChat(projectId: string) { openChat.set(projectId, newThreadId(projectId)); emit() }

export function thread(id: string): Thread {
  let t = threads.get(id)
  // A turn saved mid-run (the tab closed) has no run behind it any more: it shows as stopped, with what it changed.
  if (!t) { t = { id, turns: (chatFor(id) as Turn[]).map((x) => (x.state === 'running' && !runs.has(id) ? { ...x, state: 'stopped' as const } : x)), line: null, lineDeck: null, vision: false }; threads.set(id, t) }
  return t
}
export const isRunning = (id: string) => runs.has(id)
export const projectBusy = (projectId: string) => [...runs.keys()].some((k) => k.startsWith(`${projectId}~`))

function patch(id: string, fn: (t: Thread) => Partial<Thread>) {
  const t = thread(id)
  threads.set(id, { ...t, ...fn(t) })
  emit()
  scheduleSave(id)
}
const patchLast = (id: string, fn: (t: Turn) => Turn) => patch(id, (t) => ({ turns: t.turns.map((x, i) => (i === t.turns.length - 1 ? fn(x) : x)) }))

const saveTimers = new Map<string, number>()
function scheduleSave(id: string) {
  clearTimeout(saveTimers.get(id))
  saveTimers.set(id, window.setTimeout(() => save(id), 900))
}
function save(id: string) {
  saveTimers.delete(id)
  const t = threads.get(id)
  if (!t || !getLibrary().entries[id.split('~')[0]]) return
  const turns = t.turns.map((x) => (x.state === 'running' && !runs.has(id) ? { ...x, state: 'stopped' as const } : x))
  setChat(id, turns, titleFor(turns))
}
/** A chat's name in the list: its first message, cut at a word. */
const titleFor = (turns: Turn[]) => { const p = turns[0]?.prompt.trim() ?? ''; return p.length <= 48 ? p : `${p.slice(0, 46).replace(/\s+\S*$/, '')}…` }

// ---- the activity line (≥1.6s each, a queue of one) ----
function show(id: string, label: string, deck: string | null) {
  const r = runs.get(id)
  if (!r) return
  const sc = r.sched
  const wait = DWELL - (Date.now() - sc.shownAt)
  if (!thread(id).line || wait <= 0) { sc.shownAt = Date.now(); patch(id, () => ({ line: label, lineDeck: deck })); return }
  sc.next = { label, deck }
  clearTimeout(sc.timer)
  sc.timer = window.setTimeout(() => { if (sc.next) { sc.shownAt = Date.now(); const n = sc.next; sc.next = null; patch(id, () => ({ line: n.label, lineDeck: n.deck })) } }, wait)
}
function flush(id: string) {
  const r = runs.get(id)
  if (r) { clearTimeout(r.sched.timer); r.sched.next = null }
  if (thread(id).line) patch(id, () => ({ line: null, lineDeck: null }))
}

const fingerprint = (slides: SlideDoc[]) => { let h = 5381; for (const x of slides) for (let i = 0; i < x.html.length; i++) h = (h * 33 + x.html.charCodeAt(i)) | 0; return `${slides.length}:${h}` }
const keep = (w: DeckWork): Work => (w.created
  ? { deckId: w.deckId, name: w.name, created: true, madeKey: fingerprint(w.after), summary: w.summary }
  : { deckId: w.deckId, name: w.name, created: false, before: w.before ?? undefined, after: w.after, summary: w.summary })

/** Sends a message in a project chat. Resolves when the turn ends. */
export async function send(projectId: string, id: string, prompt: string, files: Attachment[] = [], opts: { from?: string; readOnly?: boolean } = {}) {
  const text = prompt.trim()
  if (!text || runs.has(id)) return
  openChat.set(projectId, id)
  // Earlier blocks go to the model as a short note; only the newest block's program is sent whole.
  const past = thread(id).turns
  const lastBlockTurn = past.map((t) => t.text.includes('```openui-lang')).lastIndexOf(true)
  const history: ModelMessage[] = past.flatMap((t, i) => [
    { role: 'user' as const, content: t.from ? `(Pressed a button in your block "${t.from}"): ${t.prompt}` : t.prompt },
    ...(t.text ? [{ role: 'assistant' as const, content: summariseBlocks(t.text, i === lastBlockTurn) }] : []),
  ])
  const abort = new AbortController()
  runs.set(id, { abort, vision: null, sched: { shownAt: 0, next: null, timer: 0 } })
  patch(id, (t) => ({ turns: [...t.turns, { prompt: text, files: files.map((f) => f.name), from: opts.from, log: [], text: '', state: 'running', startedAt: Date.now() }] }))
  const log = (item: Item) => patchLast(id, (t) => {
    const last = t.log[t.log.length - 1]
    if (item.kind === 'text' && last?.kind === 'text') return { ...t, log: [...t.log.slice(0, -1), { kind: 'text', text: last.text + item.text }] }
    return { ...t, log: [...t.log, item] }
  })
  try {
    await runProjectAgent({
      projectId, prompt: opts.from ? `(Pressed a button in your block "${opts.from}"): ${text}` : text, files, history, signal: abort.signal, readOnly: opts.readOnly,
      on: (ev) => {
        if (ev.type === 'thinking') { if (ev.on) show(id, 'Thinking', null); else patchLast(id, (t) => ({ ...t, thought: ev.summary })) }
        else if (ev.type === 'activity') {
          // Deck work arrives as "Deck name: activity": the deck shows on its own line above the activity.
          const m = ev.live ? /^(.{1,40}?): (.+)$/.exec(ev.label) : null
          show(id, m ? m[2] : ev.label, m ? m[1] : null)
          if (!ev.live) log({ kind: 'step', label: ev.label })
          else if (m) log({ kind: 'step', label: m[2], deck: m[1] })
        } else if (ev.type === 'text') { flush(id); patchLast(id, (t) => ({ ...t, text: t.text + ev.delta })); log({ kind: 'text', text: ev.delta }) }
        else if (ev.type === 'deck') patchLast(id, (t) => {
          const list = t.decks ?? []
          const w = keep(ev.work)
          return { ...t, decks: list.some((x) => x.deckId === w.deckId) ? list.map((x) => (x.deckId === w.deckId ? w : x)) : [...list, w] }
        })
        else if (ev.type === 'need-vision') { flush(id); runs.get(id)!.vision = ev.resolve; patch(id, () => ({ vision: true })) }
        else if (ev.type === 'error') { flush(id); patchLast(id, (t) => ({ ...t, error: ev.message })) }
      },
    })
    flush(id)
    patchLast(id, (t) => ({ ...t, state: 'done', ms: Date.now() - t.startedAt }))
  } catch (e) {
    flush(id)
    const stopped = abort.signal.aborted
    patchLast(id, (t) => ({ ...t, state: stopped ? 'stopped' : 'done', ms: Date.now() - t.startedAt, error: stopped ? undefined : (e as Error).message }))
  } finally {
    runs.get(id)?.vision?.('continue')
    runs.delete(id)
    patch(id, () => ({ vision: false, line: null, lineDeck: null }))
    save(id)
  }
}

export function stop(id: string) { runs.get(id)?.abort.abort() }
export function chooseVision(id: string, c: 'retry' | 'continue') {
  const r = runs.get(id)
  const f = r?.vision
  if (r) r.vision = null
  patch(id, () => ({ vision: false }))
  f?.(c)
}

/** Asks the last message again as a new turn; the earlier attempt stays, with what it changed and its Undo. */
export function retry(projectId: string, id: string) {
  const last = thread(id).turns.at(-1)
  if (!last || runs.has(id)) return
  void send(projectId, id, last.prompt)
}

/** Undo one deck's part of a turn: a made deck goes to Trash; an edit is put back if nobody changed it since. */
export function undo(id: string, turnAt: number, deckId: string) {
  const w = thread(id).turns.find((x) => x.startedAt === turnAt)?.decks?.find((x) => x.deckId === deckId)
  if (!w || w.undone) return
  const d = getLibrary().entries[deckId]
  if (w.created) {
    if (d?.type === 'deck' && w.madeKey && fingerprint(d.slides) !== w.madeKey) { toast({ message: `“${d.name}” was changed after Ream made it, so it was kept.` }); return }
    if (d) trash([deckId])
  } else {
    if (!d || d.type !== 'deck' || !w.before) return
    if (w.after && fingerprint(d.slides) !== fingerprint(w.after)) { toast({ message: `“${d.name}” changed after this, so it wasn’t undone.` }); return }
    updateSlides(deckId, w.before, { exact: true })
  }
  patch(id, (t) => ({ turns: t.turns.map((x) => (x.startedAt === turnAt ? { ...x, decks: x.decks?.map((y) => (y.deckId === deckId ? { ...y, undone: true } : y)) } : x)) }))
}

// ---- drafts (per account and project; text only) ----
const draftKey = (projectId: string) => scoped(`ream.draft.${projectId}`)
export function getDraft(projectId: string): string { try { return localStorage.getItem(draftKey(projectId)) ?? '' } catch { return '' } }
export function setDraft(projectId: string, text: string) { try { if (text) localStorage.setItem(draftKey(projectId), text); else localStorage.removeItem(draftKey(projectId)) } catch { /* this visit only */ } }

/** Something a block did (put a slide on a deck, made a deck): recorded on its turn with the usual Open/Undo card. */
export function recordWork(id: string, turnAt: number, w: Work) {
  const keepW: Work = w.created ? { ...w, madeKey: fingerprint(w.after ?? []), after: undefined } : w
  patch(id, (t) => ({ turns: t.turns.map((x) => (x.startedAt === turnAt ? { ...x, decks: [...(x.decks ?? []), keepW] } : x)) }))
  save(id)
}

// ---- drafts from blocks: a request put into the project's message box ----
const draftListeners = new Map<string, Set<(text: string) => void>>()
export function draftInto(projectId: string, text: string) {
  const ls = draftListeners.get(projectId)
  if (ls?.size) ls.forEach((l) => l(text))
  else setDraft(projectId, text)
}
export function onDraft(projectId: string, l: (text: string) => void) {
  let set = draftListeners.get(projectId)
  if (!set) draftListeners.set(projectId, (set = new Set()))
  set.add(l)
  return () => { set!.delete(l) }
}
