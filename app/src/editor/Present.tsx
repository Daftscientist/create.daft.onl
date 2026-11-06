// Present mode (spec: Present): fullscreen, chrome hidden, the slide fitted, presentation keys
// (→ Space click next, ← back, Home/End, number + Enter). Esc returns to the editor on the slide shown.
// If fullscreen is refused, it fills the window with a small Exit control. Hidden slides are skipped.
// Transitions and click animations play from the same attributes PowerPoint gets (data-transition*,
// data-animate*), so what's rehearsed here is what the exported deck does.
import { CaretLeft, CaretRight, Pause, Play, X } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { notesOf } from './ops'
import type { Deck } from '../data/types'
import { SlideView } from '../slides/SlideView'
import s from './Present.module.css'

type Step = { el: HTMLElement; effect: string; step: number; delay: number; duration: number }
const ENTRANCE = new Set(['appear', 'fade'])
const EXIT = new Set(['disappear', 'fade-out'])
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function stepsOf(stage: HTMLElement): Step[] {
  const out: Step[] = []
  for (const el of stage.querySelectorAll<HTMLElement>('[data-animate]')) {
    const list = (a: string) => (el.getAttribute(a) ?? '').split(/\s+/)
    const effects = list('data-animate'), steps = list('data-animate-step'), delays = list('data-animate-delay'), durs = list('data-animate-duration')
    effects.forEach((effect, i) => { if (effect) out.push({ el, effect, step: +steps[i] || 0, delay: +delays[i] || 0, duration: +durs[i] || 500 }) })
  }
  return out
}
const clicks = (steps: Step[]) => Math.max(0, ...steps.map((x) => x.step))

/** Shows a slide's objects as they stand after `k` clicks, without animating (going back, jumping). */
function settle(steps: Step[], k: number) {
  for (const el of new Set(steps.map((x) => x.el))) {
    const mine = steps.filter((x) => x.el === el)
    const firstEntrance = mine.find((x) => ENTRANCE.has(x.effect))
    let visible = !firstEntrance || firstEntrance.step <= k
    for (const x of mine) if (EXIT.has(x.effect) && x.step <= k) visible = false
    el.style.visibility = visible ? '' : 'hidden'
    el.getAnimations().forEach((a) => a.cancel())
  }
}

/** Plays the effects that start on click `k` (0: as the slide appears). */
function play(steps: Step[], k: number) {
  for (const x of steps.filter((y) => y.step === k)) {
    const opts: KeyframeAnimationOptions = { duration: reduced() ? 1 : x.duration, delay: x.delay, fill: 'both', easing: 'ease-out' }
    const base = x.el.style.transform
    if (x.effect === 'appear') { x.el.style.visibility = ''; x.el.animate([{ opacity: 0 }, { opacity: 1 }], { ...opts, duration: 1 }) }
    else if (x.effect === 'fade') { x.el.style.visibility = ''; x.el.animate([{ opacity: 0 }, { opacity: 1 }], opts) }
    else if (x.effect === 'fade-out') x.el.animate([{ opacity: 1 }, { opacity: 0 }], opts).finished.then(() => { x.el.style.visibility = 'hidden' }).catch(() => {})
    else if (x.effect === 'disappear') setTimeout(() => { x.el.style.visibility = 'hidden' }, x.delay)
    else if (x.effect === 'spin') x.el.animate([{ transform: base }, { transform: `${base} rotate(360deg)` }], { ...opts, fill: 'none' })
    else if (x.effect === 'grow') x.el.animate([{ transform: base }, { transform: `${base} scale(1.5)` }], opts)
  }
}

/** A transition between the outgoing slide and the incoming one, as PowerPoint plays it (cover slides the
 *  new slide over the old, uncover slides the old away, push moves both). Directions as PowerPoint means them. */
