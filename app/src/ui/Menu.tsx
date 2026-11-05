// Context menu / ⋯ menu (DESIGN.md §6 Menu). Glass, keyboard-driven, returns focus to its trigger.
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { snappy } from '../lib/motion'
import s from './Menu.module.css'

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; run: () => void }
  | { kind: 'sep' }
  | { kind: 'header'; content: ReactNode }
  | { kind: 'note'; text: string }

export type MenuAnchor = { x: number; y: number; align?: 'start' | 'end' }

export function Menu({ open, anchor, items, onClose, label }: {
  open: boolean
  anchor: MenuAnchor | null
  items: MenuItem[]
  onClose: () => void
  label: string
}) {
  return createPortal(
    <AnimatePresence>
      {open && anchor && <MenuPanel key="m" anchor={anchor} items={items} onClose={onClose} label={label} />}
    </AnimatePresence>,
    document.body,
  )
}

function MenuPanel({ anchor, items, onClose, label }: { anchor: MenuAnchor; items: MenuItem[]; onClose: () => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; origin: string }>({ left: anchor.x, top: anchor.y, origin: 'top left' })
  const [active, setActive] = useState(-1)
  useEffect(() => {
    if (active >= 0) ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.focus({ preventScroll: true })
  }, [active])
  const returnTo = useRef<Element | null>(document.activeElement)
  const typed = useRef({ text: '', at: 0 })
  const actionable = items.map((it, i) => (!it.kind || it.kind === 'item') && !it.disabled ? i : -1).filter((i) => i >= 0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let left = anchor.align === 'end' ? anchor.x - width : anchor.x
    let top = anchor.y
    let v = 'top'
    if (top + height > innerHeight - 8) { top = Math.max(8, anchor.y - height); v = 'bottom' }
    left = Math.min(Math.max(8, left), innerWidth - width - 8)
    setPos({ left, top, origin: `${v} ${anchor.align === 'end' ? 'right' : 'left'}` })
    el.focus()
  }, [anchor])

  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) closeRef.current() }
    const onBlur = () => closeRef.current()
    addEventListener('pointerdown', close, true)
    addEventListener('wheel', close, { capture: true, passive: true })
    addEventListener('resize', onBlur)
    addEventListener('blur', onBlur)
    const el = returnTo.current
    return () => {
      removeEventListener('pointerdown', close, true)
      removeEventListener('wheel', close, true)
      removeEventListener('resize', onBlur)
      removeEventListener('blur', onBlur)
      if (el instanceof HTMLElement && document.contains(el)) el.focus({ preventScroll: true })
    }
  }, [])

  const run = (i: number) => {
    const it = items[i]
    if (!it || (it.kind && it.kind !== 'item') || it.disabled) return
    onClose()
    it.run()
  }

  const onKey = (e: React.KeyboardEvent) => {
    const idx = actionable.indexOf(active)
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(actionable[(idx + 1) % actionable.length]) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(actionable[(idx - 1 + actionable.length) % actionable.length]) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(actionable[0]) }
    else if (e.key === 'End') { e.preventDefault(); setActive(actionable[actionable.length - 1]) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (active >= 0) run(active) }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose() }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now()
      typed.current = { text: (now - typed.current.at < 600 ? typed.current.text : '') + e.key.toLowerCase(), at: now }
      const hit = actionable.find((i) => {
        const it = items[i]
        return (!it.kind || it.kind === 'item') && it.label.toLowerCase().startsWith(typed.current.text)
      })
      if (hit !== undefined) setActive(hit)
    }
    e.stopPropagation()
  }

  return (
    <motion.div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      className={`${s.menu} glass`}
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: snappy }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.kind === 'sep') return <div key={i} className={s.sep} role="separator" />
        if (it.kind === 'header') return <div key={i} className={s.header}>{it.content}</div>
        if (it.kind === 'note') return <p key={i} className={s.note}>{it.text}</p>
        return (
          <button
            key={i}
            role="menuitem"
            type="button"
            tabIndex={-1}
            disabled={it.disabled}
            className={s.item}
            data-index={i}
            data-active={active === i || undefined}
            data-danger={it.danger || undefined}
            onPointerMove={() => !it.disabled && setActive(i)}
            onPointerLeave={() => { setActive(-1); ref.current?.focus({ preventScroll: true }) }}
            onClick={() => run(i)}
          >
            <span className={s.icon}>{it.icon}</span>
            <span className={s.label}>{it.label}</span>
            {it.hint && <span className={s.hint}>{it.hint}</span>}
          </button>
        )
      })}
    </motion.div>
  )
}
