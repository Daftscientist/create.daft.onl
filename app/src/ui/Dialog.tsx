// Desktop dialog: a paper card over Smoke (mobile uses Sheet). Confirm is the one way to ask before
// an irreversible action: it names exactly what will happen.
import { motion } from 'motion/react'
import { useSyncExternalStore, type ReactNode } from 'react'
import { gentle } from '../lib/motion'
import { useShell } from '../lib/shell'
import { Sheet, SheetTitle } from './Sheet'
import { Button } from './Button'
import { Overlay } from './Overlay'
import s from './Dialog.module.css'

export function Dialog({ title, children, actions, onClose, width = 440 }: {
  title: string
  children?: ReactNode
  actions: ReactNode
  onClose: () => void
  width?: number
}) {
  return (
    <Overlay label={title} onClose={onClose}>
      <motion.div
        className={s.dialog}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: gentle }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      >
        <h2 className={s.title}>{title}</h2>
        {children && <div className={s.body}>{children}</div>}
        <div className={s.actions}>{actions}</div>
      </motion.div>
    </Overlay>
  )
}

export function Confirm({ title, body, confirmLabel, danger, onConfirm, onClose }: {
  title: string
  body: ReactNode
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" data-autofocus onClick={onClose}>Cancel</Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => { onClose(); onConfirm() }}>{confirmLabel}</Button>
        </>
      }
    >
      {body}
    </Modal>
  )
}

// ---------- confirm(): ask from anywhere, rendered by one ConfirmHost per shell ----------
type Ask = { title: string; body: ReactNode; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
let asking: Ask | null = null
const askListeners = new Set<() => void>()
export function confirm(o: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => { asking = { ...o, resolve }; askListeners.forEach((l) => l()) })
}
export function ConfirmHost() {
  const a = useSyncExternalStore((l) => (askListeners.add(l), () => askListeners.delete(l)), () => asking)
  if (!a) return null
  const done = (ok: boolean) => { asking = null; askListeners.forEach((l) => l()); a.resolve(ok) }
  return <Confirm title={a.title} body={a.body} confirmLabel={a.confirmLabel} danger={a.danger} onConfirm={() => done(true)} onClose={() => { if (asking === a) done(false) }} />
}

/** The one modal: a Dialog on desktop, a bottom Sheet on mobile. */
export function Modal({ title, children, actions, onClose, width }: { title: string; children?: ReactNode; actions: ReactNode; onClose: () => void; width?: number }) {
  const shell = useShell()
  if (shell === 'desktop') return <Dialog title={title} actions={actions} onClose={onClose} width={width}>{children}</Dialog>
  return (
    <Sheet label={title} onClose={onClose} header={<SheetTitle>{title}</SheetTitle>}>
      <div className={s.sheetBody}>
        {children}
        <div className={s.sheetActions}>{actions}</div>
      </div>
    </Sheet>
  )
}
