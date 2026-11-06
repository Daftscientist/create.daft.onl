// The floating text bar (spec): the editor's only glass surface, shown while text is being edited.
// 10px above the text frame (below when there's no room). Clicks never take focus from the text; the size
// field and colour popover keep a selection bookmark and return to it.
import { ListBullets, ListNumbers, TextAlignCenter, TextAlignLeft, TextAlignRight, TextB, TextItalic, TextUnderline } from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ColorWell, NumberField } from '../ui/Inspector'
import { liveStage } from './Canvas'
import { Toggle } from './FormatPanel'
import { find } from './ops'
import { useEditor } from './session'
import { editingLive, formatParas, formatRuns, list, onTextChange, textState } from './textctl'
import { parseNumber } from './units'
import s from './TextBar.module.css'

export function TextBar() {
  const editing = useEditor((e) => e.editing)
  const [, setT] = useState(0)
  useEffect(() => onTextChange(() => setT((t) => t + 1)), [])
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const stage = liveStage()
  const el = editing && stage ? find(stage, editing) : null

  useLayoutEffect(() => {
    if (!el || !ref.current) { if (pos) setPos(null); return }
    const r = el.getBoundingClientRect()
    const bar = ref.current.getBoundingClientRect()
    const above = r.top - bar.height - 10
    const top = Math.round(Math.min(above > 70 ? above : r.bottom + 10, innerHeight - bar.height - 8))
    const left = Math.round(Math.max(8, Math.min(innerWidth - bar.width - 8, r.left + r.width / 2 - bar.width / 2)))
    if (pos?.left !== left || pos?.top !== top) setPos({ left, top })
  })

  // ⌥F10 moves focus into the bar (Office's "go to toolbar"); Esc returns to the text.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'F10' && editingLive()) { e.preventDefault(); ref.current?.querySelector<HTMLElement>('button, input')?.focus() }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  if (!el) return null
  const t = textState(stage)
  if (!t) return null
  const back = (e: React.KeyboardEvent) => { if (e.key === 'Escape' && ref.current?.contains(document.activeElement)) { e.preventDefault(); e.stopPropagation(); editingLive()?.host.focus() } }
  return (
    <div ref={ref} className={`${s.bar} glass`} role="toolbar" aria-label="Text formatting" style={pos ?? { visibility: 'hidden' }} onKeyDown={back}>
      <NumberField label="pt" width={70} value={t.sizePt} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(1, Math.min(400, v)) }} onCommit={(v) => { formatRuns({ 'font-size': `${v}pt` }); editingLive()?.host.focus() }} hint="Use a size like 24" />
      <span className={s.sep} />
      <Toggle label="Bold" hint="⌘B" on={t.bold} onClick={() => formatRuns({ 'font-weight': t.bold ? '400' : '700' })}><TextB size={15} weight="bold" /></Toggle>
      <Toggle label="Italic" hint="⌘I" on={t.italic} onClick={() => formatRuns({ 'font-style': t.italic ? 'normal' : 'italic' })}><TextItalic size={15} /></Toggle>
      <Toggle label="Underline" hint="⌘U" on={t.underline} onClick={() => formatRuns({ 'text-decoration-line': t.underline ? null : 'underline' })}><TextUnderline size={15} /></Toggle>
      <span onMouseDown={(e) => e.preventDefault()}><ColorWell label="Text colour" value={t.color} onChange={(c) => { if (c) formatRuns({ color: c }) }} /></span>
      <span className={s.sep} />
      <Toggle label="Align left" on={t.align === 'left'} onClick={() => formatParas({ 'text-align': 'left' })}><TextAlignLeft size={15} /></Toggle>
      <Toggle label="Align centre" on={t.align === 'center'} onClick={() => formatParas({ 'text-align': 'center' })}><TextAlignCenter size={15} /></Toggle>
      <Toggle label="Align right" on={t.align === 'right'} onClick={() => formatParas({ 'text-align': 'right' })}><TextAlignRight size={15} /></Toggle>
      <span className={s.sep} />
      <Toggle label="Bullets" on={t.list === 'ul'} onClick={() => list('ul')}><ListBullets size={15} /></Toggle>
      <Toggle label="Numbering" on={t.list === 'ol'} onClick={() => list('ol')}><ListNumbers size={15} /></Toggle>
    </div>
  )
}
