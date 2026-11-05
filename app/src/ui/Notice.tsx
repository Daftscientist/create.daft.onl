// In-flow notice (reconnect, storage permission, storage full). Paper, scrolls with content, never modal.
import { X } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import { IconButton } from './Button'
import s from './Notice.module.css'

export function Notice({ icon, tone = 'warn', title, children, actions, onDismiss, dismissLabel = 'Not now' }: {
  icon: ReactNode
  tone?: 'warn' | 'danger' | 'info'
  title: string
  children?: ReactNode
  actions?: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
}) {
  return (
    <div className={s.notice} data-tone={tone} role="status">
      <span className={s.icon}>{icon}</span>
      <div className={s.body}>
        <p className={s.title}>{title}</p>
        {children && <p className={s.text}>{children}</p>}
      </div>
      {actions && <div className={s.actions}>{actions}</div>}
      {onDismiss && <IconButton label={dismissLabel} size="sm" tone="plain" onClick={onDismiss}><X size={14} /></IconButton>}
    </div>
  )
}
