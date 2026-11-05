// Modal overlay: Smoke backdrop, focus trap, Esc to close, focus returns to the opener.
// Used by the command palette, Quick Look and mobile sheets.
import { motion } from 'motion/react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import s from './Overlay.module.css'

export function Overlay({ onClose, label, children, className, align = 'center' }: {
  onClose: () => void
  label: string
  children: ReactNode
  className?: string
  align?: 'center' | 'top' | 'bottom'
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const root = ref.current
    const first = root?.querySelector<HTMLElement>('[autofocus], input, button, [tabindex="0"]')
    ;(first ?? root)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key !== 'Tab' || !root) return
      const f = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input, [tabindex="0"], a[href]')]
      if (!f.length) return
      const i = f.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus() }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus() }
    }
    addEventListener('keydown', onKey, true)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      removeEventListener('keydown', onKey, true)
      document.body.style.overflow = prevOverflow
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true })
    }
  }, [onClose])

  return createPortal(
    <div className={s.root} data-align={align}>
      <motion.div
        className={s.smoke}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: 0.2 } }}
        exit={{ opacity: 0, transition: { duration: 0.18 } }}
        onClick={onClose}
      />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`${s.content} ${className ?? ''}`}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
