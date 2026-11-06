// The context bar (spec v3): one strip above the slide that changes with the selection, replacing the Format
// column and the floating text bar. Fixed slots: [Objects · selection] | [text] | [kind] | ⟶ [Arrange · Animate · ⋯].
// Buttons with ▾ open paper popovers holding the property sections, laid flat. Text controls keep the text edit
// alive and return to its caret. A click outside a popover closes it.
import {
  CaretDown, ChatCircle, DotsThree, Function as FnIcon, ListBullets, ListNumbers, PaintBucket, Selection as SelectionIcon, SelectionSlash,
  Sparkle, Stack, TextAlignCenter, TextAlignJustify, TextAlignLeft, TextAlignRight, TextAa, TextB, TextItalic, TextUnderline, FilmStrip, ArrowsOutCardinal,
  TextIndent, TextOutdent, AlignTop, AlignCenterVertical, AlignBottom, Drop, Image as ImageIcon, Table as TableIcon, ChartBar, LineSegment,
} from '@phosphor-icons/react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useLibrary } from '../data/library'
import type { Deck, SlideDoc } from '../data/types'
import { FONTS, fontStack } from '../slides/fonts'
import { ColorWell, FlatSections, KeptChip, NumberField, Row, Section, Slider, toHex } from '../ui/Inspector'
import { Menu, type MenuAnchor } from '../ui/Menu'
import { Popover } from '../ui/Popover'
import { Toolbar, type ToolbarHandle } from '../ui/Toolbar'
import { Tooltip } from '../ui/Tooltip'
import { liveStage } from './Canvas'
import { ChartData } from './ChartData'
import { readSpec } from './chart'
import { isGroup } from './geometry'
import { find, group, setAnchor, setBackground, ungroup } from './ops'
import { CommentsSection } from './Review'
import {
  AltTextSection, AnimateSection, ArrangeSection, ChartSection, EffectsSection, FillSection, FLAT, LineSection, ObjectList, PictureSection,
  TableSection, Toggle, TransitionSection, anchorOf, colorsOf, kindOf, objectName,
} from './Sections'
import { useEditor } from './session'
import { editingLive, formatParas, formatRuns, list, onTextChange, refocus, shiftIndent, textState, type TextState } from './textctl'
import { parseNumber } from './units'
import s from './ContextBar.module.css'

type Pop = { key: string; anchor: HTMLElement }

