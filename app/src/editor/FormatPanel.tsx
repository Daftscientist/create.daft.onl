// The Format column (spec: Format column). Contextual to the selection; section order follows what's
// selected. Nothing selected → the slide: background, fonts, the object list (PowerPoint's Selection Pane).
import {
  AlignBottom, AlignCenterHorizontal, AlignCenterVertical, AlignLeft, AlignRight, AlignTop, ArrowLineDown, ArrowLineUp,
  ArrowDown, ArrowUp, DotsSixVertical, Eye, EyeSlash, ListBullets, ListNumbers, Lock, LockOpen, TextAlignCenter,
  TextAlignJustify, TextAlignLeft, TextAlignRight, TextB, TextItalic, TextOutdent, TextIndent, TextUnderline, X,
  ArrowsInLineHorizontal, ArrowsInLineVertical, Selection as SelectionIcon, SelectionSlash, Image as ImageIcon,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import { useLibrary } from '../data/library'
import type { Deck, SlideDoc } from '../data/types'
import { IconButton, Button } from '../ui/Button'
import { ColorWell, KeptChip, NumberField, Row, Section, toHex } from '../ui/Inspector'
import { Menu, type MenuAnchor } from '../ui/Menu'
import { Tooltip } from '../ui/Tooltip'
import { liveStage } from './Canvas'
import { boxOf, isGroup, members, unionBox, type Box } from './geometry'
import { readPicture, pickPicture } from './insert'
import { align, animOf, distribute, editSlide, find, group, hasText, moveToIndex, notesOf, reorder, setAnchor, setAnimation, setBackground, setBoxes, setNotes, setObjectStyle, setSlideAttrs, textHost, toggleAttr, ungroup, type Align } from './ops'
import { select, setEditor, useEditor } from './session'
import { editingLive, endEdit, formatParas, formatRuns, list, onTextChange, shiftIndent, textState } from './textctl'
import { CHART_TYPES, readSpec, setChart } from './chart'
import { ChartData } from './ChartData'
import { activeCell, borderCells, fillCells, tableOp } from './table'
import { formatLength, localUnit, parseLength, parseNumber } from './units'
import s from './FormatPanel.module.css'

export type Kind = 'text' | 'shape' | 'picture' | 'preserved' | 'group' | 'table' | 'svg' | 'chart'
export function kindOf(el: HTMLElement): Kind {
  if (isGroup(el)) return 'group'
  if (el.hasAttribute('data-chart')) return 'chart'
  if (el.classList.contains('domoxml-preserved')) return 'preserved'
  if (el.tagName === 'IMG') return 'picture'
  if (el.tagName === 'TABLE') return 'table'
  if (el.tagName.toLowerCase() === 'svg') return 'svg'
  const st = getComputedStyle(el)
  const filled = (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent') || st.backgroundImage !== 'none' || parseFloat(st.borderTopWidth) > 0 || el.hasAttribute('data-ream-shape')
  if (el.querySelector(':scope > img, :scope img:only-child') && !hasText(el)) return 'picture'
  return filled ? 'shape' : 'text'
}
const KIND_NAME: Record<Kind, string> = { text: 'Text box', shape: 'Shape', picture: 'Picture', preserved: 'Chart', group: 'Group', table: 'Table', svg: 'Shape', chart: 'Chart' }
export function objectName(el: HTMLElement): string {
  const k = kindOf(el)
  const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (k === 'preserved') return el.getAttribute('alt') || 'Kept object'
  if (k === 'group') return `Group (${members(el).length})`
  return t ? `${KIND_NAME[k]}: ${t.length > 28 ? `${t.slice(0, 28)}…` : t}` : KIND_NAME[k]
}

const FONTS = ['Instrument Sans', 'Instrument Serif', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Calibri', 'Cambria', 'Aptos', 'Segoe UI', 'Verdana', 'Trebuchet MS', 'Garamond', 'Courier New']
const SHADOWS = { none: '', soft: '0px 8px 24px rgba(0,0,0,0.22)', hard: '6px 6px 0px rgba(0,0,0,0.85)' }

type Open = Record<string, boolean>
const OPEN_KEY = 'ream.format.sections'
const loadOpen = (): Open => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') } catch { return {} } }

export function FormatPanel({ deck, slide, index, onClose }: { deck: Deck; slide: SlideDoc; index: number; onClose: () => void }) {
  useLibrary() // re-read the live stage whenever the deck changes
  const sel = useEditor((e) => e.sel)
  const editing = useEditor((e) => e.editing)
  const [, setT] = useState(0)
  useEffect(() => onTextChange(() => setT((t) => t + 1)), [])
  // The live stage renders in the same commit; read it after layout.
  useEffect(() => { const r = requestAnimationFrame(() => setT((t) => t + 1)); return () => cancelAnimationFrame(r) }, [slide.html, sel])
  const [open, setOpen] = useState<Open>(loadOpen)
  const stage = liveStage()
  const els = sel.map((id) => (stage ? find(stage, id) : null)).filter((e): e is HTMLElement => !!e)
  const kinds = els.map(kindOf)
  const kindKey = els.length > 1 ? 'multi' : kinds[0] ?? 'slide'
  const sec = (name: string, def = true) => ({
    open: open[`${kindKey}.${name}`] ?? def,
    onToggle: () => setOpen((o) => { const n = { ...o, [`${kindKey}.${name}`]: !(o[`${kindKey}.${name}`] ?? def) }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)) } catch { /* ok */ } return n }),
  })
  const deckColors = useMemo(() => colorsOf(deck), [deck])

  const title = els.length > 1 ? `${els.length} objects` : els[0] ? objectName(els[0]).split(':')[0] : `Slide ${index + 1}`
  const textEls = els.filter((e) => !!e.querySelector('.domoxml-text, li') || (editing && e.getAttribute('data-domoxml-node-id') === editing))
  const showText = textEls.length > 0 && kinds.every((k) => k === 'text' || k === 'shape' || k === 'table')
  const styleable = els.length > 0 && kinds.every((k) => k === 'text' || k === 'shape' || k === 'svg' || k === 'picture' || k === 'group')

  return (
    <aside className={s.panel} aria-label="Format" data-region="column">
      <header className={s.head}>
        <h2>{title}</h2>
        <IconButton label="Close Format" hint="⌥⌘I" size="sm" tone="plain" onClick={onClose}><X size={14} /></IconButton>
      </header>
      <div className={s.body}>
        {!els.length && <SlidePanel deck={deck} slide={slide} sec={sec} colors={deckColors} />}
        {kinds[0] === 'preserved' && els.length === 1 && <p className={s.note}>Kept exactly as in PowerPoint. You can move, resize and reorder it.</p>}
        {showText && kinds[0] === 'text' && <TextSection sec={sec('text')} colors={deckColors} ids={sel} />}
        {styleable && <FillSection sec={sec('fill', kinds[0] !== 'text')} els={els} ids={sel} colors={deckColors} />}
        {styleable && kinds.some((k) => k !== 'text') && <EffectsSection sec={sec('effects', false)} els={els} ids={sel} />}
        {showText && kinds[0] !== 'text' && <TextSection sec={sec('text')} colors={deckColors} ids={sel} />}
        {els.length === 1 && kinds[0] === 'picture' && <PictureSection sec={sec('picture')} el={els[0]} id={sel[0]} />}
        {els.length === 1 && kinds[0] === 'chart' && <ChartSection sec={sec('chart')} el={els[0]} id={sel[0]} />}
        {els.length === 1 && kinds[0] === 'table' && <TableSection sec={sec('table')} el={els[0]} id={sel[0]} colors={deckColors} />}
        {els.length === 1 && (kinds[0] === 'picture' || kinds[0] === 'chart' || kinds[0] === 'preserved' || kinds[0] === 'shape' || kinds[0] === 'svg') && <AltTextSection sec={sec('alt', false)} el={els[0]} id={sel[0]} />}
        {els.length > 0 && <AnimateSection sec={sec('animate', false)} els={els} ids={sel} />}
        {els.length > 0 && <ArrangeSection sec={sec('arrange', els.length > 1 || kinds[0] === 'preserved')} els={els} ids={sel} size={deck.size ?? { w: 1280, h: 720 }} />}
      </div>
    </aside>
  )
}

