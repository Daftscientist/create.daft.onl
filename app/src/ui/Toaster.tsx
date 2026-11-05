// Toasts (DESIGN.md §6 Toast): solid cards, bottom centre, newest in front, older ones tucked behind
// and fanned out on hover. Timers pause while hovered or focused.
import { CheckCircle, CircleNotch, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { dismissToast, useToasts, type Toast } from '../data/toasts'
import { gentle } from '../lib/motion'
import s from './Toaster.module.css'

export function Toaster() {
  const toasts = useToasts()
  const [expanded, setExpanded] = useState(false)
  const ordered = [...toasts].reverse()
  return (
    <section
      className={s.region}
      aria-live="polite"
      aria-label="Notifications"
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={() => setExpanded(false)}
      onFocusCapture={() => setExpanded(true)}
      onBlurCapture={() => setExpanded(false)}
    >
      <AnimatePresence initial={false}>
        {ordered.map((t, i) => (
          <motion.div
            key={t.id}
            layout
            className={s.slot}
            style={{ zIndex: 10 - i }}
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{
              opacity: i > 2 ? 0 : 1,
              y: expanded ? -i * 58 : -i * 10,
              scale: expanded ? 1 : 1 - i * 0.05,
              transition: gentle,
            }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.14 } }}
          >
            <ToastCard toast={t} paused={expanded} front={i === 0} />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  )
}

function ToastCard({ toast, paused, front }: { toast: Toast; paused: boolean; front: boolean }) {
  const left = useRef(toast.duration)
  useEffect(() => {
    if (paused || !Number.isFinite(left.current)) return
    const start = Date.now()
    const t = setTimeout(() => dismissToast(toast.id), left.current)
    return () => { clearTimeout(t); left.current -= Date.now() - start }
  }, [paused, toast.id])

  return (
    <div className={s.toast} data-front={front || undefined}>
      {toast.busy ? <CircleNotch size={16} className={s.spin} /> : toast.tone === 'ok' ? <CheckCircle size={16} weight="fill" className={s.ok} /> : null}
      <span className={s.msg}>{toast.message}</span>
      {toast.action && (
        <button type="button" className={s.action} onClick={() => { toast.action!.run(); dismissToast(toast.id) }}>
          {toast.action.label}
        </button>
      )}
      {!toast.busy && (
        <button type="button" className={s.close} aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
          <X size={14} />
        </button>
      )}
    </div>
  )
}
