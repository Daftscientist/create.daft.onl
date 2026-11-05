// AI co-editing panel (docs/design/specs/ai-panel.md + both review rounds). Preview only, with a
// scripted "Demo agent". Activity lines hold ≥1.6s, queue at most one, and flush when the answer starts.
import { ArrowUp, ChatCircleText, Check, NotePencil, Stop, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { activityLabel, demoEdit, script } from '../data/agent'
import { getLibrary, updateSlide } from '../data/library'
import { toast } from '../data/toasts'
import type { Deck, SlideSpec } from '../data/types'
import { modKey } from '../lib/shell'
import { IconButton } from '../ui/Button'
import { DeckThumb } from './DeckThumb'
import s from './AgentPanel.module.css'

type Step = { label: string; ms: number }
type Turn = {
  prompt: string
  slide: number
  steps: Step[]
  text: string
  edit?: { slide: number; before: SlideSpec; after: SlideSpec; undone?: boolean }
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
  const stopRef = useRef(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const thread = useRef<HTMLDivElement>(null)
  const atBottom = useRef(true)
  const running = turns.some((t) => t.state === 'running')

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

  const send = async (prompt: string) => {
    const text = prompt.trim()
    if (!text || running) return
    setDraft('')
    stopRef.current = false
    const target = slide
    setTurns((ts) => [...ts, { prompt: text, slide: target, steps: [], text: '', state: 'running', startedAt: Date.now() }])
    for (const ev of script(deck, target, text)) {
      if (stopRef.current) break
      if (ev.type === 'thinking') { show('Thinking'); patchLast((t) => ({ ...t, steps: [...t.steps, { label: 'Thinking', ms: ev.ms }] })); await sleep(ev.ms) }
      else if (ev.type === 'tool') { const l = activityLabel(ev.activity); show(l); patchLast((t) => ({ ...t, steps: [...t.steps, { label: l, ms: ev.ms }] })); await sleep(ev.ms) }
      else if (ev.type === 'edit') {
        const d = getLibrary().entries[deck.id] as Deck
        const before = d.slides[target]
        const after = demoEdit(before)
        updateSlide(deck.id, target, after)
        patchLast((t) => ({ ...t, edit: { slide: target, before, after } }))
      } else if (ev.type === 'text') { flush(); patchLast((t) => ({ ...t, text: t.text + ev.chunk })); await sleep(28) }
      else if (ev.type === 'done') { flush(); patchLast((t) => ({ ...t, state: 'done', ms: Date.now() - t.startedAt })) }
    }
    if (stopRef.current) { flush(); patchLast((t) => ({ ...t, state: 'stopped', ms: Date.now() - t.startedAt })) }
  }

  const undo = (i: number) => {
    const t = turns[i]
    if (!t.edit || t.edit.undone) return
    const d = getLibrary().entries[deck.id] as Deck
    if (d.slides[t.edit.slide] !== t.edit.after) {
      toast({ message: `Slide ${t.edit.slide + 1} changed after this edit, so it wasn’t undone.` })
      return
    }
    updateSlide(deck.id, t.edit.slide, t.edit.before)
    setTurns((ts) => ts.map((x, j) => (j === i ? { ...x, edit: { ...x.edit!, undone: true } } : x)))
  }

  const suggestions = [`Tighten the wording on slide ${slide + 1}`, 'Make a summary slide', `Turn slide ${slide + 1} into a chart`]

  return (
    <aside className={s.panel} aria-label="Ask Ream">
      <header className={s.head}>
        <span className={s.model}><ChatCircleText size={15} /> Ask Ream</span>
        <span className={s.chipModel} title="A scripted demo: no model is connected">Demo · scripted</span>
        <span className={s.headSpacer} />
        <IconButton label="New chat" size="sm" tone="plain" disabled={running || !turns.length} onClick={() => { const prev = turns; setTurns([]); toast({ message: 'Started a new chat', action: { label: 'Undo', run: () => setTurns(prev) } }) }}><NotePencil size={16} /></IconButton>
        <IconButton label="Close" hint={`${modKey}J`} size="sm" tone="plain" onClick={onClose}><X size={16} /></IconButton>
      </header>

      <div className={s.thread} ref={thread} onScroll={(e) => { const el = e.currentTarget; atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {!turns.length && (
          <div className={s.empty}>
            <p className={s.emptyTitle}>Ask Ream to change this deck</p>
            <p className={s.emptyBody}>Changes apply to the deck as it works, and you can undo them.</p>
            <div className={s.suggestions}>
              {suggestions.map((x) => <button key={x} type="button" className={s.suggestion} onClick={() => void send(x)}>{x}</button>)}
            </div>
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
            {t.text && <p className={s.answer}>{t.text}</p>}
            {t.edit && (
              <div className={s.change}>
                <span className={s.changeThumb}><DeckThumb deck={{ ...deck, slides: [t.edit.undone ? t.edit.before : t.edit.after] }} /></span>
                <span className={s.changeText}>{t.edit.undone ? `Undid the edit to slide ${t.edit.slide + 1}` : `Edited slide ${t.edit.slide + 1}`}</span>
                {!t.edit.undone && t.state !== 'running' && <button type="button" className={s.undo} onClick={() => undo(i)}>Undo</button>}
              </div>
            )}
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
          ? <IconButton label="Stop" size="sm" tone="fill" type="button" onClick={() => { stopRef.current = true }}><Stop size={14} weight="fill" /></IconButton>
          : <IconButton label="Send" hint="↵" size="sm" tone="fill" type="submit" disabled={!draft.trim()} className={s.send}><ArrowUp size={15} weight="bold" /></IconButton>}
      </form>
    </aside>
  )
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
