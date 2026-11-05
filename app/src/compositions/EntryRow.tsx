// Desktop list-view row (DESIGN.md §6 List row). Same state and handlers as EntryTile.
import { Check, DotsThree, FolderSimple, Star } from '@phosphor-icons/react'
import { deckCount, download, getLibrary } from '../data/library'
import type { Entry } from '../data/types'
import { bytes, count, relTime } from '../lib/format'
import { HtmlMark, PptxMark } from '../ui/FileMarks'
import { DeckThumb } from './DeckThumb'
import type { TileHandlers, TileState } from './EntryTile'
import s from './EntryRow.module.css'

export function EntryRow({ entry, state, handlers }: { entry: Entry; state: TileState; handlers: TileHandlers }) {
  const isDeck = entry.type === 'deck'
  return (
    <div
      role="option"
      aria-selected={state.selected}
      aria-label={entry.name}
      tabIndex={state.focused ? 0 : -1}
      data-id={entry.id}
      data-drop-folder={entry.type === 'folder' ? entry.id : undefined}
      draggable={!state.renaming}
      className={s.row}
      data-selected={state.selected || undefined}
      data-drop={state.dropTarget || undefined}
    >
      <span className={s.check} data-select-toggle data-on={state.selected || undefined} role="checkbox" aria-checked={state.selected} aria-label={`Select ${entry.name}`}>
        {state.selected && <Check size={11} weight="bold" />}
      </span>
      <span className={s.thumb}>
        {isDeck ? <DeckThumb deck={entry} /> : <span className={s.folder}><FolderSimple size={18} weight="fill" /></span>}
      </span>
      <span className={s.name}>
        {state.renaming ? (
          <input
            className={s.rename}
            defaultValue={entry.name}
            autoFocus
            aria-label="Name"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') handlers.onRename(entry.id, e.currentTarget.value)
              if (e.key === 'Escape') handlers.onRename(entry.id, null)
            }}
            onBlur={(e) => handlers.onRename(entry.id, e.currentTarget.value)}
          />
        ) : <span className={s.text}>{entry.name}</span>}
        {entry.starred && <Star size={12} weight="fill" className={s.star} aria-label="Starred" />}
      </span>
      <span className={s.col}>{relTime(entry.modifiedAt)}</span>
      <span className={s.col}>{isDeck ? count(entry.slides.length, 'slide') : count(deckCount(getLibrary(), entry.id), 'deck')}</span>
      <span className={s.col}>{isDeck ? bytes(entry.sizeBytes) : '—'}</span>
      <span className={s.marks}>
        {isDeck && entry.status === 'ready' && (
          <>
            <button type="button" tabIndex={-1} aria-label={`Download ${entry.name} as PowerPoint`} title="Download PowerPoint (.pptx)" onClick={(e) => { e.stopPropagation(); download([entry.id], 'pptx') }}><PptxMark /></button>
            <button type="button" tabIndex={-1} aria-label={`Download ${entry.name} as HTML`} title="Download HTML" onClick={(e) => { e.stopPropagation(); download([entry.id], 'html') }}><HtmlMark /></button>
          </>
        )}
      </span>
      <button
        type="button"
        tabIndex={-1}
        className={s.more}
        aria-label={`Actions for ${entry.name}`}
        onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); handlers.onMenu(entry.id, { x: r.right, y: r.bottom + 4, align: 'end' }) }}
      >
        <DotsThree size={18} weight="bold" />
      </button>
    </div>
  )
}

EntryRow.Header = function Header() {
  return (
    <div className={s.header} aria-hidden>
      <span />
      <span />
      <span>Name</span>
      <span>Modified</span>
      <span>Contents</span>
      <span>Size</span>
      <span />
      <span />
    </div>
  )
}
