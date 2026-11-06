// Context menu / ⋯ menu (DESIGN.md §6 Menu). Glass, keyboard-driven, returns focus to its trigger.
import { Check } from '@phosphor-icons/react'
import { AnimatePresence, motion, useIsPresent } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { snappy } from '../lib/motion'
import s from './Menu.module.css'

export type MenuItem =
  | { kind?: 'item'; label: string; icon?: ReactNode; hint?: string; danger?: boolean; disabled?: boolean; selected?: boolean; keywords?: string; run: () => void }
  | { kind: 'sep' }
  | { kind: 'header'; content: ReactNode }
  | { kind: 'note'; text: string }

export type MenuAnchor = { x: number; y: number; align?: 'start' | 'end' }

/** `search`: a filter field on top for long lists (it keeps focus; arrows still move through items).
 *  An item's `selected` shows a check; `keywords` are extra text the filter matches. */
export function Menu({ open, anchor, items, onClose, label, search }: {
  open: boolean
  anchor: MenuAnchor | null
  items: MenuItem[]
  onClose: () => void
  label: string
  search?: string
}) {
  return createPortal(
    <AnimatePresence>
      {open && anchor && <MenuPanel key="m" anchor={anchor} items={items} onClose={onClose} label={label} search={search} />}
    </AnimatePresence>,
    document.body,
  )
}

/** Keeps items matching the query, plus the headers and separators that still have items under them. */
function filterItems(items: MenuItem[], q: string): MenuItem[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return items
  const out: MenuItem[] = []
  let pending: MenuItem[] = []
  for (const it of items) {
    if (it.kind === 'header' || it.kind === 'sep') { pending = it.kind === 'header' ? [...pending.filter((p) => p.kind === 'sep'), it] : [it]; continue }
    if (it.kind === 'note') continue
    if (`${it.label} ${it.keywords ?? ''}`.toLowerCase().includes(needle)) {
      out.push(...pending.filter((p) => p.kind !== 'sep' || out.length > 0), it)
      pending = []
    }
  }
  return out
}

function MenuPanel({ anchor, items: all, onClose, label, search }: { anchor: MenuAnchor; items: MenuItem[]; onClose: () => void; label: string; search?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const items = search ? filterItems(all, query) : all
  const [pos, setPos] = useState<{ left: number; top: number; origin: string }>({ left: anchor.x, top: anchor.y, origin: 'top left' })
  const [active, setActive] = useState(-1)
  // While the menu fades out after a choice, it takes no focus: the action may have put focus somewhere
  // (a rename field) and the fading menu mustn't take it back.
  const present = useIsPresent()
  useEffect(() => {
    if (!present) return
    const el = active >= 0 ? ref.current?.querySelector<HTMLElement>(`[data-index="${active}"]`) : null
    if (search) el?.scrollIntoView({ block: 'nearest' })
    else el?.focus({ preventScroll: true })
  }, [active, search, present])
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
    if (search) field.current?.focus()
    else el.focus()
  }, [anchor, search])

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
    const panel = ref.current
    return () => {
      removeEventListener('pointerdown', close, true)
      removeEventListener('wheel', close, true)
      removeEventListener('resize', onBlur)
      removeEventListener('blur', onBlur)
      // Focus goes back to the trigger only if the chosen action didn't put it somewhere (a rename field,
      // a dialog): the menu unmounts after its exit animation, after the action has run.
      const a = document.activeElement
      const stray = !a || a === document.body || (panel?.contains(a) ?? false)
      if (stray && el instanceof HTMLElement && document.contains(el)) el.focus({ preventScroll: true })
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
    else if (e.key === 'Enter' || (e.key === ' ' && !search)) { e.preventDefault(); const target = active >= 0 ? active : search ? actionable[0] : -1; if (target !== undefined && target >= 0) run(target) }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose() }
    else if (!search && e.key.length === 1 && /\S/.test(e.key)) {
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
      data-ream-layer=""
      tabIndex={-1}
      className={`${s.menu} glass`}
      style={{ left: pos.left, top: pos.top, transformOrigin: pos.origin, pointerEvents: present ? undefined : 'none' }}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1, transition: snappy }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      onKeyDown={onKey}
      onContextMenu={(e) => e.preventDefault()}
    >
      {search && (
        <input
          ref={field}
          className={s.search}
          type="search"
          placeholder={search}
          aria-label={search}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActive(-1) }}
          onKeyDown={(e) => { if (e.key === 'Home' || e.key === 'End') e.stopPropagation() }}
        />
      )}
      <div className={s.items}>
      {!items.some((it) => !it.kind || it.kind === 'item') && <p className={s.note}>Nothing matches “{query}”.</p>}
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
            onPointerLeave={() => { setActive(-1); if (!search && present) ref.current?.focus({ preventScroll: true }) }}
            onClick={() => run(i)}
          >
            <span className={s.icon}>{it.icon}</span>
            <span className={s.label}>{it.label}</span>
            {it.hint && <span className={s.hint}>{it.hint}</span>}
            {it.selected && <Check size={14} weight="bold" className={s.check} aria-label="Selected" />}
          </button>
        )
      })}
      </div>
    </motion.div>
  )
}
