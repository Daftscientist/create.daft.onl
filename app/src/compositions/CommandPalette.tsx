// ⌘K (DESIGN.md §6 Command palette): decks, slide-level hits, and actions, in separate sections.
// Solid paper, not glass (glass budget). A slide hit opens the deck at that slide.
import { ArrowRight, MagnifyingGlass } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useRef, useState } from 'react'
import type { Deck } from '../data/types'
import { gentle } from '../lib/motion'
import { pickPptx } from './importPicker'
import { useSearch } from './search'

const pickRoot = () => pickPptx(null)
import { Overlay } from '../ui/Overlay'
import { Kbd } from '../ui/Button'
import { DeckThumb } from './DeckThumb'
import s from './CommandPalette.module.css'

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const items = useSearch(q, onClose, pickRoot)

  const clamp = (i: number) => (items.length ? (i + items.length) % items.length : 0)
  const move = (i: number) => {
    setActive(i)
    list.current?.querySelector(`[data-index="${i}"]`)?.scrollIntoView({ block: 'nearest' })
  }

  let lastSection = ''
  return (
    <Overlay label="Search" onClose={onClose} align="top">
      <motion.div
        className={s.palette}
        initial={{ opacity: 0, scale: 0.97, y: -8 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: gentle }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
      >
        <div className={s.inputRow}>
          <MagnifyingGlass size={20} />
          <input
            autoFocus
            className={s.input}
            placeholder="Search decks, slides and actions"
            value={q}
            aria-label="Search"
            aria-controls="palette-list"
            aria-activedescendant={items[active] ? `pi-${items[active].id}` : undefined}
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); move(clamp(active + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); move(clamp(active - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); items[active]?.run() }
            }}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div className={s.list} id="palette-list" role="listbox" ref={list} aria-label="Results">
          {items.length === 0 && <p className={s.none}>No decks, slides or actions match “{q.trim()}”.</p>}
          {items.map((it, i) => {
            const header = it.section !== lastSection ? (lastSection = it.section) : null
            return (
              <div key={it.id}>
                {header && <div className={s.section}>{header}</div>}
                <div
                  id={`pi-${it.id}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  className={s.item}
                  onPointerMove={() => i !== active && setActive(i)}
                  onClick={it.run}
                >
                  <span className={s.icon}>{it.deck ? <Thumb deck={it.deck} slide={it.slide} /> : it.icon}</span>
                  <span className={s.text}>
                    <span className={s.title}>{it.title}</span>
                    {it.sub && <span className={s.sub}>{it.sub}</span>}
                  </span>
                  {i === active && <ArrowRight size={14} className={s.enter} />}
                </div>
              </div>
            )
          })}
        </div>
      </motion.div>
    </Overlay>
  )
}

function Thumb({ deck, slide = 0 }: { deck: Deck; slide?: number }) {
  return <span className={s.thumb}><DeckThumb deck={deck} slide={slide} /></span>
}
