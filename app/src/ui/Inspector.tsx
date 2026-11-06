// Inspector controls (the editor's Format column, and any later properties panel): collapsible
// labelled sections, compact rows, number fields with label scrubbing and arithmetic, and a colour well
// with a solid paper popover (deck colours, recent colours, a picker and hex input).
import { CaretDown } from '@phosphor-icons/react'
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import s from './Inspector.module.css'

export function Section({ title, open, onToggle, children, aside }: { title: string; open: boolean; onToggle: () => void; children: ReactNode; aside?: ReactNode }) {
  const id = useId()
  return (
    <section className={s.section}>
      <div className={s.sectionHead}>
        <button type="button" className={s.sectionToggle} aria-expanded={open} aria-controls={id} onClick={onToggle}>
          <CaretDown size={12} weight="bold" className={s.caret} />
          {title}
        </button>
        {aside}
      </div>
      {open && <div id={id} className={s.sectionBody}>{children}</div>}
    </section>
  )
}

export function Row({ label, children }: { label?: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <div className={s.row}>
      {label !== undefined && <span className={s.rowLabel} id={id}>{label}</span>}
      <div className={s.rowControls} role="group" aria-labelledby={label !== undefined ? id : undefined}>{children}</div>
    </div>
  )
}

/** A number field. `format` shows the value; `parse` reads typed text (units, arithmetic) or returns null.
 *  Enter or blur commits, Esc reverts, arrows step (⇧ ×10), dragging the label scrubs with a live preview
 *  (`onPreview`), committed once on release. */
export function NumberField({ label, name, value, format, parse, onCommit, onPreview, step = 1, scrub = 1, mixed, width, hint = 'Use a number like 2.5cm', disabled }: {
  label: string
  /** The full name screen readers hear ("Font size, points"); `label` is the short visible one. */
  name?: string
  value: number
  format: (v: number) => string
  parse: (text: string, current: number) => number | null
  onCommit: (v: number) => void
  onPreview?: (v: number) => void
  step?: number
  scrub?: number
  mixed?: boolean
  width?: number
  hint?: string
  disabled?: boolean
}) {
  const [text, setText] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const id = useId()
  const shown = text ?? (mixed ? '' : format(value))
  const commit = () => {
    if (text === null) return
    const v = parse(text, value)
    if (v === null) { setBad(true); return }
    setBad(false); setText(null)
    if (v !== value) onCommit(v)
  }
  // Dragging the label scrubs with a live preview, through the same parsing and limits as typing;
  // Esc puts the value back. Only fields that can preview offer it.
  const scrubStart = (e: React.PointerEvent) => {
    if (disabled || e.button !== 0 || !onPreview) return
    e.preventDefault()
    const x0 = e.clientX
    let last = value
    const move = (m: PointerEvent) => {
      const v = parse(String(value + Math.round((m.clientX - x0) / 2) * scrub), value)
      if (v !== null) { last = v; onPreview(v) }
    }
    const stop = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('keydown', key, true); removeEventListener('pointercancel', cancel) }
    const up = () => { stop(); if (last !== value) onCommit(last) }
    const cancel = () => { stop(); onPreview(value) }
    const key = (k: KeyboardEvent) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); cancel() } }
    addEventListener('pointermove', move)
    addEventListener('pointerup', up)
    addEventListener('pointercancel', cancel)
    addEventListener('keydown', key, true)
  }
  return (
    <label className={s.num} htmlFor={id} style={width ? { width } : undefined} data-bad={bad || undefined} data-disabled={disabled || undefined}>
      <span className={s.numLabel} data-scrub={onPreview ? '' : undefined} onPointerDown={scrubStart} title={onPreview ? `Drag to change ${name ?? label}` : undefined}>{label}</span>
      <input
        id={id}
        className={s.numInput}
        value={shown}
        placeholder={mixed ? 'Mixed' : undefined}
        disabled={disabled}
        aria-invalid={bad || undefined}
        aria-label={name ?? label}
        onChange={(e) => { setText(e.target.value); setBad(false) }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); (e.target as HTMLInputElement).select() }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setText(null); setBad(false) }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Steps in the unit shown (0.1 in, 1 pt…) and through the same parsing and limits as typing.
            e.preventDefault()
            const cur = text !== null ? parse(text, value) ?? value : value
            const m = /^(-?[\d.,]+)\s*(.*)$/.exec(format(cur))
            const by = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)
            const v = m ? parse(`${Math.round((parseFloat(m[1].replace(',', '.')) + by) * 1000) / 1000}${m[2] ? ` ${m[2]}` : ''}`, cur) : null
            setText(null)
            if (v !== null && v !== value) onCommit(v)
          }
        }}
      />
      {bad && <span className={s.numHint} role="alert">{hint}</span>}
    </label>
  )
}

