// Floating glass tab bar (DESIGN.md §6 Mobile: tab bar): two destinations + a detached search circle.
// In Select mode the same slot shows the batch bar instead.
import { ClockCounterClockwise, FolderSimple, MagnifyingGlass } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import type { ReactNode } from 'react'
import { gentle, snappy } from '../lib/motion'
import s from './TabBar.module.css'

export function TabBar({ tab, onTab, onSearch, batch }: {
  tab: 'recents' | 'files' | null
  onTab: (t: 'recents' | 'files') => void
  onSearch: () => void
  batch?: ReactNode
}) {
  const tabs = [
    { id: 'recents' as const, label: 'Recents', icon: <ClockCounterClockwise size={22} weight={tab === 'recents' ? 'bold' : 'regular'} /> },
    { id: 'files' as const, label: 'Files', icon: <FolderSimple size={22} weight={tab === 'files' ? 'fill' : 'regular'} /> },
  ]
  return (
    <div className={s.dock}>
      <AnimatePresence mode="popLayout" initial={false}>
        {batch ? (
          <motion.div key="batch" className={`${s.batch} glass`} initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: gentle }} exit={{ y: 80, opacity: 0 }}>
            {batch}
          </motion.div>
        ) : (
          <motion.div key="tabs" className={s.row} initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1, transition: gentle }} exit={{ y: 80, opacity: 0 }}>
            <nav className={`${s.bar} glass`} aria-label="Sections">
              {tabs.map((t) => (
                <button key={t.id} type="button" className={s.tab} aria-current={tab === t.id ? 'page' : undefined} onClick={() => onTab(t.id)}>
                  {tab === t.id && <motion.span layoutId="tab-pill" className={s.pill} transition={snappy} />}
                  <span className={s.tabInner}>{t.icon}<span>{t.label}</span></span>
                </button>
              ))}
            </nav>
            <button type="button" className={`${s.search} glass`} aria-label="Search" onClick={onSearch}>
              <MagnifyingGlass size={22} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
