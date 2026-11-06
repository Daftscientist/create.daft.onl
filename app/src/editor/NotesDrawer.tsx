// Speaker notes under the slide (spec v3: Notes drawer), PowerPoint's notes pane. Closed it's a strip with the
// first line; open it's a resizable pane (80px to 40% of the window, remembered). Saves on blur and 600ms idle.
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { SlideDoc } from '../data/types'
import { notesOf, setNotes } from './ops'
import { useEditor } from './session'
import s from './NotesDrawer.module.css'

const OPEN_KEY = 'ream.editor.notes'
const H_KEY = 'ream.editor.notesHeight'
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ok */ } }
const clampH = (h: number) => Math.round(Math.min(innerHeight * 0.4, Math.max(80, h)))

export function NotesDrawer({ slide }: { slide: SlideDoc }) {
  const stored = notesOf(slide)
  const locked = useEditor((e) => e.locked.includes(slide.id))
  const [open, setOpen] = useState(() => read(OPEN_KEY) === '1')
  const [h, setH] = useState(() => clampH(Number(read(H_KEY)) || 160))
  const [text, setText] = useState(stored)
  const area = useRef<HTMLTextAreaElement>(null)
  const timer = useRef(0)
  useEffect(() => setText(stored), [slide.id, stored])
  useEffect(() => { const on = () => setOpen((o) => { write(OPEN_KEY, o ? '0' : '1'); return !o }); addEventListener('ream:notes', on); return () => removeEventListener('ream:notes', on) }, [])
  useEffect(() => { if (open) area.current?.focus({ preventScroll: true }) }, [open])
  // A shorter window keeps the pane within its limit.
  useEffect(() => { const on = () => setH((x) => clampH(x)); addEventListener('resize', on); return () => removeEventListener('resize', on) }, [])
  const save = (v: string) => { clearTimeout(timer.current); if (v !== stored) setNotes(slide.id, v) }
  const toggle = () => setOpen((o) => { write(OPEN_KEY, o ? '0' : '1'); return !o })
  const first = stored.split('\n').find((l) => l.trim()) ?? ''

  return (
    <div className={s.drawer} data-region="notes" data-open={open || undefined} inert={locked || undefined}>
      {open && (
        <div role="separator" aria-orientation="horizontal" aria-label="Resize notes" aria-valuemin={80} aria-valuemax={clampH(99999)} aria-valuenow={h} tabIndex={0} className={s.splitter}
          onKeyDown={(e) => { const d = e.key === 'ArrowUp' ? 16 : e.key === 'ArrowDown' ? -16 : 0; if (d) { e.preventDefault(); const v = clampH(h + d); setH(v); write(H_KEY, String(v)) } }}
          onPointerDown={(e) => {
            const y0 = e.clientY, h0 = h
            let v = h0
            const move = (m: PointerEvent) => { v = clampH(h0 + (y0 - m.clientY)); setH(v) }
            const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); write(H_KEY, String(v)) }
            addEventListener('pointermove', move); addEventListener('pointerup', up)
          }}><span className={s.grip} aria-hidden /></div>
      )}
      <button type="button" className={s.strip} aria-expanded={open} onClick={toggle}>
        {open ? <CaretDown size={12} weight="bold" /> : <CaretUp size={12} weight="bold" />}
        <span className={s.title}>Notes</span>
        {!open && <span className={s.preview}>{first || 'Click to add speaker notes'}</span>}
      </button>
      {open && (
        <textarea ref={area} className={s.area} style={{ height: h }} value={text} placeholder="Click to add speaker notes" aria-label="Speaker notes"
          onChange={(e) => { const v = e.target.value; setText(v); clearTimeout(timer.current); timer.current = window.setTimeout(() => save(v), 600) }}
          onBlur={() => save(text)}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); save(text); document.querySelector<HTMLElement>('[data-region="stage"]')?.focus() } }} />
      )}
    </div>
  )
}
