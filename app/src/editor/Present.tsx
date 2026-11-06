// Present mode (spec: Present): fullscreen, chrome hidden, the slide fitted, presentation keys
// (→ Space click next, ← back, Home/End, number + Enter). Esc returns to the editor on the slide shown.
// If fullscreen is refused, it fills the window with a small Exit control. Hidden slides are skipped.
import { X } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Deck } from '../data/types'
import { SlideView } from '../slides/SlideView'
import s from './Present.module.css'

export function Present({ deck, start, onExit }: { deck: Deck; start: number; onExit: (slideIndex: number) => void }) {
  const shown = deck.slides.map((sl, i) => ({ sl, i })).filter((x) => !x.sl.hidden || x.i === start)
  const [at, setAt] = useState(() => Math.max(0, shown.findIndex((x) => x.i === start)))
  const [windowed, setWindowed] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const typed = useRef('')
  const atRef = useRef(at)
  atRef.current = at
  const size = deck.size ?? { w: 1280, h: 720 }
  const [box, setBox] = useState({ w: innerWidth, h: innerHeight })

  const exit = () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); onExit(shown[atRef.current]?.i ?? start) }

  useLayoutEffect(() => {
    const el = ref.current!
    el.requestFullscreen?.().catch(() => setWindowed(true)) ?? setWindowed(true)
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

  const go = (n: number) => setAt(Math.max(0, Math.min(shown.length - 1, n)))
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    if (/^\d$/.test(k)) { typed.current += k; return }
    if (k === 'Enter' && typed.current) { const n = parseInt(typed.current, 10) - 1; typed.current = ''; const j = shown.findIndex((x) => x.i === n); if (j >= 0) go(j); return }
    typed.current = ''
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'PageDown' || k === 'Enter' || k === 'n') { e.preventDefault(); go(at + 1) }
    else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace' || k === 'p') { e.preventDefault(); go(at - 1) }
    else if (k === 'Home') go(0)
    else if (k === 'End') go(shown.length - 1)
    else if (k === 'Escape') { e.preventDefault(); exit() }
  }
  const k = Math.min(box.w / size.w, box.h / size.h)
  const cur = shown[at]
  return (
    <div ref={ref} className={s.present} tabIndex={-1} onKeyDown={onKey} role="region" aria-label={`Presenting slide ${(cur?.i ?? 0) + 1} of ${deck.slides.length}`}
      onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) go(at + 1) }} onContextMenu={(e) => { e.preventDefault(); go(at - 1) }}>
      {cur && <div className={s.slide} style={{ width: size.w * k, height: size.h * k }}><SlideView slide={cur.sl} size={size} css={deck.css} interactive /></div>}
      {windowed && <button type="button" className={s.exit} onClick={exit}><X size={14} /> Exit</button>}
      <span className={s.count} aria-live="polite">{(cur?.i ?? 0) + 1} / {deck.slides.length}</span>
    </div>
  )
}