type Sec = { open: boolean; onToggle: () => void }

function TextSection({ sec, colors, ids }: { sec: Sec; colors: string[]; ids: string[] }) {
  const t = textState(liveStage())
  const [fontMenu, setFontMenu] = useState<MenuAnchor | null>(null)
  if (!t) return null
  const fonts = [...new Set([t.family, ...FONTS])]
  return (
    <Section title="Text" {...sec}>
      <Row label="Font">
        <button type="button" className={s.select} aria-haspopup="menu" aria-expanded={!!fontMenu} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setFontMenu({ x: r.left, y: r.bottom + 4 }) }} style={{ fontFamily: t.family }}>
          {t.family}
        </button>
        <Menu open={!!fontMenu} anchor={fontMenu} label="Font" search="Find a font" onClose={() => setFontMenu(null)}
          items={fonts.map((f) => ({ label: f, selected: f === t.family, run: () => formatRuns({ 'font-family': `${f},sans-serif` }, 'Font') }))} />
      </Row>
      <Row label="Size">
        <NumberField label="pt" value={t.sizePt} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(1, Math.min(400, v)) }} onCommit={(v) => formatRuns({ 'font-size': `${v}pt` }, 'Font size')} hint="Use a size like 24" />
        <ColorWell label="Text colour" value={t.color} colors={colors} onChange={(c) => c && formatRuns({ color: c }, 'Text colour')} />
      </Row>
      <Row label="Style">
        <Toggle label="Bold" hint="⌘B" on={t.bold} onClick={() => formatRuns({ 'font-weight': t.bold ? '400' : '700' }, 'Bold')}><TextB size={15} weight="bold" /></Toggle>
        <Toggle label="Italic" hint="⌘I" on={t.italic} onClick={() => formatRuns({ 'font-style': t.italic ? 'normal' : 'italic' }, 'Italic')}><TextItalic size={15} /></Toggle>
        <Toggle label="Underline" hint="⌘U" on={t.underline} onClick={() => formatRuns({ 'text-decoration-line': t.underline ? null : 'underline' }, 'Underline')}><TextUnderline size={15} /></Toggle>
      </Row>
      <Row label="Align">
        {(['left', 'center', 'right', 'justify'] as const).map((a) => {
          const Icon = { left: TextAlignLeft, center: TextAlignCenter, right: TextAlignRight, justify: TextAlignJustify }[a]
          return <Toggle key={a} label={`Align ${a === 'center' ? 'centre' : a}`} on={t.align === a} onClick={() => formatParas({ 'text-align': a })}><Icon size={15} /></Toggle>
        })}
      </Row>
      <Row label="Vertical">
        <Toggle label="Top" on={false} onClick={() => setAnchor(ids, 'top')}><AlignTop size={15} /></Toggle>
        <Toggle label="Middle" on={false} onClick={() => setAnchor(ids, 'middle')}><AlignCenterVertical size={15} /></Toggle>
        <Toggle label="Bottom" on={false} onClick={() => setAnchor(ids, 'bottom')}><AlignBottom size={15} /></Toggle>
      </Row>
      <Row label="Spacing">
        <NumberField label="line" value={t.lineHeight} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0.5, Math.min(5, v)) }} onCommit={(v) => formatParas({ 'line-height': `${Math.round(v * 1.2 * 1000) / 1000}` })} step={0.1} hint="A multiple, like 1.15" />
        <NumberField label="before" value={t.before} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0, Math.min(200, v)) }} onCommit={(v) => formatParas({ 'margin-top': v ? `${v}pt` : null })} hint="Points, like 6" />
        <NumberField label="after" value={t.after} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0, Math.min(200, v)) }} onCommit={(v) => formatParas({ 'margin-bottom': v ? `${v}pt` : null })} hint="Points, like 6" />
      </Row>
      <Row label="Lists">
        <Toggle label="Bullets" on={t.list === 'ul'} onClick={() => list('ul')}><ListBullets size={15} /></Toggle>
        <Toggle label="Numbering" on={t.list === 'ol'} onClick={() => list('ol')}><ListNumbers size={15} /></Toggle>
        <Toggle label="Decrease indent" hint="⇧Tab" on={false} onClick={() => shiftIndent(-1)}><TextOutdent size={15} /></Toggle>
        <Toggle label="Increase indent" hint="Tab" on={false} onClick={() => shiftIndent(1)}><TextIndent size={15} /></Toggle>
      </Row>
    </Section>
  )
}

