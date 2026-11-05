// Mobile search: the shared search model (compositions/search) in a full-height sheet.
import { MagnifyingGlass, X } from '@phosphor-icons/react'
import { useState } from 'react'
import { DeckThumb } from '../compositions/DeckThumb'
import { pickPptx } from '../compositions/importPicker'
import { useSearch } from '../compositions/search'
import { Sheet } from '../ui/Sheet'
import s from './SearchSheet.module.css'

const pickRoot = () => pickPptx(null)

export function SearchSheet({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const items = useSearch(q, onClose, pickRoot)
  let last = ''
  return (
    <Sheet
      label="Search"
      onClose={onClose}
      full
      header={
        <div className={s.field}>
          <MagnifyingGlass size={18} />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Decks, slides and actions" aria-label="Search" enterKeyHint="search" />
          {q && <button type="button" aria-label="Clear" className={s.clear} onClick={() => setQ('')}><X size={14} weight="bold" /></button>}
        </div>
      }
    >
      <div className={s.results}>
        {!items.length && <p className={s.none}>No decks, slides or actions match “{q.trim()}”.</p>}
        {items.map((it) => {
          const head = it.section !== last ? (last = it.section) : null
          return (
            <div key={it.id}>
              {head && <h3 className={s.section}>{head}</h3>}
              <button type="button" className={s.item} onClick={it.run}>
                <span className={s.icon}>{it.deck ? <DeckThumb deck={it.deck} slide={it.slide} /> : it.icon}</span>
                <span className={s.text}>
                  <span className={s.title}>{it.title}</span>
                  {it.sub && <span className={s.sub}>{it.sub}</span>}
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </Sheet>
  )
}