function transition(incoming: HTMLElement, outgoing: HTMLElement | null, slideRoot: Element | null, done: () => void): number {
  const type = slideRoot?.getAttribute('data-transition')
  if (!type || type === 'none' || type === 'cut' || reduced()) { done(); return 0 }
  const duration = Number(slideRoot?.getAttribute('data-transition-duration')) || 700
  const dir = (slideRoot?.getAttribute('data-transition-direction') ?? 'l') as 'l' | 'r' | 'u' | 'd'
  const from = { l: 'translateX(100%)', r: 'translateX(-100%)', u: 'translateY(100%)', d: 'translateY(-100%)' }[dir] ?? 'translateX(100%)'
  const to = { l: 'translateX(-100%)', r: 'translateX(100%)', u: 'translateY(-100%)', d: 'translateY(100%)' }[dir] ?? 'translateX(-100%)'
  const clip = { l: 'inset(0 0 0 100%)', r: 'inset(0 100% 0 0)', u: 'inset(100% 0 0 0)', d: 'inset(0 0 100% 0)' }[dir] ?? 'inset(0 0 0 100%)'
  const opts: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'both' }
  const run: Animation[] = []
  const inA = (k: Keyframe[]) => run.push(incoming.animate(k, opts))
  const outA = (k: Keyframe[]) => outgoing && run.push(outgoing.animate(k, opts))
  if (outgoing) outgoing.style.zIndex = type === 'uncover' ? '2' : '0'
  switch (type) {
    case 'push': inA([{ transform: from }, { transform: 'none' }]); outA([{ transform: 'none' }, { transform: to }]); break
    case 'cover': inA([{ transform: from }, { transform: 'none' }]); break
    case 'uncover': outA([{ transform: 'none' }, { transform: to }]); break
    case 'wipe': inA([{ clipPath: clip }, { clipPath: 'inset(0)' }]); break
    case 'split': inA([{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0)' }]); break
    case 'zoom': inA([{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }]); break
    case 'dissolve': inA([{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }]); break
    default: inA([{ opacity: 0 }, { opacity: 1 }]); outA([{ opacity: 1 }, { opacity: 0 }]) // fade, morph
  }
  void Promise.all(run.map((a) => a.finished.catch(() => {}))).then(() => { for (const a of run) a.cancel(); done() })
  return duration
}

export function Present({ deck, start, onExit, presenter = false }: { deck: Deck; start: number; onExit: (slideIndex: number) => void; presenter?: boolean }) {
  const shown = deck.slides.map((sl, i) => ({ sl, i })).filter((x) => !x.sl.hidden || x.i === start)
  const [at, setAt] = useState(() => Math.max(0, shown.findIndex((x) => x.i === start)))
  const [click, setClick] = useState(0)
  const [windowed, setWindowed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLElement | null>(null)
  const steps = useRef<Step[]>([])
  const entering = useRef<'forward' | 'back' | 'jump'>('jump')
  const [leaving, setLeaving] = useState<Deck['slides'][number] | null>(null)
  const leavingRef = useRef<HTMLDivElement>(null)
  const typed = useRef('')
  const atRef = useRef(at)
  useEffect(() => { atRef.current = at }, [at])
  const size = deck.size ?? { w: 1280, h: 720 }
  const [box, setBox] = useState({ w: innerWidth, h: innerHeight })

  const exit = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); onExit(shown[atRef.current]?.i ?? start) }

  useLayoutEffect(() => {
    const el = ref.current!
    if (el.requestFullscreen) el.requestFullscreen().catch(() => setWindowed(true))
    else setWindowed(true)
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    el.focus()
    return () => ro.disconnect()
  }, [])
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement && !windowed) onExit(shown[atRef.current]?.i ?? start) }
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  })

  // A slide arrives: its objects take their starting state, the transition plays, then click-0 effects.
  useLayoutEffect(() => {
    const st = stage.current
    if (!st) return
    steps.current = stepsOf(st)
    const k = entering.current === 'back' ? clicks(steps.current) : 0
    setClick(k)
    settle(steps.current, k)
    if (entering.current !== 'back') {
      if (frame.current && entering.current === 'forward') transition(frame.current, leavingRef.current, st.querySelector('.domoxml-slide'), () => setLeaving(null))
      else setLeaving(null)
      play(steps.current, 0)
    } else setLeaving(null)
  }, [at])

  const next = () => {
    if (click < clicks(steps.current)) { const k = click + 1; setClick(k); play(steps.current, k); return }
    if (at < shown.length - 1) { entering.current = 'forward'; setLeaving(shown[at].sl); setAt(at + 1) }
  }
  const prev = () => {
    if (click > 0) { const k = click - 1; setClick(k); settle(steps.current, k); return }
    if (at > 0) { entering.current = 'back'; setAt(at - 1) }
  }
  const jump = (n: number) => { entering.current = 'jump'; setAt(Math.max(0, Math.min(shown.length - 1, n))) }

  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (/^\d$/.test(k)) { typed.current += k; return }
    if (k === 'Enter' && typed.current) { const n = parseInt(typed.current, 10) - 1; typed.current = ''; const j = shown.findIndex((x) => x.i === n); if (j >= 0) jump(j); return }
    typed.current = ''
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter' || k === 'n') { e.preventDefault(); next() }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p') { e.preventDefault(); prev() }
    else if (k === 'Home') jump(0)
    else if (k === 'End') jump(shown.length - 1)
    else if (k === 'Escape') { e.preventDefault(); exit() }
  }
  // Presenter view: a second window with notes, the next slide and a timer (PowerPoint's ⌥F5).
  // If the browser blocks the window, the presenter screen takes this one instead.
  const [popup, setPopup] = useState<{ win: Window; root: HTMLElement } | null>(null)
  const [inline, setInline] = useState(false)
  useEffect(() => {
    if (!presenter) return
    const win = window.open('', 'ream-presenter', 'width=1100,height=720')
    if (!win) { setInline(true); return }
    win.document.title = `${deck.name} · Presenter view`
    for (const n of document.head.querySelectorAll('style, link[rel="stylesheet"]')) win.document.head.appendChild(n.cloneNode(true))
    win.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? ''
    win.document.body.style.margin = '0'
    const root = win.document.body.appendChild(win.document.createElement('div'))
    root.style.height = '100vh'
    setPopup({ win, root })
    return () => win.close()
  }, [presenter]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!popup) return
    const key = (e: KeyboardEvent) => onKey(e as unknown as React.KeyboardEvent)
    popup.win.addEventListener('keydown', key)
    return () => popup.win.removeEventListener('keydown', key)
  })

  const scale = Math.min(box.w / size.w, box.h / size.h)
  const cur = shown[at]
  const panel = presenter && cur ? <PresenterPanel deck={deck} cur={cur.sl} next={shown[at + 1]?.sl ?? null} index={cur.i} click={click} clicks={clicks(steps.current)} onNext={next} onPrev={prev} onExit={exit} /> : null
  return (
    <div ref={ref} className={s.present} tabIndex={-1} onKeyDown={onKey} role="region" aria-label={`Presenting slide ${(cur?.i ?? 0) + 1} of ${deck.slides.length}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) next() }} onContextMenu={(e) => { e.preventDefault(); prev() }}>
      {cur && (
        <div className={s.stack} style={{ width: size.w * scale, height: size.h * scale }}>
          {leaving && <div ref={leavingRef} className={s.slide}><SlideView key={`out-${leaving.id}`} slide={leaving} size={size} css={deck.css} /></div>}
          <div ref={frame} className={s.slide} style={{ zIndex: 1 }}><SlideView key={cur.sl.id} slide={cur.sl} size={size} css={deck.css} interactive onStage={(st) => { stage.current = st }} /></div>
        </div>
      )}
      {windowed && <button type="button" className={s.exit} onClick={exit}><X size={14} /> Exit</button>}
      {inline && panel && <div className={s.inlinePresenter} onClick={(e) => e.stopPropagation()}>{panel}</div>}
      {popup && panel && createPortal(panel, popup.root)}
      <span className={s.count} aria-live="polite">{(cur?.i ?? 0) + 1} / {deck.slides.length}</span>
    </div>
  )
}

function PresenterPanel({ deck, cur, next, index, click, clicks: total, onNext, onPrev, onExit }: { deck: Deck; cur: Deck['slides'][number]; next: Deck['slides'][number] | null; index: number; click: number; clicks: number; onNext: () => void; onPrev: () => void; onExit: () => void }) {
  const [startAt, setStartAt] = useState(() => Date.now())
  const [paused, setPaused] = useState<number | null>(null)
  const [, tick] = useState(0)
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [])
  const elapsed = Math.floor(((paused ?? Date.now()) - startAt) / 1000)
  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0'), ss = String(elapsed % 60).padStart(2, '0')
  const notes = notesOf(cur)
  const size = deck.size ?? { w: 1280, h: 720 }
  return (
    <div className={s.presenter}>
      <header className={s.pHead}>
        <span className={s.pTimer}>{mm}:{ss}</span>
        <button type="button" className={s.pBtn} onClick={() => { if (paused) { setStartAt(startAt + Date.now() - paused); setPaused(null) } else setPaused(Date.now()) }} aria-label={paused ? 'Resume timer' : 'Pause timer'}>{paused ? <Play size={14} /> : <Pause size={14} />}</button>
        <button type="button" className={s.pBtn} onClick={() => { setStartAt(Date.now()); setPaused(paused ? Date.now() : null) }}>Reset</button>
        <span className={s.pClock}>{new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        <span className={s.pCount}>Slide {index + 1} of {deck.slides.length}{total ? ` · click ${click} of ${total}` : ''}</span>
        <button type="button" className={s.pBtn} onClick={onExit}><X size={14} /> End show</button>
      </header>
      <div className={s.pBody}>
        <div className={s.pCurrent}><div className={s.pFrame} style={{ aspectRatio: `${size.w}/${size.h}` }}><SlideView slide={cur} size={size} css={deck.css} /></div></div>
        <aside className={s.pSide}>
          <div className={s.pLabel}>Next</div>
          {next ? <div className={s.pFrame} style={{ aspectRatio: `${size.w}/${size.h}` }}><SlideView slide={next} size={size} css={deck.css} /></div> : <div className={s.pEnd}>End of show</div>}
          <div className={s.pLabel}>Notes</div>
          <div className={s.pNotes}>{notes || <span className={s.pMuted}>No notes on this slide.</span>}</div>
        </aside>
      </div>
      <footer className={s.pFoot}>
        <button type="button" className={s.pNav} onClick={onPrev} aria-label="Previous"><CaretLeft size={18} /></button>
        <button type="button" className={s.pNav} onClick={onNext} aria-label="Next"><CaretRight size={18} /></button>
      </footer>
    </div>
  )
}