const recent: string[] = []

/** A colour well. `colors`: the deck's own colours, shown first. `none` adds a "No fill" choice. */
export function ColorWell({ label, value, onChange, colors = [], none, mixed, onClosed }: { label: string; value: string | null; onChange: (c: string | null) => void; colors?: string[]; none?: string; mixed?: boolean; /** Where focus goes when the popover closes (default: the swatch). */ onClosed?: () => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={btn} type="button" className={s.well} aria-label={`${label}: ${mixed ? 'mixed' : value ?? 'none'}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={s.swatch} data-none={!value || undefined} style={{ background: mixed ? 'conic-gradient(#e8603c 0 25%, #1d56e0 0 50%, #1e9e62 0 75%, #e3b341 0)' : value ?? undefined }} />
      </button>
      {open && <ColorPopover anchor={btn.current!} value={value} colors={colors} none={none} onClose={() => { setOpen(false); if (onClosed) onClosed(); else btn.current?.focus() }} onChange={(c) => { if (c && !recent.includes(c)) { recent.unshift(c); recent.length = Math.min(recent.length, 8) } onChange(c) }} />}
    </>
  )
}

export function toHex(c: string | null): string {
  if (!c) return '#000000'
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c)
  if (m) return `#${[m[1], m[2], m[3]].map((n) => (+n).toString(16).padStart(2, '0')).join('')}`
  return /^#[0-9a-f]{6}$/i.test(c) ? c : '#000000'
}

function ColorPopover({ anchor, value, colors, none, onChange, onClose }: { anchor: HTMLElement; value: string | null; colors: string[]; none?: string; onChange: (c: string | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: 0, top: 0 })
  const [hex, setHex] = useState(toHex(value))
  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect()
    const w = 232, h = ref.current?.offsetHeight ?? 220
    setPos({ left: Math.max(8, Math.min(innerWidth - w - 8, r.right - w)), top: r.bottom + 6 + h > innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 })
    ref.current?.querySelector<HTMLElement>('button')?.focus()
  }, [anchor])
  useEffect(() => {
    const down = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node) && e.target !== anchor && !anchor.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }
    addEventListener('pointerdown', down, true)
    addEventListener('keydown', key, true)
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true) }
  }, [anchor, onClose])
  const chips = (list: string[]) => list.map((c) => (
    <button key={c} type="button" className={s.chip} style={{ background: c }} aria-label={c} aria-pressed={toHex(c) === toHex(value)} onClick={() => { onChange(c); setHex(toHex(c)) }} />
  ))
  const BASIC = ['#ffffff', '#000000', '#5c5c66', '#e8603c', '#e3b341', '#1e9e62', '#1d56e0', '#8b5cf6']
  return createPortal(
    <div ref={ref} className={s.popover} style={pos} role="dialog" aria-label="Colour">
      {colors.length > 0 && <><div className={s.popTitle}>This deck</div><div className={s.chips}>{chips(colors.slice(0, 16))}</div></>}
      {recent.length > 0 && <><div className={s.popTitle}>Recent</div><div className={s.chips}>{chips(recent)}</div></>}
      <div className={s.popTitle}>Colours</div>
      <div className={s.chips}>{chips(BASIC)}</div>
      <div className={s.popRow}>
        <input type="color" className={s.picker} value={hex} aria-label="Pick a colour" onChange={(e) => { setHex(e.target.value); onChange(e.target.value) }} />
        <input className={s.hex} value={hex} aria-label="Hex" spellCheck={false} onChange={(e) => setHex(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && /^#?[0-9a-f]{6}$/i.test(hex)) onChange(hex.startsWith('#') ? hex : `#${hex}`) }} onBlur={() => { if (/^#?[0-9a-f]{6}$/i.test(hex) && toHex(value) !== hex) onChange(hex.startsWith('#') ? hex : `#${hex}`) }} />
        {none && <button type="button" className={s.noneBtn} onClick={() => { onChange(null); onClose() }}>{none}</button>}
      </div>
    </div>,
    document.body,
  )
}

/** A read-only chip for values the controls can't show (an imported gradient, a custom shadow). */
export function KeptChip({ label, onReplace }: { label: string; onReplace: () => void }) {
  return <span className={s.kept}>{label}<button type="button" onClick={onReplace}>Replace</button></span>
}
