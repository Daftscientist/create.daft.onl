// Grid tiles for decks and folders (DESIGN.md §6 Deck tile, Folder tile). Presentational: the owning
// Collection handles selection, keyboard and drag; tiles only render state and their own buttons.
import { Check, DotsThree, Star } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import { coverFor, deckCount, download, getLibrary } from '../data/library'
import type { Deck, Entry, Folder } from '../data/types'
import { bytes, count, relTime } from '../lib/format'
import { HtmlMark, PptxMark } from '../ui/FileMarks'
import { Tooltip } from '../ui/Tooltip'
import { DeckThumb } from './DeckThumb'
import s from './EntryTile.module.css'

export type TileState = {
  selected: boolean
  focused: boolean
  renaming: boolean
  dropTarget: boolean
}

export type TileHandlers = {
  onMenu: (id: string, anchor: { x: number; y: number; align?: 'start' | 'end' }) => void
  onRename: (id: string, name: string | null) => void
  onRetry?: (id: string) => void
  onRemove?: (id: string) => void
}

export function EntryTile({ entry, state, handlers, meta, layoutId }: {
  entry: Entry
  state: TileState
  handlers: TileHandlers
  meta?: string
  layoutId?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (state.focused && ref.current && document.activeElement !== ref.current && ref.current.closest('[data-collection]')?.contains(document.activeElement))
      ref.current.focus({ preventScroll: false })
  }, [state.focused])

  return (
    <div
      ref={ref}
      role="option"
      aria-selected={state.selected}
      aria-label={entry.name}
      tabIndex={state.focused ? 0 : -1}
      data-id={entry.id}
      data-type={entry.type}
      data-drop-folder={entry.type === 'folder' ? entry.id : undefined}
      draggable={!state.renaming}
      className={s.tile}
      data-selected={state.selected || undefined}
      data-drop={state.dropTarget || undefined}
      data-status={entry.type === 'deck' ? entry.status : undefined}
    >
      <div className={s.media}>
        {entry.type === 'deck' ? <DeckThumb deck={entry} layoutId={layoutId} /> : <FolderArt folder={entry} />}
        <span
          className={s.check}
          data-select-toggle
          data-on={state.selected || undefined}
          role="checkbox"
          aria-checked={state.selected}
          aria-label={`Select ${entry.name}`}
        >
          {state.selected && <Check size={12} weight="bold" />}
        </span>
        {entry.starred && <span className={s.star} aria-label="Starred"><Star size={12} weight="fill" /></span>}
        {state.dropTarget && entry.type === 'folder' && <span className={s.dropLabel}>Move to {entry.name}</span>}
      </div>
      <div className={s.strip}>
        <div className={s.nameRow}>
          {state.renaming ? <RenameField name={entry.name} onDone={(v) => handlers.onRename(entry.id, v)} /> : <span className={s.name} title={entry.name}>{entry.name}</span>}
          <button
            type="button"
            className={s.more}
            aria-label={`Actions for ${entry.name}`}
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              const r = e.currentTarget.getBoundingClientRect()
              handlers.onMenu(entry.id, { x: r.right, y: r.bottom + 6, align: 'end' })
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <DotsThree size={18} weight="bold" />
          </button>
        </div>
        <div className={s.metaRow}>
          {entry.type === 'deck' ? <DeckMeta deck={entry} meta={meta} handlers={handlers} /> : <span className={s.meta}>{count(deckCount(getLibrary(), entry.id), 'deck')}</span>}
        </div>
      </div>
    </div>
  )
}

function DeckMeta({ deck, meta, handlers }: { deck: Deck; meta?: string; handlers: TileHandlers }) {
  if (deck.status === 'failed') {
    return (
      <span className={s.failedRow}>
        <span className={s.meta}>{deck.error ?? 'Import failed'}</span>
        <span className={s.inlineActions}>
          {handlers.onRetry && <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); handlers.onRetry!(deck.id) }}>Try again</button>}
          {handlers.onRemove && <button type="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); handlers.onRemove!(deck.id) }}>Remove</button>}
        </span>
      </span>
    )
  }
  if (deck.status === 'importing') return <span className={s.meta}>{bytes(deck.sizeBytes)} · Importing</span>
  return (
    <>
      <span className={s.meta}>{meta ?? `${relTime(deck.modifiedAt)} · ${count(deck.slides.length, 'slide')}`}{deck.simplified ? <span className={s.badge} title={`${deck.simplified} slides use simplified effects`}>{deck.simplified} simplified</span> : null}</span>
      <span className={s.marks}>
        <Tooltip label="Download PowerPoint (.pptx)">
          <button type="button" tabIndex={-1} aria-label={`Download ${deck.name} as PowerPoint`} onClick={(e) => { e.stopPropagation(); download([deck.id], 'pptx') }} onDoubleClick={(e) => e.stopPropagation()}>
            <PptxMark />
          </button>
        </Tooltip>
        <Tooltip label="Download HTML">
          <button type="button" tabIndex={-1} aria-label={`Download ${deck.name} as HTML`} onClick={(e) => { e.stopPropagation(); download([deck.id], 'html') }} onDoubleClick={(e) => e.stopPropagation()}>
            <HtmlMark />
          </button>
        </Tooltip>
      </span>
    </>
  )
}

function FolderArt({ folder }: { folder: Folder }) {
  const cover = coverFor(getLibrary(), folder.id)
  return (
    <div className={s.folder}>
      <svg className={s.folderShape} viewBox="0 0 160 90" preserveAspectRatio="none" aria-hidden>
        <path d="M0 10a8 8 0 0 1 8-8h40a8 8 0 0 1 6 2.7l5 5.3h93a8 8 0 0 1 8 8v64a8 8 0 0 1-8 8H8a8 8 0 0 1-8-8z" />
      </svg>
      {cover && <div className={s.peek}><DeckThumb deck={cover} /></div>}
    </div>
  )
}

function RenameField({ name, onDone }: { name: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(0, el.value.length)
  }, [])
  const finish = (v: string | null) => {
    if (done.current) return
    done.current = true
    onDone(v)
  }
  return (
    <input
      ref={ref}
      className={s.rename}
      defaultValue={name}
      aria-label="Name"
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  )
}
