// AI co-editing panel (docs/design/specs/ai-panel.md + both review rounds), driving the real agent
// (data/ai/agent.ts). Activity lines hold ≥1.6s, queue at most one, and flush when the answer starts.
import { ArrowUp, Check, Eye, Microphone, NotePencil, Paperclip, Stop, Waveform, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ModelMessage } from 'ai'
import { runAgent, type Attachment } from '../data/ai/agent'
import { takePendingAsk } from '../data/ai/pending'
import { type ModelRef, type ReasoningLevel, canSee, modelLabel, providerName, setAi, useActiveModel, useAi } from '../data/ai/settings'
import { useBrowserModel } from '../data/ai/browser'
import { AI_PROVIDER_IDS } from '../data/ai/providers'
import { getEditor } from '../editor/session'
import { historyMark, userEditsSince } from '../editor/history'
import { liveStage } from '../editor/Canvas'
import { objectName } from '../editor/Sections'
import { find } from '../editor/ops'
import { Menu, type MenuAnchor } from '../ui/Menu'
import { getLibrary, updateSlides } from '../data/library'
import { toast } from '../data/toasts'
import type { Deck, SlideDoc } from '../data/types'
import { navigate } from '../lib/router'
import { setEditor } from '../editor/session'
import { endEdit } from '../editor/textctl'
import { modKey } from '../lib/shell'
import { IconButton } from '../ui/Button'
import { DeckThumb } from './DeckThumb'
import { ModelPicker, ReasoningPicker } from './ModelPicker'
import { VoiceMode } from './VoiceMode'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import s from './AgentPanel.module.css'

type Step = { label: string; ms: number }
/** One slide a turn changed, frozen as it was when the turn ended (a deleted slide as it was before). */
type Change = { kind: 'added' | 'edited' | 'deleted' | 'moved'; number: number; slide: SlideDoc }
type Edit = { before: SlideDoc[]; after: SlideDoc[]; undone?: boolean }
/** A voice conversation, in order: what you said, what Ream said (a bubble per pause), and the deck work it did. */
type TalkItem = { kind: 'heard'; text: string; done?: boolean } | { kind: 'said'; text: string } | { kind: 'work'; label: string; done: boolean; changes?: Change[]; edit?: Edit }
/** What happened in a turn, in order: the model's words between (or before) its steps. */
type Item = { kind: 'text'; text: string } | { kind: 'step'; label: string }
type Turn = {
  prompt: string
  slide: number
  steps: Step[]
  log?: Item[]
  /** Said aloud (voice mode). */
  voice?: boolean
  /** A voice conversation (this turn is the whole session). */
  talk?: TalkItem[]
  /** Names of the files attached to the message. */
  files?: string[]
  text: string
  thought?: string
  edited?: number[]
  edit?: { before: SlideDoc[]; after: SlideDoc[]; undone?: boolean }
  changes?: Change[]
  error?: string
  state: 'running' | 'done' | 'stopped'
  startedAt: number
  ms?: number
}

const DWELL = 1600
const key = (deckId: string) => `ream.agent.${deckId}`

