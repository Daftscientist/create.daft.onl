// Desktop tooltip: appears after 450ms hover or immediately on keyboard focus; never on touch.
import { cloneElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import s from './Tooltip.module.css'

type Child = ReactElement<{
  onPointerEnter?: (e: React.PointerEvent) => void
  onPointerLeave?: (e: React.PointerEvent) => void
  onFocus?: (e: React.FocusEvent) => void
  onBlur?: (e: React.FocusEvent) => void
  ref?: React.Ref<HTMLElement>
}>

let lastClosed = 0 // moving between tooltipped controls skips the delay (macOS behaviour)

export function Tooltip({ label, hint, children, side = 'bottom' }: { label: ReactNode; hint?: string; children: Child; side?: 'bottom' | 'top' | 'right' }) {
  const [rect, setRect] = useState<DOMRect | null>(null)
  const ref = useRef<HTMLElement | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])

  const show = (delay: number) => {
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => ref.current && setRect(ref.current.getBoundingClientRect()), delay)
  }
  const hide = () => {
    clearTimeout(timer.current)
    if (rect) lastClosed = Date.now()
    setRect(null)
  }

  const child = cloneElement(children, {
    ref: (el: HTMLElement | null) => { ref.current = el },
    onPointerEnter: (e: React.PointerEvent) => {
      children.props.onPointerEnter?.(e)
      if (e.pointerType === 'mouse') show(Date.now() - lastClosed < 400 ? 0 : 450)
    },
    onPointerLeave: (e: React.PointerEvent) => { children.props.onPointerLeave?.(e); hide() },
    onFocus: (e: React.FocusEvent) => {
      children.props.onFocus?.(e)
      if ((e.target as HTMLElement).matches(':focus-visible')) show(0)
    },
    onBlur: (e: React.FocusEvent) => { children.props.onBlur?.(e); hide() },
  })

  // Keep the tooltip inside the viewport (it was clipped at the left edge beside the Back button).
  const clampX = (x: number) => Math.min(Math.max(x, 12), innerWidth - 12)
  let style: React.CSSProperties = {}
  if (rect && side !== 'right' && (rect.left + rect.width / 2 < 90 || rect.left + rect.width / 2 > innerWidth - 90)) {
    const leftAligned = rect.left + rect.width / 2 < 90
    style = leftAligned
      ? { left: clampX(rect.left), top: side === 'top' ? rect.top - 8 : rect.bottom + 8, translate: side === 'top' ? '0 -100%' : '0 0' }
      : { left: clampX(rect.right), top: side === 'top' ? rect.top - 8 : rect.bottom + 8, translate: side === 'top' ? '-100% -100%' : '-100% 0' }
  } else if (rect) {
    if (side === 'right') style = { left: rect.right + 8, top: rect.top + rect.height / 2, translate: '0 -50%' }
    else if (side === 'top') style = { left: rect.left + rect.width / 2, top: rect.top - 8, translate: '-50% -100%' }
    else style = { left: rect.left + rect.width / 2, top: rect.bottom + 8, translate: '-50% 0' }
  }
  return (
    <>
      {child}
      {rect && createPortal(
        <div role="tooltip" className={s.tip} style={style}>
          {label}
          {hint && <kbd>{hint}</kbd>}
        </div>,
        document.body,
      )}
    </>
  )
}
