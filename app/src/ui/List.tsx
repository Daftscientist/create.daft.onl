// Grouped navigation list (iOS Settings / Files convention): mobile settings, Starred/Trash places.
import { CaretRight } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import s from './List.module.css'

export function ListGroup({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className={s.group}>
      {title && <h2 className={s.title}>{title}</h2>}
      <div className={s.rows}>{children}</div>
    </section>
  )
}

export function ListRow({ icon, label, value, onClick }: { icon?: ReactNode; label: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={s.row} onClick={onClick}>
      {icon && <span className={s.icon}>{icon}</span>}
      <span className={s.label}>{label}</span>
      {value !== undefined && <span className={s.value}>{value}</span>}
      <CaretRight size={14} className={s.chev} />
    </button>
  )
}
