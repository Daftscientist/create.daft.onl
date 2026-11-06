// Anchored paper popover (property forms, galleries): solid paper, clamped to the viewport, Esc closes it
// and returns focus to its button, a click outside closes it (a half-typed field commits first). Colour wells,
// menus and dialogs opened from inside register as child layers (ui/layers): clicks in them don't dismiss it,
// and Esc closes only them. A click on any other surface closes it. Focus moves to its first control.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { LayerContext, useChildLayer } from './layers'
import s from './Popover.module.css'

export function Popover({ anchor, label, onClose, children, width = 280, onClosed, className }: {
  anchor: HTMLElement
  /** The accessible name of the popover. */
  label: string
  onClose: () => void
  children: ReactNode
  width?: number
  /** Where focus goes when Esc closes it (default: the anchor). */
  onClosed?: () => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number } | null>(null)
  const close = useRef(onClose)
  close.current = onClose
  const children_ = useRef(new Set<HTMLElement>())
  const register = useCallback((el: HTMLElement) => { children_.current.add(el); return () => { children_.current.delete(el) } }, [])
  useChildLayer(ref) // a popover opened from inside another popover is its child

  useLayoutEffect(() => {
    const place = () => {
      const r = anchor.getBoundingClientRect(), el = ref.current
      if (!el) return
      const h = el.scrollHeight
      const below = innerHeight - r.bottom - 14, above = r.top - 14
      const down = below >= Math.min(h, 320) || below >= above
      const maxHeight = Math.min(innerHeight * 0.7, down ? below : above)
      const top = down ? r.bottom + 6 : Math.max(8, r.top - 6 - Math.min(h, maxHeight))
      const left = Math.max(8, Math.min(innerWidth - width - 8, r.left))
      setPos((p) => (p && p.left === left && p.top === top && p.maxHeight === maxHeight ? p : { left, top, maxHeight }))
    }
    place()
    const ro = new ResizeObserver(place)
    if (ref.current) ro.observe(ref.current)
    addEventListener('resize', place)
    return () => { ro.disconnect(); removeEventListener('resize', place) }
  }, [anchor, width])

  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], [data-tile], [role=grid], input:not([type=range]), button:not(:disabled), [tabindex="0"], input')
    ;(first ?? ref.current)?.focus({ preventScroll: true })
    const down = (e: PointerEvent) => {
      const t = e.target as Element
      if (ref.current?.contains(t) || anchor.contains(t)) return
      // A child layer (colour popover, menu, dialog) opened from in here.
      for (const c of children_.current) if (c.contains(t)) return
      // Commit a half-typed field to what it was editing before the press changes anything.
      const a = document.activeElement
      if (a instanceof HTMLElement && ref.current?.contains(a)) a.blur()
      close.current()
    }
    addEventListener('pointerdown', down, true)
    return () => removeEventListener('pointerdown', down, true)
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      tabIndex={-1}
      data-ream-layer=""
      className={`${s.popover} ${className ?? ''}`}
      style={{ width, left: pos?.left ?? -9999, top: pos?.top ?? 0, maxHeight: pos?.maxHeight }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault(); e.stopPropagation()
        close.current()
        if (onClosed) onClosed(); else anchor.focus({ preventScroll: true })
      }}
    >
      <LayerContext.Provider value={register}>{children}</LayerContext.Provider>
    </div>,
    document.body,
  )
}
