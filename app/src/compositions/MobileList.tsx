// A mobile list of entries. Every mobile screen's list is this component.
import type { Entry } from '../data/types'
import { MobileRow } from './MobileRow'
import s from './MobileList.module.css'

export type MobileSelect = { active: boolean; ids: Set<string>; toggle: (id: string) => void }

export function MobileList({ entries, select, onOpen, onActions, meta, swipe }: {
  entries: Entry[]
  select: MobileSelect
  onOpen: (e: Entry) => void
  onActions: (id: string) => void
  meta?: (e: Entry) => string | undefined
  swipe?: boolean
}) {
  return (
    <div className={s.list} role="list">
      {entries.map((e) => (
        <div role="listitem" key={e.id}>
          <MobileRow
            entry={e}
            meta={meta?.(e)}
            swipe={swipe}
            selecting={select.active}
            selected={select.ids.has(e.id)}
            onOpen={() => onOpen(e)}
            onActions={() => onActions(e.id)}
            onToggle={() => select.toggle(e.id)}
          />
        </div>
      ))}
    </div>
  )
}

export function MobileSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={s.section}>
      <h2 className={s.sectionTitle}>{title}</h2>
      {children}
    </section>
  )
}
