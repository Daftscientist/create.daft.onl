// Bottom sheet (DESIGN.md §6 Mobile: action sheet). Drag down from the grabber or header to dismiss;
// a fast flick dismisses even if short. Focus is trapped by Overlay and returns to the opener.
import { motion, useDragControls, useMotionValue, useTransform } from 'motion/react'
import type { ReactNode } from 'react'
import { gentle } from '../lib/motion'
import { Overlay } from './Overlay'
import s from './Sheet.module.css'

export function Sheet({ onClose, label, header, children, full }: {
  onClose: () => void
  label: string
  header?: ReactNode
  children: ReactNode
  full?: boolean
}) {
  const controls = useDragControls()
  const y = useMotionValue(0)
  const shade = useTransform(y, [0, 300], [1, 0.4])
  return (
    <Overlay label={label} onClose={onClose} align="bottom">
      <motion.div
        className={s.sheet}
        data-full={full || undefined}
        style={{ y, opacity: shade }}
        initial={{ y: '100%' }}
        animate={{ y: 0, transition: gentle }}
        exit={{ y: '100%', transition: { type: 'spring', stiffness: 400, damping: 40 } }}
        drag="y"
        dragListener={false}
        dragControls={controls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.05, bottom: 0.9 }}
        onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose() }}
      >
        <div className={s.handleZone} onPointerDown={(e) => controls.start(e)}>
          <span className={s.grabber} aria-hidden />
          {header}
        </div>
        <div className={s.body}>{children}</div>
      </motion.div>
    </Overlay>
  )
}

export type SheetAction = { label: string; icon?: ReactNode; danger?: boolean; disabled?: boolean; run: () => void }

/** A list of 52px actions, grouped by separators. Mobile's rendering of the shared command inventory. */
export function SheetActions({ groups, onDone }: { groups: SheetAction[][]; onDone: () => void }) {
  return (
    <div className={s.groups}>
      {groups.filter((g) => g.length).map((g, i) => (
        <div key={i} className={s.group}>
          {g.map((a) => (
            <button key={a.label} type="button" className={s.action} data-danger={a.danger || undefined} disabled={a.disabled} onClick={() => { onDone(); a.run() }}>
              <span className={s.actionIcon}>{a.icon}</span>
              {a.label}
            </button>
          ))}
        </div>
      ))}
      <button type="button" className={s.cancel} onClick={onDone}>Cancel</button>
    </div>
  )
}

export function SheetTitle({ children }: { children: ReactNode }) {
  return <h2 className={s.title}>{children}</h2>
}
