// Page title row + optional section toolbar. Every desktop view uses this; nothing else renders a title.
import type { ReactNode } from 'react'
import s from './PageHeader.module.css'

export function PageHeader({ title, count, crumbs, actions }: {
  title: ReactNode
  count?: string
  crumbs?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className={s.header}>
      {crumbs && <nav className={s.crumbs} aria-label="Breadcrumb">{crumbs}</nav>}
      <div className={s.row}>
        <h1 className={s.title}>
          {title}
          {count && <span className={s.count}>{count}</span>}
        </h1>
        {actions && <div className={s.actions}>{actions}</div>}
      </div>
    </header>
  )
}

export function SectionHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className={s.section}>
      <h2>{title}</h2>
      {children && <div className={s.sectionTools}>{children}</div>}
    </div>
  )
}

export function EmptyState({ icon, title, body, children }: { icon: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className={s.empty}>
      <div className={s.emptyIcon}>{icon}</div>
      <h2>{title}</h2>
      <p>{body}</p>
      {children && <div className={s.emptyActions}>{children}</div>}
    </div>
  )
}