export function ContextBar({ deck, slide, index }: { deck: Deck; slide: SlideDoc; index: number }) {
  useLibrary() // re-read the live stage whenever the deck changes
  const sel = useEditor((e) => e.sel)
  const editing = useEditor((e) => e.editing)
  const locked = useEditor((e) => e.locked.includes(slide.id))
  const [, setT] = useState(0)
  useEffect(() => onTextChange(() => setT((t) => t + 1)), [])
  // The live stage renders in the same commit; read it after layout.
  useEffect(() => { const r = requestAnimationFrame(() => setT((t) => t + 1)); return () => cancelAnimationFrame(r) }, [slide.html, sel, editing])
  const root = useRef<HTMLDivElement>(null)
  const bar = useRef<ToolbarHandle>(null)
  // Density steps down until everything fits (spec: overflow): 0 every label, 1 the text group's labels go,
  // 2 every label goes, 3 alignment, lists and paragraph fold into Text ▾. Measured before paint.
  const [density, setDensity] = useState(0)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const el = root.current!
    const ro = new ResizeObserver(() => setWidth((w) => (w === el.clientWidth ? w : el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const sig = `${sel.join()}|${editing}|${width}`
  useLayoutEffect(() => setDensity(0), [sig])
  const [pop, setPop] = useState<Pop | null>(null)
  const [chartData, setChartData] = useState(false)

  const stage = liveStage()
  const els = sel.map((id) => (stage ? find(stage, id) : null)).filter((e): e is HTMLElement => !!e)
  const kinds = els.map(kindOf)
  const one = els.length === 1 ? kinds[0] : null
  const colors = colorsOf(deck)
  const size = deck.size ?? { w: 1280, h: 720 }
  const withText = !!editing || els.some((e) => !!e.querySelector('.domoxml-text, li'))
  const textOk = withText && kinds.every((k) => k === 'text' || k === 'shape' || k === 'table')
  const styleable = els.length > 0 && kinds.every((k) => k === 'text' || k === 'shape' || k === 'svg' || k === 'picture' || k === 'group' || k === 'chart')
  const t = textOk ? textState(stage) : null
  const textLabels = density < 1
  const labels = density < 2
  const fold = density >= 3
  useLayoutEffect(() => {
    const el = root.current?.querySelector<HTMLElement>('[data-toolbar]')
    if (el && el.scrollWidth > el.clientWidth + 1 && density < 3) setDensity(density + 1)
  })

  const toggle = (key: string) => (e: React.MouseEvent<HTMLElement>) => { const a = e.currentTarget; setPop((p) => (p?.key === key ? null : { key, anchor: a })) }
  // ⌥⌘I focuses the bar; Alt+F10 opens Objects (PowerPoint's Selection Pane shortcut).
  useEffect(() => {
    const focusBar = () => bar.current?.focus()
    const objects = () => { const a = root.current?.querySelector<HTMLElement>('[data-pop="objects"]'); if (a) setPop({ key: 'objects', anchor: a }) }
    addEventListener('ream:focus-bar', focusBar)
    addEventListener('ream:objects', objects)
    return () => { removeEventListener('ream:focus-bar', focusBar); removeEventListener('ream:objects', objects) }
  }, [])

  // What each popover key shows for this selection; a key the selection doesn't offer closes its popover.
  const panels: Record<string, { label: string; body: () => ReactNode; width?: number } | undefined> = {
    objects: { label: 'Objects on this slide', body: () => <Section title="Objects on this slide" {...FLAT}><ObjectList /></Section>, width: 300 },
    transition: !els.length ? { label: 'Transition', body: () => <TransitionSection slide={slide} deck={deck} sec={FLAT} /> } : undefined,
    slideComments: !els.length ? { label: 'Comments on this slide', body: () => <CommentsSection slide={slide} sec={FLAT} />, width: 320 } : undefined,
    align: t ? { label: 'Text alignment', body: () => <AlignPanel t={t} ids={sel} /> } : undefined,
    paragraph: t ? { label: 'Paragraph', body: () => <ParagraphPanel t={t} /> } : undefined,
    text: t && fold ? { label: 'Text', body: () => <><AlignPanel t={t} ids={sel} /><ListsPanel t={t} /><ParagraphPanel t={t} /></> } : undefined,
    fill: styleable && one !== 'picture' ? { label: 'Fill and border', body: () => <FillSection sec={FLAT} els={els} ids={sel} colors={colors} /> } : undefined,
    border: styleable && one === 'picture' ? { label: 'Border', body: () => <FillSection sec={FLAT} els={els} ids={sel} colors={colors} /> } : undefined,
    effects: styleable && kinds.some((k) => k !== 'text') ? { label: 'Effects', body: () => <EffectsSection sec={FLAT} els={els} ids={sel} /> } : undefined,
    picture: one === 'picture' ? { label: 'Picture', body: () => <PictureSection sec={FLAT} el={els[0]} id={sel[0]} /> } : undefined,
    table: one === 'table' ? { label: 'Table', body: () => <TableSection sec={FLAT} el={els[0]} id={sel[0]} colors={colors} />, width: 320 } : undefined,
    chart: one === 'chart' ? { label: 'Chart', body: () => <ChartSection sec={FLAT} el={els[0]} id={sel[0]} /> } : undefined,
    line: kinds.length > 0 && kinds.every((k) => k === 'line') ? { label: 'Line', body: () => <LineSection sec={FLAT} els={els} ids={sel} colors={colors} /> } : undefined,
    arrange: els.length ? { label: els.length > 1 ? 'Arrange and align' : 'Arrange', body: () => <ArrangeSection sec={FLAT} els={els} ids={sel} size={size} /> } : undefined,
    animate: els.length ? { label: 'Animate', body: () => <AnimateSection sec={FLAT} els={els} ids={sel} /> } : undefined,
    more: els.length === 1 ? { label: 'More', width: 300, body: () => <>
      {(one === 'picture' || one === 'chart' || one === 'preserved' || one === 'shape' || one === 'svg') && <AltTextSection sec={FLAT} el={els[0]} id={sel[0]} />}
      <CommentsSection slide={slide} objectId={sel[0]} objectName={objectName(els[0]).split(':')[0].toLowerCase()} sec={FLAT} />
    </> } : undefined,
  }
  const open = pop && panels[pop.key] ? pop : null
  useEffect(() => { if (pop && !panels[pop.key]) setPop(null) })
  const anchor = open ? (open.anchor.isConnected ? open.anchor : root.current?.querySelector<HTMLElement>(`[data-pop="${open.key}"]`) ?? null) : null
  const closed = () => { if (editingLive()) refocus(); else anchor?.focus({ preventScroll: true }) }

  const btn = (key: string, label: string, icon: ReactNode, show = labels) => panels[key] && (
    <BarButton key={key} pop={key} label={label} icon={icon} showLabel={show} expanded={open?.key === key} onClick={toggle(key)} />
  )
  const what = els.length > 1 ? `${els.length} objects` : els[0] ? (els[0].getAttribute('data-ream-name') ?? objectName(els[0]).split(':')[0]) : `Slide ${index + 1}`

  return (
    <div ref={root} className={s.wrap}>
      <Toolbar ref={bar} label="Format" region="bar" className={s.bar} inert={locked}>
        <span className={s.slot}>
          <Tooltip label="Objects on this slide" hint="Alt F10">
            <button type="button" className={s.chip} data-pop="objects" aria-haspopup="dialog" aria-expanded={open?.key === 'objects'} onClick={toggle('objects')}>
              <Stack size={15} /><span className={s.chipLabel}>Objects</span><CaretDown size={10} weight="bold" />
            </button>
          </Tooltip>
          <span className={s.what} aria-live="polite">{what}</span>
        </span>

        {!els.length && !editing && <span className={s.slot}>
          <SlideBackground deck={deck} colors={colors} />
          {btn('transition', 'Transition', <FilmStrip size={15} />)}
          {btn('slideComments', slide.comments?.some((c) => !c.resolved) ? `Comments (${slide.comments.filter((c) => !c.resolved).length})` : 'Comments', <ChatCircle size={15} />)}
        </span>}

        {t && <span className={s.slot}>
          <FontButton t={t} />
          <NumberField label="pt" name="Font size, points" width={66} mixed={t.mixed.has('size')} value={t.sizePt} format={(v) => `${v}`}
            parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(1, Math.min(400, v)) }}
            onCommit={(v) => { formatRuns({ 'font-size': `${v}pt` }, 'Font size'); if (editingLive()) requestAnimationFrame(refocus) }} hint="Use a size like 24" />
          <span onMouseDown={(e) => e.preventDefault()}>
            <ColorWell label="Text colour" value={t.color} mixed={t.mixed.has('color')} colors={colors} onClosed={editingLive() ? refocus : undefined}
              onChange={(c) => { if (!c) return; if (editingLive()) refocus(); formatRuns({ color: c }, 'Text colour') }} />
          </span>
          <Toggle label="Bold" hint="⌘B" on={t.mixed.has('bold') ? 'mixed' : t.bold} onClick={() => formatRuns({ 'font-weight': t.bold && !t.mixed.has('bold') ? '400' : '700' }, 'Bold')}><TextB size={15} weight="bold" /></Toggle>
          <Toggle label="Italic" hint="⌘I" on={t.mixed.has('italic') ? 'mixed' : t.italic} onClick={() => formatRuns({ 'font-style': t.italic ? 'normal' : 'italic' }, 'Italic')}><TextItalic size={15} /></Toggle>
          <Toggle label="Underline" hint="⌘U" on={t.mixed.has('underline') ? 'mixed' : t.underline} onClick={() => formatRuns({ 'text-decoration-line': t.underline ? null : 'underline' }, 'Underline')}><TextUnderline size={15} /></Toggle>
          {fold ? btn('text', 'Text', <TextAa size={15} />) : <>
            {btn('align', 'Text alignment', <AlignIcon align={t.align} />, textLabels)}
            <Toggle label="Bullets" on={t.list === 'ul'} onClick={() => list('ul')}><ListBullets size={15} /></Toggle>
            <Toggle label="Numbering" on={t.list === 'ol'} onClick={() => list('ol')}><ListNumbers size={15} /></Toggle>
            {btn('paragraph', 'Paragraph', <TextIndent size={15} />, textLabels)}
          </>}
        </span>}

        {els.length > 0 && <span className={s.slot}>
          {one === 'preserved' && <span className={s.note}>Kept exactly as in PowerPoint</span>}
          {els.length > 1 && !kinds.includes('group') && <Toggle label="Group" hint="⌘G" on={false} onClick={() => group(sel)}><SelectionIcon size={15} /></Toggle>}
          {els.some(isGroup) && <Toggle label="Ungroup" hint="⌘⇧G" on={false} onClick={() => ungroup(sel)}><SelectionSlash size={15} /></Toggle>}
          {one === 'chart' && readSpec(els[0]) && <BarButton label="Edit data" icon={<FnIcon size={15} />} showLabel onClick={() => setChartData(true)} />}
          {btn('chart', 'Chart', <ChartBar size={15} />)}
          {btn('table', 'Table', <TableIcon size={15} />)}
          {btn('picture', 'Picture', <ImageIcon size={15} />)}
          {btn('line', 'Line', <LineSegment size={15} />)}
          {btn('fill', 'Fill and border', <PaintBucket size={15} />)}
          {btn('border', 'Border', <PaintBucket size={15} />)}
          {btn('effects', 'Effects', <Drop size={15} />)}
        </span>}

        {els.length > 0 && <span className={`${s.slot} ${s.end}`}>
          {btn('arrange', 'Arrange', <ArrowsOutCardinal size={15} />)}
          {btn('animate', 'Animate', <Sparkle size={15} />)}
          {panels.more && <BarButton pop="more" label="More" icon={<DotsThree size={16} weight="bold" />} showLabel={false} expanded={open?.key === 'more'} onClick={toggle('more')} />}
        </span>}
      </Toolbar>

      {open && anchor && (
        <Popover anchor={anchor} label={panels[open.key]!.label} width={panels[open.key]!.width} onClose={() => setPop(null)} onClosed={closed}>
          <FlatSections.Provider value>{panels[open.key]!.body()}</FlatSections.Provider>
        </Popover>
      )}
      {chartData && one === 'chart' && readSpec(els[0]) && <ChartData id={sel[0]} spec={readSpec(els[0])!} onClose={() => setChartData(false)} />}
    </div>
  )
}

function BarButton({ label, icon, showLabel, expanded, onClick, pop }: { label: string; icon: ReactNode; showLabel: boolean; expanded?: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void; pop?: string }) {
  const b = (
    <button type="button" className={s.btn} data-pop={pop} aria-label={showLabel ? undefined : label} aria-haspopup={pop ? 'dialog' : undefined} aria-expanded={pop ? !!expanded : undefined} onClick={onClick}>
      {icon}{showLabel && <span>{label}</span>}{pop && pop !== 'more' && <CaretDown size={10} weight="bold" className={s.caret} />}
    </button>
  )
  return showLabel ? b : <Tooltip label={label}>{b}</Tooltip>
}

const FONT_NAMES = FONTS.map((f) => f.name)

function FontButton({ t }: { t: TextState }) {
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const mixed = t.mixed.has('family')
  return (
    <>
      <button type="button" className={s.font} aria-haspopup="menu" aria-expanded={!!menu} aria-label={`Font: ${mixed ? 'mixed' : t.family}`}
        style={{ fontFamily: mixed ? undefined : fontStack(t.family) }} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4 }) }}>
        <span>{mixed ? 'Mixed' : t.family}</span><CaretDown size={10} weight="bold" />
      </button>
      <Menu open={!!menu} anchor={menu} label="Font" search="Find a font" onClose={() => setMenu(null)}
        items={[...new Set([t.family, ...FONT_NAMES])].map((f) => ({ label: f, selected: !mixed && f === t.family, run: () => { if (editingLive()) refocus(); formatRuns({ 'font-family': fontStack(f) }, 'Font') } }))} />
    </>
  )
}

