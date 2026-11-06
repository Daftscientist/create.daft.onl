// AI co-editing panel (docs/design/specs/ai-panel.md + both review rounds), driving the real agent
// (data/ai/agent.ts). Activity lines hold ≥1.6s, queue at most one, and flush when the answer starts.
import { ArrowUp, ChatCircleText, Check, NotePencil, Stop, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { ModelMessage } from 'ai'
import { runAgent } from '../data/ai/agent'
import { useActiveModel } from '../data/ai/settings'
import { getLibrary, updateSlides } from '../data/library'
import { toast } from '../data/toasts'
import type { Deck, SlideDoc } from '../data/types'
import { navigate } from '../lib/router'
import { setEditor } from '../editor/session'
import { endEdit } from '../editor/textctl'
import { modKey } from '../lib/shell'
import { IconButton } from '../ui/Button'
import { DeckThumb } from './DeckThumb'
import { ModelPicker } from './ModelPicker'
import s from './AgentPanel.module.css'

type Step = { label: string; ms: number }
type Turn = {
  prompt: string
  slide: number
  steps: Step[]
  text: string
  thought?: string
  edited?: number[]
  edit?: { before: SlideDoc[]; after: SlideDoc[]; undone?: boolean }
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

  useEffect(() => { input.current?.focus() }, [])
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
  const send = async (prompt: string) => {
    const text = prompt.trim()
    if (!text || running || !ready) return
    setDraft('')
    const target = slide
    const history: ModelMessage[] = turns.flatMap((t) => [{ role: 'user' as const, content: t.prompt }, ...(t.text ? [{ role: 'assistant' as const, content: t.text }] : [])])
    setTurns((ts) => [...ts, { prompt: text, slide: target, steps: [], text: '', state: 'running', startedAt: Date.now() }])
    const ac = new AbortController()
    abort.current = ac
    // The slide the agent is changing is read-only on the canvas until it's done (editor spec, contract 6).
    const lockedId = deck.slides[target]?.id
    endEdit()
    if (lockedId) setEditor((e) => ({ locked: [...e.locked, lockedId], sel: e.slideId === lockedId ? [] : e.sel }))
    try {
      const { before, after } = await runAgent({
        deckId: deck.id, slide: target, prompt: text, history, signal: ac.signal,
        on: (ev) => {
          if (ev.type === 'thinking') {
            if (ev.on) show('Thinking')
            else patchLast((t) => ({ ...t, thought: ev.summary, steps: [...t.steps, { label: 'Thinking', ms: 0 }] }))
          } else if (ev.type === 'activity') {
            show(ev.label)
            patchLast((t) => ({ ...t, steps: [...t.steps, { label: ev.label, ms: 0 }] }))
          } else if (ev.type === 'text') { flush(); patchLast((t) => ({ ...t, text: t.text + ev.delta })) }
          else if (ev.type === 'edit') patchLast((t) => ({ ...t, edited: ev.slides }))
          else if (ev.type === 'error') { flush(); patchLast((t) => ({ ...t, error: ev.message })) }
        },
      })
      flush()
      patchLast((t) => ({ ...t, state: 'done', ms: Date.now() - t.startedAt, edit: before !== after ? { before, after } : undefined }))
    } catch (e) {
      flush()
      const stopped = ac.signal.aborted
      const d = getLibrary().entries[deck.id] as Deck
      patchLast((t) => ({ ...t, state: stopped ? 'stopped' : 'done', ms: Date.now() - t.startedAt, error: stopped ? undefined : (e as Error).message, edit: t.edited?.length ? { before: deck.slides, after: d.slides } : undefined }))
    } finally {
      abort.current = null
      if (lockedId) setEditor((e) => ({ locked: e.locked.filter((x) => x !== lockedId) }))
    }
  }

  const undo = (i: number) => {
    const t = turns[i]
    if (!t.edit || t.edit.undone) return
    const d = getLibrary().entries[deck.id] as Deck
    if (d.slides === t.edit.after) updateSlides(deck.id, t.edit.before, { exact: true })
    else {
      // Only this turn's slides go back, and only those nobody changed since (editor spec, contract 5).
      const before = new Map(t.edit.before.map((x) => [x.id, x]))
      const after = new Map(t.edit.after.map((x) => [x.id, x]))
      let skipped = 0, reverted = 0
      const slides = d.slides.map((x) => {
        const a = after.get(x.id), b = before.get(x.id)
        if (!a || !b || a === b) return x
        if (x === a || x.html === a.html) { reverted++; return b }
        skipped++
        return x
      })
      if (!reverted) { toast({ message: 'Those slides changed after this edit, so it wasn’t undone.' }); return }
      updateSlides(deck.id, slides, { exact: true })
      if (skipped) toast({ message: `${skipped === 1 ? 'One slide was' : `${skipped} slides were`} changed since and kept as they are.` })
    }
    setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, edit: { ...x.edit!, undone: true } } : x)))
  }

  const suggestions = [`Tighten the wording on slide ${slide + 1}`, 'Make a summary slide', `Turn slide ${slide + 1} into a chart`]

  return (
    <aside className={s.panel} aria-label="Ask Ream">
      <header className={s.head}>
        <span className={s.model}><ChatCircleText size={15} /> Ask Ream</span>
        <ModelPicker variant="chip" />
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
            <div className={s.user}>{t.prompt}<span className={s.ctx}>Slide {t.slide + 1}</span></div>
            {t.state === 'running' && !t.text ? (
              <div className={s.activity} role="status" aria-live="polite">
                <span className={s.dot} aria-hidden />
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span key={line ?? 'Working'} className={s.line} aria-hidden initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>
                    {line ?? 'Working'}
                  </motion.span>
                </AnimatePresence>
                <span className="sr-only">Working…</span>
              </div>
            ) : t.steps.length > 0 && (
              <details className={s.steps}>
                <summary>{t.steps.length} steps · {Math.round((t.ms ?? 0) / 1000)}s{t.state === 'stopped' ? ' · stopped' : ''}</summary>
                <ol>{t.steps.map((st, j) => <li key={j}><Check size={12} weight="bold" />{st.label}</li>)}</ol>
              </details>
            )}
            {t.thought && <details className={s.steps}><summary>Thought it through</summary><p className={s.thought}>{t.thought}</p></details>}
            {t.text && <p className={s.answer}>{t.text}</p>}
            {t.error && <p className={s.error}>{t.error}</p>}
            {t.edit && t.edited?.length ? (
              <div className={s.change}>
                <span className={s.changeThumb}><DeckThumb deck={{ ...deck, slides: (t.edit.undone ? t.edit.before : t.edit.after) }} slide={Math.max(0, (t.edited[0] ?? 1) - 1)} /></span>
                <span className={s.changeText}>{t.edit.undone ? 'Undid these edits' : `Edited ${t.edited.length === 1 ? `slide ${t.edited[0]}` : `slides ${t.edited.join(', ')}`}`}</span>
                {!t.edit.undone && t.state !== 'running' && <button type="button" className={s.undo} onClick={() => undo(i)}>Undo</button>}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <form className={s.composer} onSubmit={(e) => { e.preventDefault(); void send(draft) }}>
        <span className={s.chip}>Slide {slide + 1}</span>
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
    </aside>
  )
}

