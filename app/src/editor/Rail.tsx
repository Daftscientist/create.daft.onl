// The slide rail (spec: Slide rail). The displayed slide, the selected set (with its range anchor)
// and keyboard focus are separate. Dragging moves the selected block; New slide copies the current
// slide's layout; Delete removes the selection with Undo.
import { CaretDown, Plus } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import type { Deck } from '../data/types'
import { DeckThumb } from '../compositions/DeckThumb'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { Tooltip } from '../ui/Tooltip'
import { modKey } from '../lib/shell'
import { deleteSlides, duplicateSlides, moveSlides, newSlide, toggleHidden } from './ops'
import { getEditor, setEditor, useEditor } from './session'
import s from './Rail.module.css'

export function Rail({ deck, compact, readOnly = false }: { deck: Deck; compact?: boolean; readOnly?: boolean }) {
  const slideId = useEditor((e) => e.slideId)
  const railSel = useEditor((e) => e.railSel)
  const locked = useEditor((e) => e.locked)
  const ref = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[] } | null>(null)
  const [drop, setDropState] = useState<number | null>(null)
  const dropAt = useRef<number | null>(null)
  const setDrop = (v: number | null) => { dropAt.current = v; setDropState(v) }
  const drag = useRef<{ ids: string[]; startY: number; active: boolean } | null>(null)
  const ids = deck.slides.map((x) => x.id)
  const index = Math.max(0, ids.indexOf(slideId ?? ''))
  const selected = railSel.length ? railSel : slideId ? [slideId] : []

  useEffect(() => {
    const item = ref.current?.querySelector<HTMLElement>(`[data-id="${slideId}"]`)
    item?.scrollIntoView({ block: 'nearest' })
    // Arrow keys move focus with the displayed slide, so the next key acts on the slide shown.
    if (item && ref.current?.contains(document.activeElement)) item.focus({ preventScroll: true })
  }, [slideId])

  const dragged = useRef(false)
  const show = (id: string) => setEditor({ slideId: id, railSel: [id], railAnchor: id, sel: [], scope: null, editing: null })
  const click = (e: React.MouseEvent, id: string) => {
    if (dragged.current) { dragged.current = false; return }
    const { railAnchor } = getEditor()
    if (e.shiftKey && railAnchor) {
      const a = ids.indexOf(railAnchor), b = ids.indexOf(id)
      setEditor({ railSel: ids.slice(Math.min(a, b), Math.max(a, b) + 1) })
    } else if (e.metaKey || e.ctrlKey) {
      setEditor({ railSel: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id], railAnchor: id })
    } else show(id)
  }

  const menuFor = (id: string): MenuItem[] => {
    const these = selected.includes(id) ? selected : [id]
    const i = ids.indexOf(id)
    const hidden = these.every((x) => deck.slides.find((d) => d.id === x)?.hidden)
    return [
      { label: 'New slide', hint: `${modKey}↵`, run: () => newSlide() },
      { label: 'New blank slide', run: () => newSlide('blank') },
      { label: these.length > 1 ? `Duplicate ${these.length} slides` : 'Duplicate slide', hint: `${modKey}D`, run: () => duplicateSlides(these) },
      { label: hidden ? 'Show slide' : 'Hide slide', run: () => toggleHidden(these) },
      { kind: 'sep' },
      { label: 'Move up', disabled: i === 0, run: () => moveSlides(these, Math.max(0, i - 1)) },
      { label: 'Move down', disabled: i >= ids.length - 1, run: () => moveSlides(these, i + 2) },
      { kind: 'sep' },
      { label: these.length > 1 ? `Delete ${these.length} slides` : 'Delete slide', hint: '⌫', danger: true, run: () => deleteSlides(these) },
    ]
  }

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('[role="menu"]')) return
    const step = (d: number) => { e.preventDefault(); const next = ids[Math.max(0, Math.min(ids.length - 1, index + d))]; if (e.shiftKey) { const { railAnchor } = getEditor(); const a = ids.indexOf(railAnchor ?? next), b = ids.indexOf(next); setEditor({ slideId: next, railSel: ids.slice(Math.min(a, b), Math.max(a, b) + 1) }) } else show(next) }
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') step(1)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'Home') { e.preventDefault(); show(ids[0]) }
    else if (e.key === 'End') { e.preventDefault(); show(ids[ids.length - 1]) }
    else if (readOnly) return
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSlides(selected) }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSlides(selected) }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setEditor({ railSel: ids }) }
  }

  // Pointer reorder: the selected block moves together, with an insertion line and edge auto-scroll.
  const onPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0 || readOnly) return
    drag.current = { ids: selected.includes(id) ? ids.filter((x) => selected.includes(x)) : [id], startY: e.clientY, active: false }
  }
  useEffect(() => {
    let raf = 0
    const move = (e: PointerEvent) => {
      const d = drag.current
      if (!d) return
      if (!d.active && Math.abs(e.clientY - d.startY) < 6) return
      d.active = true
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('[data-id]') ?? [])]
      let at = items.length
      for (const [i, el] of items.entries()) { const r = el.getBoundingClientRect(); if (e.clientY < r.top + r.height / 2) { at = i; break } }
      setDrop(at)
      const box = ref.current!.getBoundingClientRect()
      cancelAnimationFrame(raf)
      const edge = e.clientY < box.top + 40 ? -8 : e.clientY > box.bottom - 40 ? 8 : 0
      if (edge) { const tick = () => { ref.current!.scrollTop += edge; raf = requestAnimationFrame(tick) }; raf = requestAnimationFrame(tick) }
    }
    const up = () => {
      cancelAnimationFrame(raf)
      const d = drag.current
      drag.current = null
      if (d?.active) dragged.current = true
      const at = dropAt.current
      setDrop(null)
      if (d?.active && at !== null) moveSlides(d.ids, at)
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current?.active) { e.preventDefault(); drag.current = null; setDrop(null); cancelAnimationFrame(raf) } }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('keydown', key, true)
    return () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', key, true) }
  }, [])

  return (
    <nav className={s.rail} ref={ref} aria-label="Slides" data-region="rail" data-compact={compact || undefined} onKeyDown={onKey}>
      <div role="listbox" aria-multiselectable aria-label="Slides" className={s.list}>
        {deck.slides.map((sl, i) => (
          <div key={sl.id} className={s.slot}>
            {drop === i && <span className={s.dropLine} aria-hidden />}
            <button
              type="button"
              role="option"
              data-id={sl.id}
              aria-selected={selected.includes(sl.id)}
              aria-current={sl.id === slideId ? 'true' : undefined}
              aria-label={`Slide ${i + 1}${sl.hidden ? ', hidden' : ''}`}
              tabIndex={sl.id === slideId ? 0 : -1}
              className={s.item}
              data-hidden={sl.hidden || undefined}
              data-busy={locked.includes(sl.id) || undefined}
              onClick={(e) => click(e, sl.id)}
              onPointerDown={(e) => onPointerDown(e, sl.id)}
              onContextMenu={(e) => { e.preventDefault(); if (readOnly) return; if (!selected.includes(sl.id)) show(sl.id); setMenu({ anchor: { x: e.clientX, y: e.clientY }, items: menuFor(sl.id) }) }}
            >
              <span className={s.num}>{i + 1}</span>
              <DeckThumb deck={deck} slide={i} className={s.thumb} />
            </button>
          </div>
        ))}
        {drop === deck.slides.length && <span className={s.dropLine} aria-hidden />}
      </div>
      {!readOnly && <div className={s.new}>
        <Tooltip label="New slide" hint={`${modKey}↵`}><button type="button" className={s.newBtn} onClick={() => newSlide()}><Plus size={14} weight="bold" /><span>New slide</span></button></Tooltip>
        <Tooltip label="More slide layouts"><button type="button" className={s.newMore} aria-label="More slide layouts" aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ anchor: { x: r.left, y: r.bottom + 4 }, items: [{ label: 'From this slide’s layout', run: () => newSlide() }, { label: 'Blank', run: () => newSlide('blank') }] }) }}><CaretDown size={12} weight="bold" /></button></Tooltip>
      </div>}
      <Menu open={!!menu} anchor={menu?.anchor ?? null} items={menu?.items ?? []} label="Slide" onClose={() => setMenu(null)} />
    </nav>
  )
}