export function Toggle({ label, hint, on, onClick, children }: { label: string; hint?: string; on: boolean; onClick: () => void; children: React.ReactNode }) {
  // mousedown is prevented so a click never takes focus (or the selection) from text being edited.
  return <IconButton label={label} hint={hint} size="sm" tone="plain" aria-pressed={on} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</IconButton>
}

const css = (el: HTMLElement) => getComputedStyle(el)
const transparent = (c: string) => c === 'rgba(0, 0, 0, 0)' || c === 'transparent'

function FillSection({ sec, els, ids, colors }: { sec: Sec; els: HTMLElement[]; ids: string[]; colors: string[] }) {
  const first = isGroup(els[0]) ? members(els[0])[0] ?? els[0] : els[0]
  const st = css(first)
  const svg = first.tagName.toLowerCase() === 'svg'
  const path = svg ? first.querySelector('path, polygon, rect, ellipse, circle') : null
  const fill = svg ? path?.getAttribute('fill') ?? null : transparent(st.backgroundColor) ? null : st.backgroundColor
  const gradient = !svg && st.backgroundImage.includes('gradient')
  const picFill = !svg && st.backgroundImage.includes('url(')
  // A two-colour linear gradient is editable here; anything richer stays as it came, behind a chip.
  const ours = gradient ? parseGradient(first.style.backgroundImage) : null
  const bw = svg ? parseFloat(path?.getAttribute('stroke-width') ?? '0') : parseFloat(st.borderTopWidth) || 0
  const bc = svg ? path?.getAttribute('stroke') ?? null : bw ? st.borderTopColor : null
  const isRect = !svg && !st.clipPath.includes('polygon') && st.borderRadius !== '50%' && els.every((e) => kindOf(e) !== 'picture' || true)
  const mixed = (f: (e: HTMLElement) => string) => new Set(els.map(f)).size > 1
  const pt = (px: number) => Math.round(px * 0.75 * 100) / 100
  return (
    <Section title="Fill · Border" {...sec}>
      {!svg && !picFill && (
        <Row label="Kind">
          <button type="button" className={s.chipBtn} aria-pressed={!gradient} onClick={() => gradient && setObjectStyle(ids, { 'background-image': null, 'background-color': ours?.[1] ?? colors[0] ?? '#e8603c' }, 'Fill')}>Solid</button>
          <button type="button" className={s.chipBtn} aria-pressed={gradient} onClick={() => !gradient && setObjectStyle(ids, { 'background-image': grad(90, fill ?? colors[0] ?? '#e8603c', colors[1] ?? '#ffffff'), 'background-color': null }, 'Gradient fill')}>Gradient</button>
        </Row>
      )}
      <Row label="Fill">
        {picFill || (gradient && !ours)
          ? <KeptChip label={gradient ? 'Gradient' : 'Picture fill'} onReplace={() => setObjectStyle(ids, { 'background-image': gradient ? grad(90, colors[0] ?? '#e8603c', colors[1] ?? '#ffffff') : null, 'background-color': gradient ? null : colors[0] ?? '#e8603c' }, 'Fill')} />
          : gradient && ours
            ? <>
                <ColorWell label="Gradient start" value={ours[1]} colors={colors} onChange={(c) => c && setObjectStyle(ids, { 'background-image': grad(ours[0], c, ours[2]) }, 'Gradient fill')} />
                <ColorWell label="Gradient end" value={ours[2]} colors={colors} onChange={(c) => c && setObjectStyle(ids, { 'background-image': grad(ours[0], ours[1], c) }, 'Gradient fill')} />
                <NumberField label="°" value={ours[0]} format={(v) => `${v}°`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : ((Math.round(v) % 360) + 360) % 360 }} onCommit={(a) => setObjectStyle(ids, { 'background-image': grad(a, ours[1], ours[2]) }, 'Gradient angle')} hint="An angle, like 90" />
              </>
            : <ColorWell label="Fill" value={fill} colors={colors} none="No fill" mixed={mixed((e) => css(e).backgroundColor)} onChange={(c) => setObjectStyle(ids, { 'background-color': c ?? 'transparent', 'background-image': null }, 'Fill')} />}
      </Row>
      <Row label="Border">
        <ColorWell label="Border colour" value={bc} colors={colors} none="No border" onChange={(c) => setObjectStyle(ids, c ? { 'border-style': 'solid', 'border-color': c, 'border-width': bw ? `${bw}px` : '2px' } : { 'border-style': null, 'border-color': null, 'border-width': null }, 'Border')} />
        <NumberField label="pt" value={pt(bw)} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0, Math.min(100, v)) }} onCommit={(v) => setObjectStyle(ids, v ? { 'border-style': 'solid', 'border-width': `${Math.round((v / 0.75) * 100) / 100}px`, 'border-color': bc ?? 'rgba(23,23,28,1)' } : { 'border-style': null, 'border-width': null }, 'Border width')} hint="Use a width like 2" />
      </Row>
      {isRect && els.every((e) => !isGroup(e)) && (
        <Row label="Corners">
          <NumberField label="px" value={parseFloat(st.borderTopLeftRadius) || 0} format={(v) => `${Math.round(v)}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0, v) }} onCommit={(v) => setObjectStyle(ids, { 'border-radius': v ? `${v}px` : null }, 'Corner radius')} />
        </Row>
      )}
    </Section>
  )
}

function EffectsSection({ sec, els, ids }: { sec: Sec; els: HTMLElement[]; ids: string[] }) {
  const st = css(els[0])
  const shadow = st.boxShadow === 'none' ? 'none' : Object.entries(SHADOWS).find(([, v]) => v && normalizeShadow(v) === normalizeShadow(els[0].style.boxShadow))?.[0] ?? 'custom'
  const op = Math.round(parseFloat(st.opacity) * 100)
  return (
    <Section title="Effects" {...sec}>
      <Row label="Opacity">
        <NumberField label="%" value={op} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0, Math.min(100, Math.round(v))) }} onCommit={(v) => setObjectStyle(ids, { opacity: v >= 100 ? null : `${v / 100}` }, 'Opacity')} hint="Use 0 to 100" />
      </Row>
      <Row label="Shadow">
        {shadow === 'custom'
          ? <KeptChip label="Custom shadow" onReplace={() => setObjectStyle(ids, { 'box-shadow': SHADOWS.soft }, 'Shadow')} />
          : (['none', 'soft', 'hard'] as const).map((k) => (
            <button key={k} type="button" className={s.chipBtn} aria-pressed={shadow === k} onClick={() => setObjectStyle(ids, { 'box-shadow': SHADOWS[k] || null }, 'Shadow')}>{k === 'none' ? 'None' : k === 'soft' ? 'Soft' : 'Hard'}</button>
          ))}
      </Row>
    </Section>
  )
}
const normalizeShadow = (v: string) => v.replace(/\s+/g, '').replace(/0px/g, '0')

function PictureSection({ sec, el, id }: { sec: Sec; el: HTMLElement; id: string }) {
  const replace = async () => {
    const f = await pickPicture()
    if (!f) return
    try {
      const { src } = await readPicture(f)
      editSlide('Replace picture', (root) => {
        const e = find(root, id)
        const img = e?.tagName === 'IMG' ? e : e?.querySelector('img')
        if (!img) return false
        img.setAttribute('src', src)
      })
    } catch { /* readPicture reports */ }
  }
  void el
  return (
    <Section title="Picture" {...sec}>
      <Row><Button variant="secondary" icon={<ImageIcon size={15} />} onClick={() => void replace()}>Replace…</Button></Row>
    </Section>
  )
}

function ArrangeSection({ sec, els, ids, size }: { sec: Sec; els: HTMLElement[]; ids: string[]; size: { w: number; h: number } }) {
  const unit = localUnit()
  const single = els.length === 1
  const b: Box = single ? boxOf(els[0]) : unionBox(els.map(boxOf))
  const locked = els.some((e) => e.hasAttribute('data-ream-locked'))
  const fmt = (v: number) => formatLength(v, unit)
  const parse = (x: string, c: number) => parseLength(x, c, unit)
  const commit = (patch: Partial<Box>) => {
    if (single) { setBoxes(new Map([[ids[0], { ...b, ...patch }]]), 'Arrange'); return }
    // Typing W/H for several objects scales the union proportionally (spec: Arrange, multiple).
    const nb = { ...b, ...patch }
    const sx = b.w ? nb.w / b.w : 1, sy = b.h ? nb.h / b.h : 1
    setBoxes(new Map(els.map((e, i) => { const m = boxOf(e); return [ids[i], { ...m, x: nb.x + (m.x - b.x) * sx, y: nb.y + (m.y - b.y) * sy, w: m.w * sx, h: m.h * sy }] as const })), 'Arrange')
  }
  const al = (a: Align) => align(ids, a, size)
  return (
    <Section title="Arrange" {...sec}>
      <Row label="Position">
        <NumberField label="X" value={b.x} format={fmt} parse={parse} onCommit={(x) => commit({ x })} scrub={1} disabled={locked} />
        <NumberField label="Y" value={b.y} format={fmt} parse={parse} onCommit={(y) => commit({ y })} disabled={locked} />
      </Row>
      <Row label="Size">
        <NumberField label="W" value={b.w} format={fmt} parse={(x, c) => { const v = parse(x, c); return v === null ? null : Math.max(1, v) }} onCommit={(w) => commit({ w })} disabled={locked} />
        <NumberField label="H" value={b.h} format={fmt} parse={(x, c) => { const v = parse(x, c); return v === null ? null : Math.max(1, v) }} onCommit={(h) => commit({ h })} disabled={locked} />
      </Row>
      {single && !isGroup(els[0]) && (
        <Row label="Angle">
          <NumberField label="°" value={Math.round(b.rot * 10) / 10} format={(v) => `${v}°`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : ((v % 360) + 360) % 360 }} onCommit={(rot) => commit({ rot })} disabled={locked} hint="Use an angle like 45" />
        </Row>
      )}
      <Row label={single ? 'To slide' : 'Align'}>
        <Toggle label="Align left" on={false} onClick={() => al('left')}><AlignLeft size={15} /></Toggle>
        <Toggle label="Align centre" on={false} onClick={() => al('center')}><AlignCenterHorizontal size={15} /></Toggle>
        <Toggle label="Align right" on={false} onClick={() => al('right')}><AlignRight size={15} /></Toggle>
        <Toggle label="Align top" on={false} onClick={() => al('top')}><AlignTop size={15} /></Toggle>
        <Toggle label="Align middle" on={false} onClick={() => al('middle')}><AlignCenterVertical size={15} /></Toggle>
        <Toggle label="Align bottom" on={false} onClick={() => al('bottom')}><AlignBottom size={15} /></Toggle>
      </Row>
      {els.length > 2 && (
        <Row label="Distribute">
          <Toggle label="Distribute horizontally" on={false} onClick={() => distribute(ids, 'h')}><ArrowsInLineHorizontal size={15} /></Toggle>
          <Toggle label="Distribute vertically" on={false} onClick={() => distribute(ids, 'v')}><ArrowsInLineVertical size={15} /></Toggle>
        </Row>
      )}
      <Row label="Order">
        <Toggle label="Bring forward" hint="⌘]" on={false} onClick={() => reorder(ids, 'forward')}><ArrowUp size={15} /></Toggle>
        <Toggle label="Send backward" hint="⌘[" on={false} onClick={() => reorder(ids, 'backward')}><ArrowDown size={15} /></Toggle>
        <Toggle label="Bring to front" hint="⌥⌘]" on={false} onClick={() => reorder(ids, 'front')}><ArrowLineUp size={15} /></Toggle>
        <Toggle label="Send to back" hint="⌥⌘[" on={false} onClick={() => reorder(ids, 'back')}><ArrowLineDown size={15} /></Toggle>
      </Row>
      <Row label="Object">
        {els.length > 1 && <Toggle label="Group" hint="⌘G" on={false} onClick={() => group(ids)}><SelectionIcon size={15} /></Toggle>}
        {els.some(isGroup) && <Toggle label="Ungroup" hint="⌘⇧G" on={false} onClick={() => ungroup(ids)}><SelectionSlash size={15} /></Toggle>}
        <Toggle label={locked ? 'Unlock' : 'Lock'} hint="⌘⇧L" on={locked} onClick={() => toggleAttr(ids, 'data-ream-locked', locked ? 'Unlock' : 'Lock')}>{locked ? <Lock size={15} /> : <LockOpen size={15} />}</Toggle>
      </Row>
    </Section>
  )
}

function SlidePanel({ deck, slide, sec, colors }: { deck: Deck; slide: SlideDoc; sec: (n: string, d?: boolean) => Sec; colors: string[] }) {
  const stage = liveStage()
  const root = stage?.querySelector<HTMLElement>('.domoxml-slide')
  const bg = root ? getComputedStyle(root).backgroundColor : '#ffffff'
  const objects = root ? ([...root.children].filter((c) => c.hasAttribute('data-domoxml-node-id')) as HTMLElement[]) : []
  const [drag, setDrag] = useState<number | null>(null)
  const missing = useMissingFonts(deck)
  return (
    <>
      <Section title="Slide" {...sec('slide')}>
        <Row label="Background">
          {root && getComputedStyle(root).backgroundImage !== 'none'
            ? <KeptChip label={getComputedStyle(root).backgroundImage.includes('gradient') ? 'Gradient' : 'Picture'} onReplace={() => setBackground(toHex(bg))} />
            : <ColorWell label="Background" value={bg} colors={colors} onChange={(c) => c && setBackground(c)} />}
          {deck.slides.length > 1 && <button type="button" className={s.linkBtn} onClick={() => setBackground(bg, deck.slides.map((x) => x.id))}>Apply to all</button>}
        </Row>
        {missing.map((f) => <p key={f} className={s.note}>{f} isn’t available here; showing a similar font. Exports keep {f}.</p>)}
      </Section>
      <TransitionSection slide={slide} deck={deck} sec={sec('transition', false)} />
      <Section title="Objects on this slide" {...sec('objects')}>
        {!objects.length && <p className={s.note}>Nothing on this slide yet. Add text, a shape or a picture from the header.</p>}
        <ol className={s.objects} aria-label="Objects, front to back">
          {[...objects].reverse().map((el, ri) => {
            const i = objects.length - 1 - ri
            const id = el.getAttribute('data-domoxml-node-id')!
            const locked = el.hasAttribute('data-ream-locked')
            const hidden = el.hasAttribute('data-ream-hidden')
            return (
              <li key={id} className={s.object} data-drop={drag !== null && drag !== i ? 'maybe' : undefined}
                draggable onDragStart={(e) => { setDrag(i); e.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDrag(null)}
                onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (drag !== null && drag !== i) moveToIndex(objects[drag].getAttribute('data-domoxml-node-id')!, i); setDrag(null) }}>
                <DotsSixVertical size={14} className={s.grip} aria-hidden />
                <button type="button" className={s.objectName} onClick={() => { select([id], null); setEditor({ scope: null }) }}>{objectName(el)}</button>
                <Tooltip label={hidden ? 'Show' : 'Hide'}><button type="button" className={s.objectBtn} aria-pressed={hidden} aria-label={hidden ? 'Show' : 'Hide'} onClick={() => toggleAttr([id], 'data-ream-hidden', hidden ? 'Show' : 'Hide')}>{hidden ? <EyeSlash size={14} /> : <Eye size={14} />}</button></Tooltip>
                <Tooltip label={locked ? 'Unlock' : 'Lock'}><button type="button" className={s.objectBtn} aria-pressed={locked} aria-label={locked ? 'Unlock' : 'Lock'} onClick={() => toggleAttr([id], 'data-ream-locked', locked ? 'Unlock' : 'Lock')}>{locked ? <Lock size={14} /> : <LockOpen size={14} />}</button></Tooltip>
              </li>
            )
          })}
        </ol>
        {objects.length > 1 && <p className={s.hint}>Drag to change the order. Top of the list is in front.</p>}
      </Section>
      <Section title="Speaker notes" {...sec('notes', false)}>
        <NotesField slide={slide} />
      </Section>
    </>
  )
}

function NotesField({ slide }: { slide: SlideDoc }) {
  const stored = notesOf(slide)
  const [text, setText] = useState(stored)
  useEffect(() => setText(stored), [slide.id, stored])
  return (
    <textarea className={s.notes} value={text} placeholder="Notes for the presenter" aria-label="Speaker notes"
      onChange={(e) => setText(e.target.value)} onBlur={() => { if (text !== stored) setNotes(slide.id, text) }} />
  )
}

function colorsOf(deck: Deck): string[] {
  const count = new Map<string, number>()
  for (const sl of deck.slides.slice(0, 40)) {
    for (const m of sl.html.matchAll(/(?:^|[;"\s])(?:color|background-color):\s*(rgba?\([^)]*\)|#[0-9a-f]{3,8})/gi)) {
      const c = m[1].replace(/\s+/g, '')
      if (/rgba\([^)]*,0\)$/.test(c)) continue
      count.set(c, (count.get(c) ?? 0) + 1)
    }
  }
  const seen = new Set<string>()
  return [...count].sort((a, b) => b[1] - a[1]).map(([c]) => c).filter((c) => { const h = toHex(c); if (seen.has(h)) return false; seen.add(h); return true }).slice(0, 16)
}

/** Deck fonts this browser can't show (spec: missing fonts). */
function useMissingFonts(deck: Deck): string[] {
  const [out, setOut] = useState<string[]>([])
  useEffect(() => {
    const fams = new Set<string>()
    for (const sl of deck.slides.slice(0, 40)) for (const m of sl.html.matchAll(/font-family:([^;"]+)/g)) { const f = m[1].split(',')[0].replace(/&quot;|["']/g, '').trim(); if (f && !f.startsWith('+')) fams.add(f) }
    void document.fonts.ready.then(() => setOut([...fams].filter((f) => { try { return !document.fonts.check(`12px "${f}"`) || !fontExists(f) } catch { return false } }).slice(0, 3)))
  }, [deck])
  return out
}
// document.fonts.check is true for any font it doesn't need to load; compare against a fallback's width.
function fontExists(f: string): boolean {
  const c = document.createElement('canvas').getContext('2d')!
  const probe = 'mmmmmmmmmlliW@#'
  c.font = '40px monospace'; const a = c.measureText(probe).width
  c.font = `40px "${f}", monospace`; const b = c.measureText(probe).width
  c.font = '40px serif'; const a2 = c.measureText(probe).width
  c.font = `40px "${f}", serif`; const b2 = c.measureText(probe).width
  return a !== b || a2 !== b2
}
void textHost

// ---------- motion (domOXML's data-transition* and data-animate*, written natively on export) ----------

const TRANSITIONS = ['none', 'fade', 'push', 'wipe', 'split', 'cover', 'uncover', 'zoom', 'dissolve', 'morph', 'cut'] as const
const DIRECTIONAL = new Set(['push', 'wipe', 'cover', 'uncover'])
const DIRECTIONS = [['l', 'From right'], ['r', 'From left'], ['u', 'From bottom'], ['d', 'From top']] as const
const cap = (x: string) => x[0].toUpperCase() + x.slice(1)

function TransitionSection({ slide, deck, sec }: { slide: SlideDoc; deck: Deck; sec: Sec }) {
  const root = new DOMParser().parseFromString(slide.html, 'text/html').querySelector('.domoxml-slide')
  const type = root?.getAttribute('data-transition') ?? 'none'
  const dur = Number(root?.getAttribute('data-transition-duration') ?? 700)
  const dir = root?.getAttribute('data-transition-direction') ?? 'l'
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const set = (attrs: Record<string, string | null>, all = false) => setSlideAttrs(attrs, 'Transition', all ? deck.slides.map((x) => x.id) : undefined)
  return (
    <Section title="Transition" {...sec}>
      <Row label="Effect">
        <button type="button" className={s.select} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }) }}>{cap(type)}</button>
        <Menu open={!!menu} anchor={menu} label="Transition" onClose={() => setMenu(null)} items={TRANSITIONS.map((t) => ({ label: cap(t), selected: t === type, run: () => set(t === 'none' ? { 'data-transition': null, 'data-transition-duration': null, 'data-transition-direction': null } : { 'data-transition': t }) }))} />
      </Row>
      {type !== 'none' && type !== 'cut' && (
        <Row label="Duration">
          <NumberField label="s" value={dur / 1000} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0.1, Math.min(10, v)) }} onCommit={(v) => set({ 'data-transition-duration': String(Math.round(v * 1000)) })} hint="Use seconds, like 0.7" />
        </Row>
      )}
      {DIRECTIONAL.has(type) && (
        <Row label="Direction">
          {DIRECTIONS.map(([d, label]) => <button key={d} type="button" className={s.chipBtn} aria-pressed={dir === d} onClick={() => set({ 'data-transition-direction': d })}>{label.replace('From ', '')}</button>)}
        </Row>
      )}
      {type !== 'none' && deck.slides.length > 1 && <Row><button type="button" className={s.linkBtn} onClick={() => set({ 'data-transition': type, 'data-transition-duration': root?.getAttribute('data-transition-duration') ?? null, 'data-transition-direction': root?.getAttribute('data-transition-direction') ?? null }, true)}>Apply to all slides</button></Row>}
    </Section>
  )
}

const EFFECTS = [['appear', 'Appear'], ['fade', 'Fade in'], ['grow', 'Grow'], ['spin', 'Spin'], ['fade-out', 'Fade out'], ['disappear', 'Disappear']] as const

function AnimateSection({ sec, els, ids }: { sec: Sec; els: HTMLElement[]; ids: string[] }) {
  const a = animOf(els[0])
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const label = a ? EFFECTS.find(([k]) => k === a.effect)?.[1] ?? a.effect : 'None'
  return (
    <Section title="Animate" {...sec} aside={a ? <span className={s.badge}>{a.step === 0 ? 'With slide' : `Click ${a.step}`}</span> : undefined}>
      <Row label="Effect">
        <button type="button" className={s.select} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }) }}>{label}</button>
        <Menu open={!!menu} anchor={menu} label="Animation" onClose={() => setMenu(null)} items={[
          { label: 'None', selected: !a, run: () => setAnimation(ids, null) },
          { kind: 'header', content: 'Entrance' }, ...EFFECTS.slice(0, 2).map(([k, l]) => ({ label: l, selected: a?.effect === k, run: () => setAnimation(ids, { effect: k, step: a?.step ?? -1, delay: a?.delay ?? 0, duration: a?.duration ?? 500 }) })),
          { kind: 'header', content: 'Emphasis' }, ...EFFECTS.slice(2, 4).map(([k, l]) => ({ label: l, selected: a?.effect === k, run: () => setAnimation(ids, { effect: k, step: a?.step ?? -1, delay: a?.delay ?? 0, duration: a?.duration ?? 1000 }) })),
          { kind: 'header', content: 'Exit' }, ...EFFECTS.slice(4).map(([k, l]) => ({ label: l, selected: a?.effect === k, run: () => setAnimation(ids, { effect: k, step: a?.step ?? -1, delay: a?.delay ?? 0, duration: a?.duration ?? 500 }) })),
        ]} />
      </Row>
      {a && <>
        <Row label="Start">
          <button type="button" className={s.chipBtn} aria-pressed={a.step > 0} onClick={() => a.step === 0 && setAnimation(ids, { ...a, step: -1 })}>On click</button>
          <button type="button" className={s.chipBtn} aria-pressed={a.step === 0} onClick={() => setAnimation(ids, { ...a, step: 0 })}>With slide</button>
        </Row>
        <Row label="Timing">
          <NumberField label="s" value={a.duration / 1000} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0.05, Math.min(60, v)) }} onCommit={(v) => setAnimation(ids, { ...a, duration: v * 1000 })} hint="Duration in seconds" />
          <NumberField label="delay" value={a.delay / 1000} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0, Math.min(60, v)) }} onCommit={(v) => setAnimation(ids, { ...a, delay: v * 1000 })} hint="Delay in seconds" />
        </Row>
      </>}
    </Section>
  )
}

// ---------- charts, tables, alt text ----------

function ChartSection({ sec, el, id }: { sec: Sec; el: HTMLElement; id: string }) {
  const spec = readSpec(el)
  const [editing, setEditing] = useState(false)
  if (!spec) return null
  return (
    <Section title="Chart" {...sec}>
      <Row label="Type">
        {CHART_TYPES.map((t) => <button key={t.type} type="button" className={s.chipBtn} aria-pressed={spec.type === t.type} onClick={() => setChart(id, t.type === 'pie' ? { ...spec, type: t.type, series: spec.series.slice(0, 1) } : { ...spec, type: t.type })}>{t.label}</button>)}
      </Row>
      <Row><Button variant="secondary" onClick={() => setEditing(true)}>Edit data…</Button></Row>
      <p className={s.note}>Exports as a native PowerPoint chart, with its data, so Edit Data works there too.</p>
      {editing && <ChartData id={id} spec={spec} onClose={() => setEditing(false)} />}
    </Section>
  )
}

function TableSection({ sec, el, id, colors }: { sec: Sec; el: HTMLElement; id: string; colors: string[] }) {
  const live = editingLive()
  const at = activeCell(el, live && el.contains(live.host) ? live.host : null)
  const editingCell = !!(live && el.contains(live.host))
  const op = (o: Parameters<typeof tableOp>[1]) => { endEdit(); tableOp(id, o, at) }
  const rows = el.querySelectorAll('tr').length, cols = el.querySelectorAll('col').length || el.querySelector('tr')?.children.length || 0
  return (
    <Section title="Table" {...sec} aside={<span className={s.badge}>{rows} × {cols}</span>}>
      <Row label="Rows">
        <button type="button" className={s.chipBtn} onClick={() => op('row-above')}>Above</button>
        <button type="button" className={s.chipBtn} onClick={() => op('row-below')}>Below</button>
        <button type="button" className={s.chipBtn} disabled={rows < 2} onClick={() => op('del-row')}>Delete</button>
      </Row>
      <Row label="Columns">
        <button type="button" className={s.chipBtn} onClick={() => op('col-left')}>Left</button>
        <button type="button" className={s.chipBtn} onClick={() => op('col-right')}>Right</button>
        <button type="button" className={s.chipBtn} disabled={cols < 2} onClick={() => op('del-col')}>Delete</button>
      </Row>
      <Row label={editingCell ? 'This cell' : 'Cells'}>
        <ColorWell label="Cell fill" value={null} colors={colors} none="No fill" onChange={(c) => fillCells(id, c, editingCell ? at : 'all')} />
        {!editingCell && <><span className={s.hint}>Header</span><ColorWell label="Header fill" value={null} colors={colors} none="No fill" onChange={(c) => fillCells(id, c, 'header')} /></>}
        <span className={s.hint}>Borders</span>
        <ColorWell label="Borders" value={null} colors={colors} none="No borders" onChange={(c) => borderCells(id, c)} />
      </Row>
      <p className={s.hint}>Double-click a cell to type. Tab moves to the next cell.</p>
    </Section>
  )
}

function AltTextSection({ sec, el, id }: { sec: Sec; el: HTMLElement; id: string }) {
  const stored = el.getAttribute('alt') ?? el.getAttribute('aria-label') ?? ''
  const [text, setText] = useState(stored)
  useEffect(() => setText(stored), [id, stored])
  const save = () => {
    if (text === stored) return
    editSlide('Alt text', (root) => {
      const e = find(root, id)
      if (!e) return false
      if (e.tagName === 'IMG') e.setAttribute('alt', text)
      else if (text) e.setAttribute('aria-label', text)
      else e.removeAttribute('aria-label')
    })
  }
  return (
    <Section title="Alt text" {...sec}>
      <textarea className={s.notes} style={{ minHeight: 64 }} value={text} placeholder="Describe it for people who can’t see it" aria-label="Alt text" onChange={(e) => setText(e.target.value)} onBlur={save} />
    </Section>
  )
}

const grad = (angle: number, a: string, b: string) => `linear-gradient(${angle}deg, ${a}, ${b})`
function parseGradient(v: string): [number, string, string] | null {
  const m = /^linear-gradient\((-?[\d.]+)deg,\s*(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+),\s*(rgba?\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\)$/i.exec(v.trim())
  return m ? [parseFloat(m[1]), m[2], m[3]] : null
}
