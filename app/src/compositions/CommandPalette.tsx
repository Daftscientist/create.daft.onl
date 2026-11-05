// ⌘K (DESIGN.md §6 Command palette): decks, slide-level hits, and actions, in separate sections.
// Solid paper, not glass (glass budget). A slide hit opens the deck at that slide.
import { ArrowRight, ClockCounterClockwise, FolderSimple, MagnifyingGlass, Plus, Star, Trash, UploadSimple } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { decks, folders, getLibrary, isLive, newDeck, openDeck, pathTo, recents, slideText } from '../data/library'
import type { Deck } from '../data/types'
import { count, relTimeInline } from '../lib/format'
import { gentle } from '../lib/motion'
import { navigate } from '../lib/router'
import { Overlay } from '../ui/Overlay'
import { Kbd } from '../ui/Button'
import { DeckThumb } from './DeckThumb'
import s from './CommandPalette.module.css'

type Item = { id: string; section: 'Decks' | 'Slides' | 'Folders' | 'Go to' | 'Actions'; icon: ReactNode; title: ReactNode; sub?: ReactNode; run: () => void }

function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  const start = Math.max(0, i - 28)
  return <>{start > 0 ? '…' : ''}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 60)}</>
}

export function CommandPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  const items = useMemo<Item[]>(() => {
    const lib = getLibrary()
    const go = (fn: () => void) => () => { onClose(); fn() }
    const openAt = (d: Deck, slide?: number) => go(() => { openDeck(d.id); navigate({ name: 'deck', deckId: d.id, slide }) })
    const where = (d: Deck) => (d.parentId ? pathTo(lib, d.parentId).map((f) => f.name).join(' / ') : 'Files')
    const query = q.trim().toLowerCase()
    const actions: Item[] = [
      { id: 'a-new', section: 'Actions', icon: <Plus size={16} />, title: 'New deck', run: go(() => { const id = newDeck(null); openDeck(id); navigate({ name: 'deck', deckId: id }) }) },
      { id: 'a-import', section: 'Actions', icon: <UploadSimple size={16} />, title: 'Import .pptx…', run: go(() => document.querySelector<HTMLInputElement>('input[type=file][accept*=pptx]')?.click()) },
      { id: 'g-recents', section: 'Go to', icon: <ClockCounterClockwise size={16} />, title: 'Recents', run: go(() => navigate({ name: 'home' })) },
      { id: 'g-files', section: 'Go to', icon: <FolderSimple size={16} />, title: 'Files', run: go(() => navigate({ name: 'files', folderId: null })) },
      { id: 'g-starred', section: 'Go to', icon: <Star size={16} />, title: 'Starred', run: go(() => navigate({ name: 'starred' })) },
      { id: 'g-trash', section: 'Go to', icon: <Trash size={16} />, title: 'Trash', run: go(() => navigate({ name: 'trash' })) },
    ]
    if (!query) {
      return [
        ...recents(lib, 5).map<Item>((d) => ({ id: d.id, section: 'Decks', icon: <Thumb deck={d} />, title: d.name, sub: `${where(d)} · opened ${relTimeInline(d.openedAt ?? d.modifiedAt)}`, run: openAt(d) })),
        ...actions,
      ]
    }
    const live = decks(lib).filter((d) => isLive(d) && d.status === 'ready')
    const deckHits = live.filter((d) => d.name.toLowerCase().includes(query)).slice(0, 6)
      .map<Item>((d) => ({ id: d.id, section: 'Decks', icon: <Thumb deck={d} />, title: highlight(d.name, q.trim()), sub: `${where(d)} · ${count(d.slides.length, 'slide')}`, run: openAt(d) }))
    const slideHits: Item[] = []
    for (const d of live) {
      slideText(d).forEach((text, i) => {
        if (slideHits.length < 8 && text.toLowerCase().includes(query)) {
          slideHits.push({ id: `${d.id}:${i}`, section: 'Slides', icon: <Thumb deck={d} slide={i} />, title: highlight(text, q.trim()), sub: `${d.name} · Slide ${i + 1}`, run: openAt(d, i) })
        }
      })
    }
    const folderHits = folders(lib).filter((f) => isLive(f) && f.name.toLowerCase().includes(query)).slice(0, 4)
      .map<Item>((f) => ({ id: f.id, section: 'Folders', icon: <FolderSimple size={16} />, title: highlight(f.name, q.trim()), run: go(() => navigate({ name: 'files', folderId: f.id })) }))
    const actionHits = actions.filter((a) => String(a.title).toLowerCase().includes(query))
    return [...deckHits, ...slideHits, ...folderHits, ...actionHits]
  }, [q, onClose])

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
                  <span className={s.icon}>{it.icon}</span>
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
