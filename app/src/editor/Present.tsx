// Present mode (spec: Present): fullscreen, chrome hidden, the slide fitted, presentation keys
// (→ Space click next, ← back, Home/End, number + Enter). Esc returns to the editor on the slide shown.
// If fullscreen is refused, it fills the window with a small Exit control. Hidden slides are skipped.
// Transitions and click animations play from the same attributes PowerPoint gets (data-transition*,
// data-animate*), so what's rehearsed here is what the exported deck does.
import { X } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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

/** The incoming slide's transition (PowerPoint's names; directions as PowerPoint means them). */
function transition(el: HTMLElement, slideRoot: Element | null) {
  const type = slideRoot?.getAttribute('data-transition')
  if (!type || type === 'none' || type === 'cut' || reduced()) return
  const duration = Number(slideRoot?.getAttribute('data-transition-duration')) || 700
  const dir = slideRoot?.getAttribute('data-transition-direction') ?? 'l'
  const off = { l: 'translateX(100%)', r: 'translateX(-100%)', u: 'translateY(100%)', d: 'translateY(-100%)' }[dir as 'l'] ?? 'translateX(100%)'
  const clip = { l: 'inset(0 0 0 100%)', r: 'inset(0 100% 0 0)', u: 'inset(100% 0 0 0)', d: 'inset(0 0 100% 0)' }[dir as 'l'] ?? 'inset(0 0 0 100%)'
  const frames: Record<string, Keyframe[]> = {
    fade: [{ opacity: 0 }, { opacity: 1 }], dissolve: [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }],
    push: [{ transform: off }, { transform: 'none' }], cover: [{ transform: off }, { transform: 'none' }],
    uncover: [{ opacity: 0.4 }, { opacity: 1 }], wipe: [{ clipPath: clip }, { clipPath: 'inset(0)' }],
    split: [{ clipPath: 'inset(0 50% 0 50%)' }, { clipPath: 'inset(0)' }], zoom: [{ transform: 'scale(0.6)', opacity: 0 }, { transform: 'none', opacity: 1 }],
    morph: [{ opacity: 0 }, { opacity: 1 }],
  }
  el.animate(frames[type] ?? frames.fade, { duration, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
}

export function Present({ deck, start, onExit }: { deck: Deck; start: number; onExit: (slideIndex: number) => void }) {
  const shown = deck.slides.map((sl, i) => ({ sl, i })).filter((x) => !x.sl.hidden || x.i === start)
  const [at, setAt] = useState(() => Math.max(0, shown.findIndex((x) => x.i === start)))
  const [click, setClick] = useState(0)
  const [windowed, setWindowed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLElement | null>(null)
  const steps = useRef<Step[]>([])
  const entering = useRef<'forward' | 'back' | 'jump'>('jump')
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
      if (frame.current && entering.current === 'forward') transition(frame.current, st.querySelector('.domoxml-slide'))
      play(steps.current, 0)
    }
  }, [at])

  const next = () => {
    if (click < clicks(steps.current)) { const k = click + 1; setClick(k); play(steps.current, k); return }
    if (at < shown.length - 1) { entering.current = 'forward'; setAt(at + 1) }
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
  const scale = Math.min(box.w / size.w, box.h / size.h)
  const cur = shown[at]
  return (
    <div ref={ref} className={s.present} tabIndex={-1} onKeyDown={onKey} role="region" aria-label={`Presenting slide ${(cur?.i ?? 0) + 1} of ${deck.slides.length}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) next() }} onContextMenu={(e) => { e.preventDefault(); prev() }}>
      {cur && <div ref={frame} className={s.slide} style={{ width: size.w * scale, height: size.h * scale }}><SlideView key={cur.sl.id} slide={cur.sl} size={size} css={deck.css} interactive onStage={(st) => { stage.current = st }} /></div>}
      {windowed && <button type="button" className={s.exit} onClick={exit}><X size={14} /> Exit</button>}
      <span className={s.count} aria-live="polite">{(cur?.i ?? 0) + 1} / {deck.slides.length}</span>
    </div>
  )
}
