// Editor keyboard (spec: Keyboard and focus, v3). Regions: header, bar, stage, notes, rail, column; F6 cycles them.
// Keys inside the text being edited go to the text first. Esc ladder: cancel drag (Canvas) → end text
// editing → exit group → clear selection → nothing. Esc never leaves the deck.
import { useEffect } from 'react'
import { toast } from '../data/toasts'
import { canEditText, clampZoom, liveStage } from './Canvas'
import { copySelection } from './clipboard'
import { redo, undo } from './history'
import { duplicateObjects, find, group, newSlide, nudge, removeObjects, reorder, toggleAttr, ungroup } from './ops'
import { getEditor, select, setEditor } from './session'
import { editingLive, endEdit, formatRuns, textHistory, textState, textUndo } from './textctl'
import { isGroup, members } from './geometry'
import { copyFormat, pasteFormat } from './painter'
import { startComment } from './CommentPins'

const REGIONS = ['header', 'bar', 'stage', 'notes', 'rail', 'column'] as const
export const regionOf = (el: Element | null) => (el?.closest('[data-region]') as HTMLElement | null)?.dataset.region ?? null

export function focusRegion(r: string) {
  const el = document.querySelector<HTMLElement>(`[data-region="${r}"]`)
  if (!el) return false
  if (r === 'bar') { dispatchEvent(new Event('ream:focus-bar')); return true }
  const target = r === 'stage' ? el : el.querySelector<HTMLElement>('[aria-current="true"], button:not([disabled]), input, textarea, [tabindex="0"]') ?? el
  target.focus()
  return true
}

export function applyUndo(deckId: string, which: 'undo' | 'redo') {
  // While text is being edited, the header's Undo is the text's own (as ⌘Z inside it).
  if (textHistory()) { textUndo(which === 'undo' ? -1 : 1); return }
  endEdit()
  const r = which === 'undo' ? undo(deckId) : redo(deckId)
  if (!r.ok) { toast({ message: r.reason }); return }
  const sel = which === 'undo' ? r.tx.selBefore : r.tx.selAfter
  const deck = getEditor()
  if (sel) setEditor({ slideId: sel.slide, sel: sel.ids, railSel: [sel.slide], railAnchor: sel.slide, editing: null, scope: null })
  else setEditor({ sel: [], editing: null })
  void deck
  if (r.skipped) toast({ message: `${r.skipped === 1 ? 'One slide was' : `${r.skipped} slides were`} changed since and kept as they are.` })
}

type Opts = { readOnly?: boolean; deckId: string; slides: string[]; onPresent: (fromStart: boolean, presenter?: boolean) => void; onAsk: () => void; onFormat: () => void; onLeave: () => void; onFind: (replace: boolean) => void; fitZoom: () => number }

