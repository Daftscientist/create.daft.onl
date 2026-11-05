// Per-view display preferences (sort, grid/list), remembered across visits (DESIGN.md "Lists at scale").
import { useState } from 'react'
import type { Entry } from '../data/types'

export type SortKey = 'opened' | 'modified' | 'name'
export type ViewMode = 'grid' | 'list'
export type Prefs = { sort: SortKey; view: ViewMode }

export function usePrefs(key: string, initial: Prefs): [Prefs, (p: Partial<Prefs>) => void] {
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...initial, ...JSON.parse(localStorage.getItem(`office.prefs.${key}`) ?? '{}') } } catch { return initial }
  })
  const update = (p: Partial<Prefs>) => setPrefs((prev) => {
    const next = { ...prev, ...p }
    try { localStorage.setItem(`office.prefs.${key}`, JSON.stringify(next)) } catch { /* in-memory only */ }
    return next
  })
  return [prefs, update]
}

export const SORT_LABEL: Record<SortKey, string> = { opened: 'Last opened', modified: 'Last modified', name: 'Name' }

/** Folders first, then the chosen key, with a stable tie-break on name. */
export function sortEntries(entries: Entry[], sort: SortKey): Entry[] {
  const key = (e: Entry) => sort === 'opened' ? (e.type === 'deck' ? e.openedAt ?? e.modifiedAt : e.modifiedAt) : e.modifiedAt
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    if (sort === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true })
    return key(b) - key(a) || a.name.localeCompare(b.name)
  })
}
