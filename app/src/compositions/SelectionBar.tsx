// Floating glass selection bar (DESIGN.md §6 Selection bar). Lifts the toast stack while visible.
import { X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'
import { gentle } from '../lib/motion'
import { IconButton } from '../ui/Button'
import s from './SelectionBar.module.css'

export type BarAction = { label: string; icon: ReactNode; run: () => void; danger?: boolean }

export function SelectionBar({ count, actions, onClear }: { count: number; actions: BarAction[]; onClear: () => void }) {
  const open = count > 0
  useEffect(() => {
    document.documentElement.style.setProperty('--toast-base', open ? '84px' : '24px')
    return () => document.documentElement.style.setProperty('--toast-base', '24px')
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className={`${s.bar} glass`}
          role="toolbar"
          aria-label="Selection"
          initial={{ opacity: 0, y: 24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1, transition: gentle }}
          exit={{ opacity: 0, y: 16, scale: 0.98, transition: { duration: 0.16 } }}
        >
          <span className={s.count} aria-live="polite">{count} selected</span>
          <span className={s.div} />
          {actions.map((a) => (
            <button key={a.label} type="button" className={s.action} data-danger={a.danger || undefined} onClick={a.run}>
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
          <span className={s.div} />
          <IconButton label="Clear selection" hint="Esc" size="sm" tone="plain" side="top" onClick={onClear}>
            <X size={14} />
          </IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
