// Mobile list row (DESIGN.md §6 Mobile: list row). Tap opens, long-press opens the action sheet,
// swipe left reveals Download and Delete (never deletes on a full swipe), Select mode shows a checkbox.
import { Check, DotsThree, DownloadSimple, FolderSimple, Star, Trash } from '@phosphor-icons/react'
import { animate, motion, useMotionValue } from 'motion/react'
import { useRef } from 'react'
import { deckCount, download, getLibrary, trash } from '../data/library'
import type { Entry } from '../data/types'
import { count, relTime } from '../lib/format'
import { DeckThumb } from './DeckThumb'
import s from './MobileRow.module.css'

const REVEAL = 148

export function MobileRow({ entry, meta, selecting, selected, onOpen, onActions, onToggle, swipe = true }: {
  entry: Entry
  meta?: string
  selecting: boolean
  selected: boolean
  onOpen: () => void
  onActions: () => void
  onToggle: () => void
  swipe?: boolean
}) {
  const x = useMotionValue(0)
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const isDeck = entry.type === 'deck'
  const ready = !isDeck || entry.status === 'ready'
  const close = () => animate(x, 0, { type: 'spring', stiffness: 500, damping: 40 })

  const metaText = meta ?? (isDeck
    ? entry.status === 'importing' ? 'Importing…' : entry.status === 'failed' ? 'Couldn’t import' : `${relTime(entry.modifiedAt)} · ${count(entry.slides.length, 'slide')}`
    : count(deckCount(getLibrary(), entry.id), 'deck'))

  return (
    <div className={s.wrap} data-selected={selected || undefined}>
      {swipe && !selecting && (
        <div className={s.reveal} aria-hidden>
          {isDeck && ready && <button type="button" tabIndex={-1} className={s.revealBtn} onClick={() => { close(); download([entry.id], 'pptx') }}><DownloadSimple size={20} />Download</button>}
          <button type="button" tabIndex={-1} className={`${s.revealBtn} ${s.danger}`} onClick={() => { close(); trash([entry.id]) }}><Trash size={20} />Delete</button>
        </div>
      )}
      <motion.div
        className={s.row}
        style={{ x }}
        drag={swipe && !selecting ? 'x' : false}
        dragDirectionLock
        dragConstraints={{ left: -REVEAL, right: 0 }}
        dragElastic={{ left: 0.08, right: 0 }}
        onDragStart={() => { if (press.current) { clearTimeout(press.current.timer); press.current = null } }}
        onDragEnd={(_, info) => animate(x, info.offset.x < -60 || info.velocity.x < -400 ? -REVEAL : 0, { type: 'spring', stiffness: 500, damping: 40 })}
        onPointerDown={(e) => {
          if (selecting) return
          press.current = {
            x: e.clientX, y: e.clientY, fired: false,
            timer: window.setTimeout(() => { if (press.current) { press.current.fired = true; navigator.vibrate?.(8); onActions() } }, 480),
          }
        }}
        onPointerMove={(e) => {
          const p = press.current
          if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8) { clearTimeout(p.timer); press.current = null }
        }}
        onPointerUp={() => { if (press.current && !press.current.fired) clearTimeout(press.current.timer) }}
        onClick={() => {
          if (press.current?.fired) { press.current = null; return }
          press.current = null
          if (x.get() < -4) return void close()
          if (selecting) onToggle()
          else if (ready) onOpen()
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {selecting && (
          <span className={s.check} data-on={selected || undefined} aria-hidden>{selected && <Check size={13} weight="bold" />}</span>
        )}
        <span className={s.thumb}>
          {isDeck ? <DeckThumb deck={entry} /> : <span className={s.folder}><FolderSimple size={22} weight="fill" /></span>}
        </span>
        <span className={s.text}>
          <span className={s.name}>{entry.name}{entry.starred && <Star size={12} weight="fill" className={s.star} aria-label="Starred" />}</span>
          <span className={s.meta}>{metaText}</span>
        </span>
        {!selecting && (
          <button
            type="button"
            className={s.more}
            aria-label={`Actions for ${entry.name}`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onActions() }}
          >
            <DotsThree size={22} weight="bold" />
          </button>
        )}
      </motion.div>
    </div>
  )
}