export function useEditorKeys(o: Opts) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.documentElement.dataset.overlay || e.defaultPrevented || getEditor().presenting) return
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()
      const path = e.composedPath()
      const inText = !!editingLive() && path.includes(editingLive()!.host)
      const target = path[0] as HTMLElement
      const inField = !inText && target instanceof HTMLElement && target.matches('input, textarea, select, [contenteditable]')
      const st = getEditor()

      // ---- anywhere ----
      if (mod && k === 'j') { e.preventDefault(); o.onAsk(); return }
      if (mod && e.altKey && !e.getModifierState('AltGraph') && (k === 'i' || e.code === 'KeyI')) { e.preventDefault(); o.onFormat(); return }
      if (e.altKey && e.key === 'F10' && !o.readOnly) { e.preventDefault(); dispatchEvent(new Event('ream:objects')); return }
      // PowerPoint's New Comment (Ctrl+Alt+M): on the selection, or click to place one.
      if (mod && e.altKey && !e.getModifierState('AltGraph') && (k === 'm' || e.code === 'KeyM') && !o.readOnly) { e.preventDefault(); endEdit(); startComment(); return }
      if (e.key === 'Escape' && st.commenting) { e.preventDefault(); setEditor({ commenting: false }); return }
      if (e.key === 'F6') {
        e.preventDefault()
        const cur = regionOf(document.activeElement)
        const present = REGIONS.filter((r) => document.querySelector(`[data-region="${r}"]`))
        const i = present.indexOf(cur as (typeof REGIONS)[number])
        focusRegion(present[(i + (e.shiftKey ? -1 : 1) + present.length) % present.length])
        return
      }
      if (e.key === 'F5') { e.preventDefault(); endEdit(); o.onPresent(!e.shiftKey && !e.altKey, e.altKey); return }
      if (mod && k === 'f' && !inField && !o.readOnly) { e.preventDefault(); endEdit(); o.onFind(e.altKey); return }
      if (mod && e.shiftKey && k === 'h' && !inField && !o.readOnly) { e.preventDefault(); endEdit(); o.onFind(true); return }

      // ---- text being edited: the text first ----
      if (inText) {
        if (e.key === 'Escape') { e.preventDefault(); endEdit(); vp()?.focus(); return }
        if (mod && (k === 'b' || k === 'i' || k === 'u')) {
          e.preventDefault()
          const t = textState(liveStage())
          if (!t) return
          if (k === 'b') formatRuns({ 'font-weight': t.bold ? '400' : '700' })
          if (k === 'i') formatRuns({ 'font-style': t.italic ? 'normal' : 'italic' })
          if (k === 'u') formatRuns({ 'text-decoration-line': t.underline ? null : 'underline' })
        }
        return // ⌘Z and the rest: the browser's text editing
      }
      if (inField) return
      // The viewer (tablets): moving through slides and presenting only.
      if (o.readOnly) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); step(o, 1) }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); step(o, -1) }
        return
      }

      if (mod && k === 'z') { e.preventDefault(); applyUndo(o.deckId, e.shiftKey ? 'redo' : 'undo'); return }
      if (mod && k === 'y') { e.preventDefault(); applyUndo(o.deckId, 'redo'); return }
      if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); setEditor({ zoom: clampZoom(cur(o) * 1.25) }); return }
      if (mod && e.key === '-') { e.preventDefault(); setEditor({ zoom: clampZoom(cur(o) / 1.25) }); return }
      if (mod && e.key === '0') { e.preventDefault(); setEditor({ zoom: 'fit' }); return }
      if (mod && e.key === '1') { e.preventDefault(); setEditor({ zoom: 1 }); return }
      if (mod && e.key === 'Enter') { e.preventDefault(); newSlide(); return }
      if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); step(o, e.key === 'PageDown' ? 1 : -1); return }

      // A popover, menu or dialog owns its keys: nothing in it reaches the canvas shortcuts.
      if (target instanceof Element && target.closest('[data-ream-layer]')) return
      const region = regionOf(document.activeElement)
      if (region === 'rail' || region === 'column' || region === 'header' || region === 'bar' || region === 'notes') return
      // ---- the stage (or nothing focused) ----
      const sel = st.sel
      if (e.key === 'Escape') {
        if (st.scope) { e.preventDefault(); setEditor({ sel: [st.scope], scope: null }); return }
        if (sel.length) { e.preventDefault(); select([]); return }
        return
      }
      if (e.key.startsWith('Arrow')) {
        e.preventDefault()
        const d = e.shiftKey ? 10 : 1
        if (sel.length && region === 'stage') nudge(sel, e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0)
        else step(o, e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (mod && k === '[' && !sel.length && !e.altKey) { e.preventDefault(); o.onLeave(); return }
      if (mod && (e.key === ']' || e.key === '[')) { e.preventDefault(); reorder(sel, e.key === ']' ? (e.altKey ? 'front' : 'forward') : (e.altKey ? 'back' : 'backward')); return }
      if (mod && k === 'a') { e.preventDefault(); select(pickable().map(idOf)); return }
      if (!sel.length) return
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeObjects(sel); return }
      if (mod && k === 'd') { e.preventDefault(); duplicateObjects(sel); return }
      if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(sel); else group(sel); return }
      if (mod && e.shiftKey && k === 'l') { e.preventDefault(); toggleAttr(sel, 'data-ream-locked', 'Lock'); return }
      if (mod && k === 'x') return // native cut event (clipboard.ts)
      if (mod && e.shiftKey && k === 'c') { e.preventDefault(); copyFormat(); return }
      if (mod && e.shiftKey && k === 'v') { e.preventDefault(); pasteFormat(); return }
      if (mod && (k === 'b' || k === 'i' || k === 'u')) {
        e.preventDefault()
        const t = textState(liveStage())
        if (!t) return
        if (k === 'b') formatRuns({ 'font-weight': t.bold ? '400' : '700' }, 'Bold')
        if (k === 'i') formatRuns({ 'font-style': t.italic ? 'normal' : 'italic' }, 'Italic')
        if (k === 'u') formatRuns({ 'text-decoration-line': t.underline ? null : 'underline' }, 'Underline')
        return
      }
      if (e.key === 'Enter' && sel.length === 1) {
        const el = liveStage() && find(liveStage()!, sel[0])
        if (!el) return
        e.preventDefault()
        if (isGroup(el)) { const first = members(el)[0]; setEditor({ scope: sel[0], sel: first ? [idOf(first)] : [] }); return }
        if (canEditText(el)) setEditor({ editing: sel[0] })
        return
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        const list = pickable().map(idOf)
        if (!list.length) return
        const i = list.indexOf(sel[0])
        select([list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]])
      }
    }
    // Tab with nothing selected also starts cycling objects (on the stage only).
    const onTabEmpty = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || getEditor().sel.length || regionOf(document.activeElement) !== 'stage' || editingLive()) return
      const list = pickable().map(idOf)
      if (!list.length) return
      e.preventDefault()
      select([list[e.shiftKey ? list.length - 1 : 0]])
    }
    addEventListener('keydown', onTabEmpty)
    addEventListener('keydown', onKey)
    return () => { removeEventListener('keydown', onKey); removeEventListener('keydown', onTabEmpty) }
  }, [o])
}

const vp = () => document.querySelector<HTMLElement>('[data-region="stage"]')
const idOf = (el: Element) => el.getAttribute('data-domoxml-node-id')!
function pickable(): HTMLElement[] {
  const stage = liveStage()
  const st = getEditor()
  const g = st.scope && stage ? find(stage, st.scope) : null
  const list = g ? members(g) : ([...(stage?.querySelector('.domoxml-slide')?.children ?? [])] as HTMLElement[])
  return list.filter((el) => el.hasAttribute('data-domoxml-node-id') && !el.hasAttribute('data-ream-locked'))
}
const cur = (o: Opts) => { const z = getEditor().zoom; return z === 'fit' ? o.fitZoom() : z }
function step(o: Opts, d: number) {
  const i = o.slides.indexOf(getEditor().slideId ?? '')
  const next = o.slides[Math.max(0, Math.min(o.slides.length - 1, i + d))]
  if (next && next !== getEditor().slideId) { endEdit(); setEditor({ slideId: next, railSel: [next], railAnchor: next, sel: [], scope: null }) }
}
export { copySelection }