function AlignIcon({ align }: { align: string }) {
  const I = { left: TextAlignLeft, center: TextAlignCenter, right: TextAlignRight, justify: TextAlignJustify }[align] ?? TextAlignLeft
  return <I size={15} />
}

function AlignPanel({ t, ids }: { t: TextState; ids: string[] }) {
  const anchor = anchorOf(ids)
  return (
    <Section title="Text alignment" {...FLAT}>
      <Row label="Across">
        {(['left', 'center', 'right', 'justify'] as const).map((a) => (
          <Toggle key={a} label={a === 'center' ? 'Centre' : a[0].toUpperCase() + a.slice(1)} on={!t.mixed.has('align') && t.align === a} onClick={() => formatParas({ 'text-align': a })}><AlignIcon align={a} /></Toggle>
        ))}
      </Row>
      <Row label="In the box">
        <Toggle label="Top" on={anchor === 'top'} onClick={() => setAnchor(ids, 'top')}><AlignTop size={15} /></Toggle>
        <Toggle label="Middle" on={anchor === 'middle'} onClick={() => setAnchor(ids, 'middle')}><AlignCenterVertical size={15} /></Toggle>
        <Toggle label="Bottom" on={anchor === 'bottom'} onClick={() => setAnchor(ids, 'bottom')}><AlignBottom size={15} /></Toggle>
      </Row>
    </Section>
  )
}

