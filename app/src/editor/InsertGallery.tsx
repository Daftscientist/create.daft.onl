// Insert galleries (spec v3: Insert galleries): shapes as real previews, a hover grid for tables, chart types
// as thumbnails. Arrow keys move between tiles, Enter inserts, Esc (from the popover) returns to the header
// button. Any tile drags onto the slide; the popover steps aside while it does.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/Button'
import { NumberField } from '../ui/Inspector'
import { CHART_TYPES, type ChartType } from './chart'
import { SHAPES, type ShapeGroup, type ShapeKind } from './insert'
import s from './InsertGallery.module.css'

type Drag = { onDrag: (dragging: boolean) => void }

/** Arrow keys over the tiles as laid out (Down goes to the tile visually below, across section breaks),
 *  Home/End, and one tab stop for the whole gallery; the first tile takes focus. */
function useGrid() {
  const ref = useRef<HTMLDivElement>(null)
  const tiles = () => [...(ref.current?.querySelectorAll<HTMLElement>('[data-tile]') ?? [])]
  const stop = (t: HTMLElement) => { for (const x of tiles()) x.tabIndex = x === t ? 0 : -1 }
  useEffect(() => { const t = tiles()[0]; if (t) { stop(t); t.focus({ preventScroll: true }) } }, [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = tiles()
    const cur = document.activeElement as HTMLElement
    const i = list.indexOf(cur)
    if (i < 0) return
    let to: HTMLElement | undefined
    if (e.key === 'ArrowRight') to = list[i + 1]
    else if (e.key === 'ArrowLeft') to = list[i - 1]
    else if (e.key === 'Home') to = list[0]
    else if (e.key === 'End') to = list[list.length - 1]
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const r = cur.getBoundingClientRect(), down = e.key === 'ArrowDown'
      const rows = list.filter((t) => { const q = t.getBoundingClientRect(); return down ? q.top > r.bottom - 2 : q.bottom < r.top + 2 })
      const rowY = rows.length ? (down ? Math.min(...rows.map((t) => t.getBoundingClientRect().top)) : Math.max(...rows.map((t) => t.getBoundingClientRect().top))) : null
      const row = rows.filter((t) => t.getBoundingClientRect().top === rowY)
      to = row.sort((a, b) => Math.abs(a.getBoundingClientRect().left - r.left) - Math.abs(b.getBoundingClientRect().left - r.left))[0]
    } else return
    e.preventDefault()
    if (to) { stop(to); to.focus() }
  }
  return { ref, onKeyDown }
}

const drag = (kind: string, d: Drag) => ({
  draggable: true,
  onDragStart: (e: React.DragEvent) => { e.dataTransfer.setData('application/x-ream-insert', kind); e.dataTransfer.effectAllowed = 'copy'; d.onDrag(true) },
  onDragEnd: () => d.onDrag(false),
})

// ---------- shapes ----------

function ShapeIcon({ kind, poly }: { kind: ShapeKind; poly?: string }) {
  const pts = poly?.split(',').map((p) => p.trim().split(/\s+/).map((v) => 3 + (parseFloat(v) / 100) * 22).join(',')).join(' ')
  return (
    <svg viewBox="0 0 28 28" width="28" height="28" aria-hidden>
      {kind === 'line' && <line x1="4" y1="24" x2="24" y2="4" />}
      {kind === 'arrow' && <><line x1="4" y1="24" x2="22" y2="6" /><path d="M13 5h10v10" fill="none" /></>}
      {kind === 'rect' && <rect x="3" y="7" width="22" height="14" />}
      {kind === 'rounded' && <rect x="3" y="7" width="22" height="14" rx="4" />}
      {kind === 'ellipse' && <ellipse cx="14" cy="14" rx="11" ry="9" />}
      {pts && <polygon points={pts} />}
    </svg>
  )
}