export function AgentPanel({ deck, slide, onClose }: { deck: Deck; slide: number; onClose: () => void }) {
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(localStorage.getItem(key(deck.id)) ?? '[]') } catch { return [] } })
  const [draft, setDraft] = useState('')
  const [line, setLine] = useState<string | null>(null)
  const sched = useRef({ shownAt: 0, next: null as string | null, timer: 0 })
  const input = useRef<HTMLTextAreaElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const running = turns.some((t) => t.state === 'running')
  const ready = !!useActiveModel()
  const busy = useRef(false)
  const [voice, setVoice] = useState(false)
  const [files, setFiles] = useState<Attachment[]>([])
  // The model asked to see slides it can't: the run waits on the user's choice here.
  const visionWait = useRef<((c: 'retry' | 'continue') => void) | null>(null)
  const [vision, setVision] = useState(false)
  const chooseVision = (c: 'retry' | 'continue') => { const r = visionWait.current; visionWait.current = null; setVision(false); r?.(c) }
  const mark = useRef(historyMark())
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => { input.current?.focus() }, [])
  // A prompt from Home: make the presentation as soon as the panel is up.
  useEffect(() => {
    // Taken when it runs, so a cancelled first mount (React's double effects in development) can't lose it.
    const t = setTimeout(() => {
      const p = takePendingAsk(deck.id)
      if (p) void send(p.fresh ? `Make a new presentation: ${p.prompt}\n\n(This deck is new: replace its placeholder first slide with your title slide, create the rest with create_slides, and give the deck a short name with rename_deck.)` : p.prompt, p.files, { display: p.prompt })
    }, 50)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // The box grows with what you type and shrinks back once it's sent.
  useEffect(() => { if (!draft && input.current) input.current.style.height = '' }, [draft])
  useEffect(() => { try { localStorage.setItem(key(deck.id), JSON.stringify(turns.map((t) => (t.state === 'running' ? { ...t, state: 'stopped' } : t)))) } catch { /* ok */ } }, [turns, deck.id])
  useEffect(() => { if (atBottom.current) thread.current?.scrollTo({ top: thread.current.scrollHeight }) }, [turns, line])

  // ---- activity scheduler ----
  const show = (label: string) => {
    const sc = sched.current
    const wait = DWELL - (Date.now() - sc.shownAt)
    if (!line || wait <= 0) { sc.shownAt = Date.now(); setLine(label); return }
    sc.next = label // cap the queue at one: always jump to the newest
    clearTimeout(sc.timer)
    sc.timer = window.setTimeout(() => { if (sc.next) { sc.shownAt = Date.now(); setLine(sc.next); sc.next = null } }, wait)
  }
  const flush = () => { clearTimeout(sched.current.timer); sched.current.next = null; setLine(null) }

  const patchLast = (fn: (t: Turn) => Turn) => setTurns((ts) => ts.map((t, i) => (i === ts.length - 1 ? fn(t) : t)))

  const abort = useRef<AbortController | null>(null)
  /** Runs one turn; resolves with its final reply (voice speaks it). */
  const send = async (prompt: string, withFiles?: Attachment[], o: { model?: ModelRef | null; reasoning?: ReasoningLevel; voice?: boolean; display?: string } = {}): Promise<string> => {
    const text = prompt.trim()
    if (!text || busy.current || !ready) return busy.current ? 'Still working on the last request.' : ''
    busy.current = true
    let reply = ''
    setDraft('')
    const target = slide
    const attached = withFiles ?? files
    setFiles([])
    // What the user is doing: the open slide, the selection, and what they changed by hand since last time.
    const st = getEditor(), stage = liveStage()
    const context = {
      slide: target,
      selection: st.sel.map((id) => { const el = stage && find(stage, id); return { id, name: el ? objectName(el) : id } }),
      editsSince: userEditsSince(deck.id, mark.current),
    }
    const history: ModelMessage[] = turns.flatMap((t) => [{ role: 'user' as const, content: t.prompt }, ...(t.text ? [{ role: 'assistant' as const, content: t.text }] : [])])
    setTurns((ts) => [...ts, { prompt: o.display ?? text, slide: target, steps: [], log: [], files: attached.map((f) => f.name), voice: o.voice, text: '', state: 'running', startedAt: Date.now() }])
    const ac = new AbortController()
    abort.current = ac
    // A slide the agent has changed is read-only on the canvas until the run ends (editor spec, contract 6).
    // Only slides it actually touches: asking for a new slide leaves the one you're on alone.
    const lockedIds = new Set<string>()
    const lock = (numbers: number[]) => {
      const d = getLibrary().entries[deck.id] as Deck
      const ids = numbers.map((n) => d.slides[n - 1]?.id).filter((x): x is string => !!x && !lockedIds.has(x))
      if (!ids.length) return
      ids.forEach((x) => lockedIds.add(x))
      endEdit()
      setEditor((e) => ({ locked: [...e.locked, ...ids], sel: ids.includes(e.slideId ?? '') ? [] : e.sel }))
    }
    const log = (item: Item) => patchLast((t) => {
      const l = t.log ?? []
      const last = l[l.length - 1]
      if (item.kind === 'text' && last?.kind === 'text') return { ...t, log: [...l.slice(0, -1), { kind: 'text', text: last.text + item.text }] }
      return { ...t, log: [...l, item] }
    })
    try {
      const { before, after } = await runAgent({
        deckId: deck.id, context, files: attached, prompt: text, history, signal: ac.signal, model: o.model, reasoning: o.reasoning, voice: o.voice,
        on: (ev) => {
          if (ev.type === 'thinking') {
            if (ev.on) show('Thinking')
            else patchLast((t) => ({ ...t, thought: ev.summary, steps: [...t.steps, { label: 'Thinking', ms: 0 }] }))
          } else if (ev.type === 'activity') {
            show(ev.label)
            if (ev.live) return
            patchLast((t) => ({ ...t, steps: [...t.steps, { label: ev.label, ms: 0 }] }))
            log({ kind: 'step', label: ev.label })
          } else if (ev.type === 'text') { flush(); reply += ev.delta; patchLast((t) => ({ ...t, text: t.text + ev.delta })); log({ kind: 'text', text: ev.delta }) }
          else if (ev.type === 'edit') { lock(ev.slides); patchLast((t) => ({ ...t, edited: ev.slides })) }
          else if (ev.type === 'changed') dispatchEvent(new CustomEvent('ream:ai-edit', { detail: ev }))
          else if (ev.type === 'need-vision') { flush(); visionWait.current = ev.resolve; setVision(true) }
          else if (ev.type === 'error') { flush(); patchLast((t) => ({ ...t, error: ev.message })) }
        },
      })
      flush()
      patchLast((t) => ({ ...t, state: 'done', ms: Date.now() - t.startedAt, edit: before !== after ? { before, after } : undefined, changes: before !== after ? changesOf(before, after) : undefined }))
    } catch (e) {
      flush()
      const stopped = ac.signal.aborted
      const d = getLibrary().entries[deck.id] as Deck
      patchLast((t) => ({ ...t, state: stopped ? 'stopped' : 'done', ms: Date.now() - t.startedAt, error: stopped ? undefined : (e as Error).message, edit: t.edited?.length ? { before: deck.slides, after: d.slides } : undefined, changes: t.edited?.length ? changesOf(deck.slides, d.slides) : undefined }))
    } finally {
      abort.current = null
      mark.current = historyMark()
      chooseVision('continue')
      busy.current = false
      if (lockedIds.size) setEditor((e) => ({ locked: e.locked.filter((x) => !lockedIds.has(x)) }))
    }
    return reply
  }

  /** Files for the next message: text files as text, pictures and PDFs as data URLs (20 MB each at most). */
  const attach = async (list: FileList) => {
    const out: Attachment[] = []
    for (const f of [...list].slice(0, 8)) {
      if (f.size > 20 * 1024 * 1024) { toast({ message: `${f.name} is over 20 MB, so it wasn’t attached.` }); continue }
      const type = f.type || (/\.(md|txt|csv|json)$/i.test(f.name) ? 'text/plain' : 'application/octet-stream')
      const data = type.startsWith('text/') || /json|xml/.test(type) ? await f.text() : await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })
      out.push({ name: f.name, mediaType: type, data })
    }
    setFiles((x) => [...x, ...out])
  }

  /** Puts back what an edit changed: only its slides, and only those nobody changed since (editor spec, contract 5).
   *  Slides it added go too, unless they've been edited. */
  const revert = (edit: Edit): boolean => {
    const d = getLibrary().entries[deck.id] as Deck
    if (d.slides === edit.after) { updateSlides(deck.id, edit.before, { exact: true }); return true }
    const before = new Map(edit.before.map((x) => [x.id, x]))
    const after = new Map(edit.after.map((x) => [x.id, x]))
    let skipped = 0, reverted = 0
    const slides = d.slides.flatMap((x) => {
      const a = after.get(x.id), b = before.get(x.id)
      if (!a || a === b) return [x]
      if (!b) { if (x === a || x.html === a.html) { reverted++; return [] } skipped++; return [x] }
      if (x === a || x.html === a.html) { reverted++; return [b] }
      skipped++
      return [x]
    })
    if (!reverted) { toast({ message: 'Those slides changed after this edit, so it wasn’t undone.' }); return false }
    updateSlides(deck.id, slides, { exact: true })
    if (skipped) toast({ message: `${skipped === 1 ? 'One slide was' : `${skipped} slides were`} changed since and kept as they are.` })
    return true
  }
  const undo = (i: number) => {
    const t = turns[i]
    if (!t.edit || t.edit.undone || !revert(t.edit)) return
    setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, edit: { ...x.edit!, undone: true } } : x)))
  }

  // ---- voice: a conversation turn, with hidden deck work ----
  const talkAt = useRef(0), talkSeq = useRef(0)
  // Started by the Talk button (one turn per voice session; switching voices keeps it).
  const startTalk = () => { talkAt.current = Date.now() * 100 + (talkSeq.current++ % 100); setTurns((ts) => [...ts.filter((t) => !(t.voice && t.talk && !t.talk.length)), { prompt: '', slide, steps: [], voice: true, talk: [], text: '', state: 'done', startedAt: talkAt.current }]) }
  const patchTalk = (fn: (items: TalkItem[]) => TalkItem[]) => setTurns((ts) => ts.map((t) => (t.startedAt === talkAt.current && t.talk ? { ...t, talk: fn(t.talk) } : t)))
  const heard = (text: string, final: boolean) => patchTalk((items) => {
    const last = items[items.length - 1]
    if (last?.kind === 'heard' && !last.done) return [...items.slice(0, -1), { kind: 'heard', text, done: final }]
    return text ? [...items, { kind: 'heard', text, done: final }] : items
  })
  const said = (text: string, fresh: boolean) => patchTalk((items) => {
    const last = items[items.length - 1]
    if (!fresh && last?.kind === 'said') return [...items.slice(0, -1), { kind: 'said', text }]
    return [...items, { kind: 'said', text }]
  })
  const workChain = useRef<Promise<unknown>>(Promise.resolve())
  const working = useRef(new Set<AbortController>())
  /** Stop (or leaving voice) stops the deck work too: the running job aborts, queued ones never start. */
  const cancelWork = () => { for (const ac of working.current) ac.abort(); working.current.clear() }
  /** The voice's delegated work: the deck agent, hidden. Its activity shows on a work row; what changed shows as a
   *  card; its words go back to the voice to say, not into the thread. One job at a time. */
  const delegate = (request: string, progress: (label: string) => void): Promise<string> => {
    const ac = new AbortController(); working.current.add(ac)
    const job = workChain.current.then(async () => {
      if (ac.signal.aborted) return 'Stopped before it started; nothing was changed.'
      patchTalk((items) => [...items, { kind: 'work', label: 'Working on it', done: false }])
      const setWork = (fn: (w: TalkItem & { kind: 'work' }) => TalkItem & { kind: 'work' }) => patchTalk((items) => {
        const at = items.map((x) => x.kind).lastIndexOf('work')
        return at < 0 ? items : items.map((x, i) => (i === at && x.kind === 'work' ? fn(x) : x))
      })
      const before = (getLibrary().entries[deck.id] as Deck).slides
      const lockedIds = new Set<string>()
      let reply = ''
      const st = getEditor(), stage = liveStage()
      try {
        await runAgent({
          deckId: deck.id, prompt: request, history: [], signal: ac.signal,
          context: { slide, selection: st.sel.map((sid) => { const el = stage && find(stage, sid); return { id: sid, name: el ? objectName(el) : sid } }), editsSince: userEditsSince(deck.id, mark.current) },
          model: voiceThinker.current?.model, reasoning: voiceThinker.current?.reasoning,
          on: (ev) => {
            if (ev.type === 'activity') { setWork((w) => ({ ...w, label: ev.label })); progress(ev.label) }
            else if (ev.type === 'text') reply += ev.delta
            else if (ev.type === 'changed') dispatchEvent(new CustomEvent('ream:ai-edit', { detail: ev }))
            else if (ev.type === 'need-vision') ev.resolve('continue')
            else if (ev.type === 'edit') {
              const d = getLibrary().entries[deck.id] as Deck
              const ids = ev.slides.map((n) => d.slides[n - 1]?.id).filter((x): x is string => !!x && !lockedIds.has(x))
              if (ids.length) { ids.forEach((x) => lockedIds.add(x)); setEditor((e) => ({ locked: [...e.locked, ...ids] })) }
            }
          },
        })
      } catch (e) { reply = ac.signal.aborted ? 'Stopped, as asked.' : `It didn’t work: ${(e as Error).message}` }
      finally {
        working.current.delete(ac)
        if (lockedIds.size) setEditor((e) => ({ locked: e.locked.filter((x) => !lockedIds.has(x)) }))
        mark.current = historyMark()
      }
      const after = (getLibrary().entries[deck.id] as Deck).slides
      const changes = before !== after ? changesOf(before, after) : []
      setWork((w) => ({ ...w, done: true, label: changes.length ? summary(changes) : ac.signal.aborted ? 'Stopped' : 'Looked at the deck', changes: changes.length ? changes : undefined, edit: changes.length ? { before, after } : undefined }))
      return ac.signal.aborted ? `Stopped, as asked.${changes.length ? ` Before stopping: ${summary(changes)}.` : ' Nothing was changed.'}` : reply.trim()
    })
    workChain.current = job.catch(() => undefined)
    return job
  }
  const voiceThinker = useRef<{ model?: ModelRef | null; reasoning?: ReasoningLevel } | null>(null)
  const undoWork = (turnAt: number, itemAt: number) => setTurns((ts) => ts.map((t) => {
    if (t.startedAt !== turnAt || !t.talk) return t
    return { ...t, talk: t.talk.map((x, i) => (i === itemAt && x.kind === 'work' && x.edit && !x.edit.undone && revert(x.edit) ? { ...x, edit: { ...x.edit, undone: true } } : x)) }
  }))

  const suggestions = [`Tighten the wording on slide ${slide + 1}`, 'Make a summary slide', `Turn slide ${slide + 1} into a chart`]

  return (
    <aside className={s.panel} aria-label="Ask Ream">
      <header className={s.head}>
        <span className={s.headSpacer} />
        <IconButton label="New chat" size="sm" tone="plain" disabled={running || !turns.length} onClick={() => { const prev = turns; setTurns([]); toast({ message: 'Started a new chat', action: { label: 'Undo', run: () => setTurns(prev) } }) }}><NotePencil size={16} /></IconButton>
        <IconButton label="Close" hint={`${modKey}J`} size="sm" tone="plain" onClick={onClose}><X size={16} /></IconButton>
      </header>

      <div className={s.thread} ref={thread} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {!turns.length && (
          <div className={s.empty}>
            <p className={s.emptyTitle}>Ask Ream to change this deck</p>
            <p className={s.emptyBody}>{ready ? 'Changes apply to the deck as it works, and you can undo them.' : 'Ream uses your own AI provider account. Add a key in Settings to start.'}</p>
            {!ready && <button type="button" className={s.suggestion} onClick={() => navigate({ name: 'settings', section: 'ai' })}>Set up AI in Settings</button>}
            {ready && <div className={s.suggestions}>
              {suggestions.map((x) => <button key={x} type="button" className={s.suggestion} onClick={() => void send(x)}>{x}</button>)}
            </div>}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={s.turn}>
            {t.talk ? <TalkView turn={t} deck={deck} onUndo={(k) => undoWork(t.startedAt, k)} /> : <>
            <div className={s.user}>{t.voice && <Microphone size={12} weight="bold" className={s.mic} aria-label="Said aloud" />}{t.prompt}<span className={s.ctx}>Slide {t.slide + 1}{t.files?.length ? ` · ${t.files.join(', ')}` : ''}</span></div>
            {t.log ? <Log turn={t} line={line} /> : <>
              {t.state === 'running' && !t.text ? <Activity line={line} /> : t.steps.length > 0 && (
                <details className={s.steps}>
                  <summary>{t.steps.length} steps · {Math.round((t.ms ?? 0) / 1000)}s{t.state === 'stopped' ? ' · stopped' : ''}</summary>
                  <ol>{t.steps.map((st, j) => <li key={j}><Check size={12} weight="bold" />{st.label}</li>)}</ol>
                </details>
              )}
            </>}
            {t.thought && <details className={s.steps}><summary>Thought it through</summary><p className={s.thought}>{t.thought}</p></details>}
            {!t.log && t.text && <p className={s.answer}>{t.text}</p>}
            {t.error && <p className={s.error}>{t.error}</p>}
            {t.changes?.length && t.edit ? <ChangeCard deck={deck} changes={t.changes} undone={!!t.edit.undone} onUndo={t.state !== 'running' ? () => undo(i) : undefined} />
              : t.edit && t.edited?.length ? (
              <div className={s.change}>
                <span className={s.changeThumb}><DeckThumb deck={{ ...deck, slides: (t.edit.undone ? t.edit.before : t.edit.after) }} slide={Math.max(0, (t.edited[0] ?? 1) - 1)} /></span>
                <span className={s.changeText}>{t.edit.undone ? 'Undid these edits' : `Edited ${t.edited.length === 1 ? `slide ${t.edited[0]}` : `slides ${t.edited.join(', ')}`}`}</span>
                {!t.edit.undone && t.state !== 'running' && <button type="button" className={s.undo} onClick={() => undo(i)}>Undo</button>}
              </div>
            ) : null}
            </>}
          </div>
        ))}
      {vision && <VisionCard onChoice={chooseVision} />}
      </div>

      {voice ? (
        <VoiceMode
          onStart={(thinker) => { voiceThinker.current = thinker }}
          onHeard={heard}
          onSaid={said}
          delegate={delegate}
          onStop={cancelWork}
          onExit={() => { cancelWork(); setVoice(false); setTurns((ts) => ts.filter((t) => !(t.voice && t.talk && !t.talk.length))) }}
        />
      ) : (
      <form className={s.composer} onSubmit={(e) => { e.preventDefault(); void send(draft) }}
          onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation() } }}
          onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void attach(e.dataTransfer.files) } }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach(e.clipboardData.files) } }}>
          <span className={s.chips}>
            <span className={s.chip}>Slide {slide + 1}</span>
            {files.map((f, i) => <span key={i} className={s.fileChip}>{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={10} weight="bold" /></button></span>)}
          </span>
          <span className={s.pickers}>
            <IconButton label="Attach files" size="sm" tone="plain" type="button" onClick={() => picker.current?.click()}><Paperclip size={15} /></IconButton>
            <input ref={picker} type="file" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.json,.html,.xml" onChange={(e) => { if (e.target.files) void attach(e.target.files); e.target.value = '' }} />
            <ModelPicker variant="chip" /><ReasoningPicker />
          </span>
          <IconButton label="Talk to Ream" size="sm" tone="plain" type="button" className={s.talk} onClick={() => { startTalk(); setVoice(true) }}><Waveform size={16} weight="bold" /></IconButton>
          <textarea
            ref={input}
            rows={1}
            value={draft}
            placeholder="Ask Ream to change this deck"
            aria-label="Message"
            onChange={(e) => { setDraft(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(160, e.currentTarget.scrollHeight)}px` }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft) }
              if (e.key === 'Escape' && !draft) { e.preventDefault(); (document.querySelector('[data-stage]') as HTMLElement | null)?.focus() }
              e.stopPropagation()
            }}
          />
          {running
            ? <IconButton label="Stop" size="sm" tone="fill" type="button" onClick={() => abort.current?.abort()}><Stop size={14} weight="fill" /></IconButton>
            : <IconButton label="Send" hint="↵" size="sm" tone="fill" type="submit" disabled={!draft.trim()} className={s.send}><ArrowUp size={15} weight="bold" /></IconButton>}
        </form>
      )}
    </aside>
  )
}

function Activity({ line }: { line: string | null }) {
  return (
    <div className={s.activity} role="status" aria-live="polite">
      <span className={s.dot} aria-hidden />
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={line ?? 'Working'} className={s.line} aria-hidden initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
          {line ?? 'Working'}
        </motion.span>
      </AnimatePresence>
      <span className="sr-only">Working…</span>
    </div>
  )
}

/** A turn as it happened: the model's messages in order, with each run of steps between them folded into one
 *  line ("3 steps") you can open. While it runs, the live activity line sits at the end. */
function Log({ turn: t, line }: { turn: Turn; line: string | null }) {
  const groups: ({ kind: 'text'; text: string } | { kind: 'steps'; labels: string[] })[] = []
  for (const it of t.log ?? []) {
    const last = groups[groups.length - 1]
    if (it.kind === 'step') { if (last?.kind === 'steps') last.labels.push(it.label); else groups.push({ kind: 'steps', labels: [it.label] }) }
    else if (it.text.trim()) groups.push({ kind: 'text', text: it.text })
  }
  const running = t.state === 'running'
  return (
    <>
      {groups.map((g, j) => g.kind === 'text'
        ? <p key={j} className={s.answer}>{g.text.trim()}</p>
        : (running && j === groups.length - 1) ? null
          : <details key={j} className={s.steps}><summary>{g.labels.length === 1 ? g.labels[0] : `${g.labels.length} steps`}</summary><ol>{g.labels.map((l, k) => <li key={k}><Check size={12} weight="bold" />{l}</li>)}</ol></details>)}
      {running && <Activity line={line} />}
      {!running && t.ms !== undefined && <p className={s.meta}>{Math.round(t.ms / 1000)}s{t.state === 'stopped' ? ' · stopped' : ''}</p>}
    </>
  )
}

/** What a turn changed, slide by slide, each frozen as it was when the turn ended. */
function changesOf(before: SlideDoc[], after: SlideDoc[]): Change[] {
  const was = new Map(before.map((x, i) => [x.id, { x, i }]))
  const out: Change[] = []
  after.forEach((x, i) => {
    const b = was.get(x.id)
    if (!b) out.push({ kind: 'added', number: i + 1, slide: x })
    else if (b.x.html !== x.html) out.push({ kind: 'edited', number: i + 1, slide: x })
  })
  const now = new Set(after.map((x) => x.id))
  before.forEach((x, i) => { if (!now.has(x.id)) out.push({ kind: 'deleted', number: i + 1, slide: x }) })
  if (!out.length) {
    // Only the order changed.
    after.forEach((x, i) => { if (was.get(x.id)?.i !== i) out.push({ kind: 'moved', number: i + 1, slide: x }) })
  }
  return out.slice(0, 24)
}

const VERB = { added: 'Added', edited: 'Edited', deleted: 'Deleted', moved: 'Moved' } as const
function summary(changes: Change[]): string {
  return (['added', 'edited', 'deleted', 'moved'] as const).map((k) => {
    const n = changes.filter((c) => c.kind === k).map((c) => c.number)
    return n.length ? `${VERB[k]} ${n.length === 1 ? `slide ${n[0]}` : `slides ${n.join(', ')}`}` : ''
  }).filter(Boolean).join(' · ')
}

/** The card a turn leaves: frozen thumbnails of what it changed; open it to see them large. */
function ChangeCard({ deck, changes, undone, onUndo }: { deck: Deck; changes: Change[]; undone: boolean; onUndo?: () => void }) {
  const [open, setOpen] = useState(false)
  const shown = changes.slice(0, 3)
  return (
    <div className={s.change}>
      <button type="button" className={s.changeOpen} onClick={() => setOpen(true)} aria-label={`View the changes: ${summary(changes)}`}>
        <span className={s.stack} data-n={shown.length}>
          {shown.map((c, j) => <span key={j} className={s.changeThumb} data-deleted={c.kind === 'deleted' || undefined}><DeckThumb deck={{ ...deck, slides: [c.slide] }} /></span>)}
        </span>
        <span className={s.changeText}>{undone ? 'Undid these edits' : summary(changes)}</span>
      </button>
      {!undone && onUndo && <button type="button" className={s.undo} onClick={onUndo}>Undo</button>}
      {open && (
        <Dialog title={summary(changes)} width={720} onClose={() => setOpen(false)} actions={<Button variant="secondary" onClick={() => setOpen(false)}>Done</Button>}>
          <div className={s.changeList}>
            {changes.map((c, j) => (
              <figure key={j} className={s.changeBig}>
                <div data-deleted={c.kind === 'deleted' || undefined}><DeckThumb deck={{ ...deck, slides: [c.slide] }} /></div>
                <figcaption>{VERB[c.kind]} slide {c.number}{c.kind === 'deleted' ? ' (as it was)' : ''}</figcaption>
              </figure>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  )
}

/** Shown when the model wants to look at slides but can't see pictures: pick a model that can, or carry on. */
function VisionCard({ onChoice }: { onChoice: (c: 'retry' | 'continue') => void }) {
  const ai = useAi()
  const browser = useBrowserModel()
  const active = useActiveModel()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const options = AI_PROVIDER_IDS.filter((id) => ai.providers[id]).flatMap((id) => (ai.models?.[id] ?? []).map((m) => ({ provider: id, id: m }))).filter((m) => canSee(ai, m))
  return (
    <div className={s.visionCard} role="group" aria-label="Choose a model that can see">
      <p><Eye size={15} /> {active ? modelLabel(active, browser) : 'This model'} can’t see pictures, so it can’t look at your slides. Choose a model that can describe them, or continue without.</p>
      <div className={s.visionActions}>
        {options.length
          ? <Button variant="primary" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6 }) }}>Choose a model</Button>
          : <Button variant="primary" onClick={() => navigate({ name: 'settings', section: 'ai' })}>Connect one in Settings</Button>}
        <Button variant="ghost" onClick={() => onChoice('continue')}>Continue without</Button>
      </div>
      <Menu open={!!menu} anchor={menu} label="Model for pictures" onClose={() => setMenu(null)} search={options.length > 10 ? 'Find a model' : undefined}
        items={options.map((m) => ({ label: m.id, hint: providerName(m.provider, browser), run: () => { setAi({ visionModel: m }); onChoice('retry') } }))} />
    </div>
  )
}

/** A voice conversation: your bubbles on the right, Ream's on the left (one per pause), and its deck work as a quiet
 *  row with what changed. */
function TalkView({ turn, deck, onUndo }: { turn: Turn; deck: Deck; onUndo: (itemAt: number) => void }) {
  return (
    <div className={s.talk}>
      {(turn.talk ?? []).map((x, k) => x.kind === 'heard'
        ? <div key={k} className={s.bubbleMe} data-live={!x.done || undefined}><Microphone size={11} weight="bold" className={s.mic} aria-hidden />{x.text}</div>
        : x.kind === 'said'
          ? (/[\p{L}\p{N}]/u.test(x.text) ? <div key={k} className={s.bubbleReam}>{x.text}</div> : null)
          : (
            <div key={k} className={s.work}>
              <div className={s.workLine} role={x.done ? undefined : 'status'}>{x.done ? <Check size={12} weight="bold" /> : <span className={s.dot} aria-hidden />}{x.label}</div>
              {x.changes && x.edit && <ChangeCard deck={deck} changes={x.changes} undone={!!x.edit.undone} onUndo={() => onUndo(k)} />}
            </div>
          ))}
      {!turn.talk?.length && <p className={s.meta}>Listening. Say what you’d like to change.</p>}
    </div>
  )
}