function ListsPanel({ t }: { t: TextState }) {
  return (
    <Section title="Lists" {...FLAT}>
      <Row>
        <Toggle label="Bullets" on={t.list === 'ul'} onClick={() => list('ul')}><ListBullets size={15} /></Toggle>
        <Toggle label="Numbering" on={t.list === 'ol'} onClick={() => list('ol')}><ListNumbers size={15} /></Toggle>
        <Toggle label="Decrease indent" hint="⇧Tab" on={false} onClick={() => shiftIndent(-1)}><TextOutdent size={15} /></Toggle>
        <Toggle label="Increase indent" hint="Tab" on={false} onClick={() => shiftIndent(1)}><TextIndent size={15} /></Toggle>
      </Row>
    </Section>
  )
}

function ParagraphPanel({ t }: { t: TextState }) {
  return (
    <Section title="Paragraph" {...FLAT}>
      <Row label="Line spacing">
        {[1, 1.15, 1.5, 2].map((v) => <Toggle key={v} label={`${v} lines`} on={t.lineHeight === v} onClick={() => formatParas({ 'line-height': `${Math.round(v * 1.2 * 1000) / 1000}` })}><span className={s.num}>{v}</span></Toggle>)}
      </Row>
      <Row label="">
        <NumberField label="×" name="Line spacing, multiple" value={t.lineHeight} format={(v) => `${v}`} parse={(x, c) => { const v = parseNumber(x, c); return v === null ? null : Math.max(0.5, Math.min(5, v)) }} onCommit={(v) => formatParas({ 'line-height': `${Math.round(v * 1.2 * 1000) / 1000}` })} step={0.1} hint="A multiple, like 1.15" />
      </Row>
      <Row label="Before">
        <Slider label="Space before paragraph" min={0} max={48} value={t.before} format={(v) => (v ? `${v} pt` : 'None')} onCommit={(v) => formatParas({ 'margin-top': v ? `${v}pt` : null })} />
      </Row>
      <Row label="After">
        <Slider label="Space after paragraph" min={0} max={48} value={t.after} format={(v) => (v ? `${v} pt` : 'None')} onCommit={(v) => formatParas({ 'margin-bottom': v ? `${v}pt` : null })} />
      </Row>
      <Row label="Indent">
        <Toggle label="Decrease indent" hint="⇧Tab" on={false} onClick={() => shiftIndent(-1)}><TextOutdent size={15} /></Toggle>
        <Toggle label="Increase indent" hint="Tab" on={false} onClick={() => shiftIndent(1)}><TextIndent size={15} /></Toggle>
      </Row>
    </Section>
  )
}

function SlideBackground({ deck, colors }: { deck: Deck; colors: string[] }) {
  const root = liveStage()?.querySelector<HTMLElement>('.domoxml-slide')
  if (!root) return null
  const cs = getComputedStyle(root)
  const bg = cs.backgroundColor
  return (
    <span className={s.group} role="group" aria-label="Background">
      <span className={s.label}>Background</span>
      {cs.backgroundImage !== 'none'
        ? <KeptChip label={cs.backgroundImage.includes('gradient') ? 'Gradient' : 'Picture'} onReplace={() => setBackground(toHex(bg))} />
        : <ColorWell label="Background" value={bg} colors={colors} onChange={(c) => c && setBackground(c)} />}
      {deck.slides.length > 1 && <button type="button" className={s.link} onClick={() => setBackground(bg, deck.slides.map((x) => x.id))}>Apply to all</button>}
    </span>
  )
}