export function ShapesGallery({ onPick, onDrag, lines = true, current }: { onPick: (k: ShapeKind) => void; lines?: boolean; current?: string } & Drag) {
  const grid = useGrid()
  const groups: ShapeGroup[] = lines ? ['Lines', 'Basic shapes', 'Arrows and stars'] : ['Basic shapes', 'Arrows and stars']
  return (
    <div ref={grid.ref} onKeyDown={grid.onKeyDown} className={s.gallery}>
      {groups.map((g) => (
        <section key={g}>
          <h3 className={s.heading}>{g}</h3>
          <div className={s.tiles} role="group" aria-label={g}>
            {SHAPES.filter((x) => x.group === g).map((x) => (
              <button key={x.kind} type="button" data-tile className={s.tile} aria-label={x.label} aria-pressed={current ? current === x.kind : undefined} title={x.label} onClick={() => onPick(x.kind)} {...drag(x.kind, { onDrag })}>
                <ShapeIcon kind={x.kind} poly={x.poly} />
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

// ---------- tables ----------

const COLS = 10, ROWS = 8

export function TableGallery({ onPick, onDrag }: { onPick: (rows: number, cols: number) => void } & Drag) {
  // One size for everything: the highlighted grid, the announcement, the fields, Insert and a drag.
  const [at, setAt] = useState({ c: 3, r: 3 })
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.focus({ preventScroll: true }) }, [])
  const say = (c: number, r: number) => `${c} ${c === 1 ? 'column' : 'columns'}, ${r} ${r === 1 ? 'row' : 'rows'}`
  const onKeyDown = (e: React.KeyboardEvent) => {
    const step = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key]
    if (step) { e.preventDefault(); setAt({ c: Math.max(1, Math.min(COLS, at.c + step[0])), r: Math.max(1, Math.min(ROWS, at.r + step[1])) }) }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(at.r, at.c) }
  }
  const n = (x: string, c: number) => { const v = Math.round(Number(x.replace(/[^\d.-]/g, '')) || NaN); return Number.isFinite(v) ? Math.max(1, Math.min(30, v)) : c }
  return (
    <div className={s.gallery}>
      <div ref={ref} className={s.grid} role="grid" aria-label={`Table size: ${say(at.c, at.r)}. Arrow keys change it, Enter inserts.`} tabIndex={0} onKeyDown={onKeyDown}
        {...drag(`table:${at.c}:${at.r}`, { onDrag })}>
        {Array.from({ length: ROWS }, (_, r) => (
          <div key={r} role="row" className={s.gridRow}>
            {Array.from({ length: COLS }, (_, c) => (
              <span key={c} role="gridcell" aria-selected={c < at.c && r < at.r} className={s.cell} data-on={(c < at.c && r < at.r) || undefined} data-x={c} data-y={r}
                onPointerEnter={() => setAt({ c: c + 1, r: r + 1 })} onClick={() => onPick(r + 1, c + 1)} />
            ))}
          </div>
        ))}
      </div>
      <p className={s.size} aria-live="polite">{say(at.c, at.r)}</p>
      <div className={s.custom}>
        <NumberField label="Columns" name="Columns" width={110} value={at.c} format={String} parse={n} onCommit={(c) => setAt((x) => ({ ...x, c }))} hint="1 to 30" />
        <NumberField label="Rows" name="Rows" width={96} value={at.r} format={String} parse={n} onCommit={(r) => setAt((x) => ({ ...x, r }))} hint="1 to 30" />
        <Button variant="secondary" onClick={() => onPick(at.r, at.c)}>Insert</Button>
      </div>
    </div>
  )
}

// ---------- charts ----------

function ChartIcon({ type }: { type: ChartType }) {
  return (
    <svg viewBox="0 0 64 44" width="64" height="44" aria-hidden className={s.chartIcon}>
      {type === 'column' && [[6, 22], [20, 12], [34, 28], [48, 6]].map(([x, y], i) => <rect key={i} x={x} y={y} width="10" height={40 - y} data-c={i % 2} />)}
      {type === 'bar' && [[6, 40], [16, 26], [26, 50], [36, 18]].map(([y, w], i) => <rect key={i} x="4" y={y - 2} width={w} height="7" data-c={i % 2} />)}
      {type === 'line' && <><polyline points="4,34 18,22 30,28 44,10 60,16" fill="none" data-c="0" /><polyline points="4,38 18,32 30,34 44,26 60,22" fill="none" data-c="1" /></>}
      {type === 'pie' && <><circle cx="32" cy="22" r="18" data-c="1" /><path d="M32 22V4a18 18 0 0 1 15.6 27z" data-c="0" /></>}
    </svg>
  )
}

export function ChartGallery({ onPick, onDrag }: { onPick: (t: ChartType) => void } & Drag) {
  const grid = useGrid()
  return (
    <div ref={grid.ref} onKeyDown={grid.onKeyDown} className={s.charts}>
      {CHART_TYPES.map((t) => (
        <button key={t.type} type="button" data-tile className={s.chartTile} onClick={() => onPick(t.type)} {...drag(`chart:${t.type}`, { onDrag })}>
          <ChartIcon type={t.type} />
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  )
}
