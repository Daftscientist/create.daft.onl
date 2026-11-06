// The deck editor (docs/design/specs/editor.md). Mica header with the insert bar, undo/redo, honest save
// status, Download, Format|Ask and Present; the slide rail; the canvas; one shared, resizable column for
// Format or Ask. Coarse pointers (tablets in the desktop shell) get the viewer.
import { ArrowArcLeft, ArrowArcRight, ArrowLeft, CaretDown, ChartBar, Table, ChatCircleText, DownloadSimple, Image as ImageIcon, Minus, Play, Plus, Shapes, SlidersHorizontal, TextT } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { download, openDeck as touchDeck, retrySave, setLastSlide, useLibrary, useSaveState } from '../data/library'
import { useActiveModel } from '../data/ai/settings'
import { count } from '../lib/format'
import { back, navigate } from '../lib/router'
import { modKey } from '../lib/shell'
import { Button, IconButton } from '../ui/Button'
import { HtmlMark, PptxMark } from '../ui/FileMarks'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { Segmented } from '../ui/Segmented'
import { Tooltip } from '../ui/Tooltip'
import { Toaster } from '../ui/Toaster'
import { EmptyState } from '../compositions/PageHeader'
import { SyncInline } from '../compositions/SyncStatus'
import { AgentPanel } from '../compositions/AgentPanel'
import { Canvas, clampZoom, currentFit, slidePoint, visibleCentre } from '../editor/Canvas'
import { copySelection, onClipboardEvent, pasteFromMenu } from '../editor/clipboard'
import { FormatPanel } from '../editor/FormatPanel'
import { useHistory } from '../editor/history'
import { insertPicture, insertShape, insertText, pickPicture, SHAPES, type ShapeKind } from '../editor/insert'
import { CHART_TYPES, insertChart } from '../editor/chart'
import { insertTable } from '../editor/table'
import { applyUndo, regionOf, useEditorKeys } from '../editor/keys'
import { duplicateObjects, group, newSlide, removeObjects, reorder, toggleAttr, ungroup } from '../editor/ops'
import { Present } from '../editor/Present'
import { FindBar } from '../editor/FindBar'
import { maybeKeep } from '../editor/versions'
import { copyFormat, hasFormat, pasteFormat } from '../editor/painter'
import { Rail } from '../editor/Rail'
import { getEditor, setEditor, useEditor, type Column } from '../editor/session'
import { TextBar } from '../editor/TextBar'
import { endEdit } from '../editor/textctl'
import s from './DeckPage.module.css'

const COL_KEY = 'ream.editor.column'
const WIDTH_KEY = 'ream.editor.columnWidth'
const coarse = matchMedia('(pointer: coarse)')
const useCoarse = () => useSyncExternalStore((l) => (coarse.addEventListener('change', l), () => coarse.removeEventListener('change', l)), () => coarse.matches)
function useWidth() {
  const [w, setW] = useState(innerWidth)
  useEffect(() => { const on = () => setW(innerWidth); addEventListener('resize', on); return () => removeEventListener('resize', on) }, [])
  return w
}
const read = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* ok */ } }

export function DeckPage({ deckId, slide }: { deckId: string; slide?: number }) {
  const lib = useLibrary()
  const deck = lib.entries[deckId]
  const isDeck = deck?.type === 'deck' && deck.trashedAt === null
  const width = useWidth()
  const viewer = useCoarse()
  const ai = !!useActiveModel()
  const slideId = useEditor((e) => e.slideId)
  const column = useEditor((e) => e.column)
  const presenting = useEditor((e) => e.presenting)
  const save = useSaveState()
  const hist = useHistory(deckId)
  const [colW, setColW] = useState(() => Math.min(520, Math.max(300, Number(read(WIDTH_KEY)) || 340)))
  const [askMounted, setAskMounted] = useState(false)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[]; label: string } | null>(null)
  const [find, setFind] = useState<{ replace: boolean } | null>(null)
  const page = useRef<HTMLDivElement>(null)

  // Open the editor session on this deck.
  useEffect(() => {
    if (!isDeck) return
    const d = deck
    const start = d.slides[Math.min(slide ?? d.lastSlide ?? 0, d.slides.length - 1)]?.id ?? null
    const saved = read(COL_KEY) as Column | 'none' | null
    const col: Column = saved === 'none' ? null : saved === 'ask' || saved === 'format' ? saved : innerWidth >= 1280 ? 'format' : null
    setEditor({ deckId, slideId: start, sel: [], scope: null, editing: null, railSel: start ? [start] : [], railAnchor: start, zoom: 'fit', column: col, locked: [], presenting: false })
    touchDeck(deckId)
    void import('../engine').then((m) => m.warmEngine()) // a deck is open: have the engine ready for export
    return () => { endEdit(); setEditor({ deckId: null, slideId: null, sel: [], editing: null }) }
  }, [deckId]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = isDeck ? deck : null
  const index = d ? Math.max(0, d.slides.findIndex((x) => x.id === slideId)) : 0
  const cur = d?.slides[index]
  // The displayed slide was deleted (here, by undo, or on another device): show its neighbour.
  useEffect(() => { if (d && slideId && !d.slides.some((x) => x.id === slideId)) setEditor({ slideId: d.slides[Math.min(index, d.slides.length - 1)]?.id ?? null, sel: [] }) })
  useEffect(() => { if (d) setLastSlide(d.id, index) }, [d?.id, index]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (column === 'ask') setAskMounted(true) }, [column])
  // Local version history: a copy when the deck opens, then at most every 10 minutes of editing.
  useEffect(() => { if (d) void maybeKeep(d, !keptOnOpen.current); keptOnOpen.current = true }, [d?.slides]) // eslint-disable-line react-hooks/exhaustive-deps
  const keptOnOpen = useRef(false)
  // Leaving with a write in flight: the browser asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { endEdit(); if (save !== 'saved') { e.preventDefault() } }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [save])

  const setColumn = (c: Column) => { setEditor({ column: c }); write(COL_KEY, c ?? 'none') }
  const leave = () => { endEdit(); if (history.length > 1) back(); else navigate({ name: 'home' }) }
  const present = useCallback((fromStart: boolean, withPresenter = false) => { endEdit(); presentFrom.current = fromStart ? 0 : null; setPresenter(withPresenter); setEditor({ presenting: true, sel: getEditor().sel }) }, [])
  const presentFrom = useRef<number | null>(null)
  const [presenter, setPresenter] = useState(false)
  const keyOpts = useMemo(() => ({
    deckId, slides: d?.slides.map((x) => x.id) ?? [],
    onPresent: present,
    onAsk: () => setColumn(getEditor().column === 'ask' ? null : 'ask'),
    onFormat: () => setColumn(getEditor().column === 'format' ? null : 'format'),
    onLeave: leave, onFind: (replace: boolean) => setFind({ replace }), fitZoom: currentFit,
  }), [deckId, d?.slides, present]) // eslint-disable-line react-hooks/exhaustive-deps
  useEditorKeys(keyOpts)

  // Clipboard: the native events, while the stage is focused and no text is being edited.
  useEffect(() => {
    if (!d) return
    const size = d.size ?? { w: 1280, h: 720 }
    const on = (e: ClipboardEvent) => {
      const r = regionOf(document.activeElement)
      if (r !== 'stage' && document.activeElement !== document.body) return
      onClipboardEvent(e, visibleCentre, size)
    }
    for (const t of ['copy', 'cut', 'paste'] as const) document.addEventListener(t, on)
    return () => { for (const t of ['copy', 'cut', 'paste'] as const) document.removeEventListener(t, on) }
  }, [d])

  useEffect(() => {
    const on = (e: Event) => setFind({ replace: (e as CustomEvent<boolean>).detail })
    addEventListener('ream:find', on)
    return () => removeEventListener('ream:find', on)
  }, [])

  // The canvas context menu.
  useEffect(() => {
    const on = (e: Event) => {
      const { x, y } = (e as CustomEvent<{ x: number; y: number }>).detail
      const sel = getEditor().sel
      const size = d?.size ?? { w: 1280, h: 720 }
      const at = () => slidePoint(x, y)
      const items: MenuItem[] = sel.length ? [
        { label: 'Cut', hint: `${modKey}X`, run: () => void copySelection(true) },
        { label: 'Copy', hint: `${modKey}C`, run: () => void copySelection() },
        { label: 'Paste', hint: `${modKey}V`, run: () => void pasteFromMenu(at, size) },
        { label: 'Duplicate', hint: `${modKey}D`, run: () => duplicateObjects(sel) },
        { kind: 'sep' },
        { label: 'Copy formatting', hint: `⇧${modKey}C`, run: copyFormat },
        { label: 'Paste formatting', hint: `⇧${modKey}V`, disabled: !hasFormat(), run: pasteFormat },
        { kind: 'sep' },
        { label: 'Bring to front', hint: `⌥${modKey}]`, run: () => reorder(sel, 'front') },
        { label: 'Bring forward', hint: `${modKey}]`, run: () => reorder(sel, 'forward') },
        { label: 'Send backward', hint: `${modKey}[`, run: () => reorder(sel, 'backward') },
        { label: 'Send to back', hint: `⌥${modKey}[`, run: () => reorder(sel, 'back') },
        { kind: 'sep' },
        ...(sel.length > 1 ? [{ label: 'Group', hint: `${modKey}G`, run: () => group(sel) }] : []),
        { label: 'Ungroup', hint: `⇧${modKey}G`, run: () => ungroup(sel) },
        { label: 'Lock', hint: `⇧${modKey}L`, run: () => toggleAttr(sel, 'data-ream-locked', 'Lock') },
        { kind: 'sep' },
        { label: 'Delete', hint: '⌫', danger: true, run: () => removeObjects(sel) },
      ] : [
        { label: 'Paste', hint: `${modKey}V`, run: () => void pasteFromMenu(at, size) },
        { label: 'New slide', hint: `${modKey}↵`, run: () => newSlide() },
        { label: 'Format slide', run: () => setColumn('format') },
      ]
      setMenu({ anchor: { x, y }, items, label: 'Object' })
    }
    addEventListener('ream:canvas-menu', on)
    return () => removeEventListener('ream:canvas-menu', on)
  }, [d]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!d || !cur) {
    return (
      <div className={s.missing}>
        <EmptyState icon={<ArrowLeft size={24} />} title="This deck isn’t available" body="It may have been moved to Trash or deleted.">
          <Button variant="secondary" onClick={() => navigate({ name: 'home' })}>Back to Recents</Button>
        </EmptyState>
      </div>
    )
  }
  if (d.status !== 'ready') {
    return (
      <div className={s.missing}>
        <EmptyState icon={<ArrowLeft size={24} />} title={d.status === 'importing' ? 'Still importing…' : 'This deck couldn’t be imported'} body={d.status === 'failed' ? d.error ?? '' : 'It opens as soon as it’s ready.'}>
          <Button variant="secondary" onClick={leave}>Back</Button>
        </EmptyState>
      </div>
    )
  }

  const size = d.size ?? { w: 1280, h: 720 }
  const iconOnly = width < 1280
  const overlay = width < 1100
  const compactRail = width < 1100 && !!column
  const showColumn = !viewer && !!column
  const askOn = ai && column === 'ask'

  const insertMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ anchor: { x: r.left, y: r.bottom + 6 }, label: 'Shape', items: SHAPES.map((x) => ({ label: x.label, run: () => insertShape(x.kind, visibleCentre()) })) })
  }
  const tableMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    const sizes: [number, number][] = [[2, 2], [3, 3], [4, 3], [5, 4], [6, 5], [8, 6]]
    setMenu({ anchor: { x: r.left, y: r.bottom + 6 }, label: 'Table', items: sizes.map(([rw, c]) => ({ label: `${c} columns × ${rw} rows`, run: () => insertTable(rw, c, visibleCentre()) })) })
  }
  const chartMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ anchor: { x: r.left, y: r.bottom + 6 }, label: 'Chart', items: CHART_TYPES.map((t) => ({ label: t.label, run: () => insertChart(t.type, visibleCentre()) })) })
  }
  const downloadMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ anchor: { x: r.right, y: r.bottom + 6, align: 'end' }, label: 'Download', items: [
      { label: 'PowerPoint (.pptx)', icon: <PptxMark />, run: () => { endEdit(); download([d.id], 'pptx') } },
      { label: 'HTML', icon: <HtmlMark />, run: () => { endEdit(); download([d.id], 'html') } },
    ] })
  }
  const pic = async (at?: { x: number; y: number }) => { const f = await pickPicture(); if (f) await insertPicture(f, at ?? visibleCentre(), size) }
  const dragInsert = (kind: string) => (e: React.DragEvent) => { e.dataTransfer.setData('application/x-ream-insert', kind); e.dataTransfer.effectAllowed = 'copy' }
  const onDrop = (e: React.DragEvent) => {
    const kind = e.dataTransfer.getData('application/x-ream-insert')
    const at = slidePoint(e.clientX, e.clientY)
    if (kind) {
      e.preventDefault(); e.stopPropagation()
      if (kind === 'text') insertText(at)
      else if (kind === 'picture') void pic(at)
      else if (kind === 'table') insertTable(3, 3, at)
      else if (kind === 'chart') insertChart('column', at)
      else insertShape(kind as ShapeKind, at)
      return
    }
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'))
    if (file) { e.preventDefault(); e.stopPropagation(); void insertPicture(file, at, size) }
  }

  const status = save === 'saving' ? 'Saving…' : save === 'failed' ? null : 'Saved in this browser'

  return (
    <div className={s.page} ref={page} data-presenting={presenting || undefined}>
      <header className={s.header} data-region="header">
        <IconButton label="Back to library" hint={`${modKey}[`} onClick={leave}><ArrowLeft size={16} /></IconButton>
        <div className={s.title}>
          <h1 title={d.name}>{d.name}</h1>
          <span>
            {count(d.slides.length, 'slide')} · {status ?? <button type="button" className={s.notSaved} onClick={retrySave}>Not saved · Retry</button>} <SyncInline />
          </span>
        </div>
        {!viewer && (
          <div className={s.insert} role="toolbar" aria-label="Insert">
            <InsertButton label="Text" hint="Insert a text box" iconOnly={iconOnly} icon={<TextT size={16} />} onClick={() => insertText(visibleCentre())} onDragStart={dragInsert('text')} />
            <InsertButton label="Shape" hint="Insert a shape" iconOnly={iconOnly} icon={<Shapes size={16} />} onClick={insertMenu} onDragStart={dragInsert('rect')} caret />
            <InsertButton label="Picture" hint="Insert a picture" iconOnly={iconOnly} icon={<ImageIcon size={16} />} onClick={() => void pic()} onDragStart={dragInsert('picture')} />
            <InsertButton label="Table" hint="Insert a table" iconOnly={iconOnly || width < 1440} icon={<Table size={16} />} onClick={tableMenu} onDragStart={dragInsert('table')} caret />
            <InsertButton label="Chart" hint="Insert a chart" iconOnly={iconOnly || width < 1440} icon={<ChartBar size={16} />} onClick={chartMenu} onDragStart={dragInsert('chart')} caret />
          </div>
        )}
        {!viewer && width >= 760 && (
          <div className={s.history}>
            <IconButton label={hist.canUndo ? `Undo ${hist.undoLabel?.toLowerCase() ?? ''}`.trim() : 'Undo'} hint={`${modKey}Z`} tone="plain" disabled={!hist.canUndo} onClick={() => applyUndo(d.id, 'undo')}><ArrowArcLeft size={16} /></IconButton>
            <IconButton label={hist.canRedo ? `Redo ${hist.redoLabel?.toLowerCase() ?? ''}`.trim() : 'Redo'} hint={`⇧${modKey}Z`} tone="plain" disabled={!hist.canRedo} onClick={() => applyUndo(d.id, 'redo')}><ArrowArcRight size={16} /></IconButton>
          </div>
        )}
        <div className={s.actions}>
          {width >= 1100 ? <>
            <Tooltip label="Download PowerPoint (.pptx)"><Button variant="ghost" icon={<PptxMark />} onClick={() => { endEdit(); download([d.id], 'pptx') }}>PowerPoint</Button></Tooltip>
            <Tooltip label="Download HTML"><Button variant="ghost" icon={<HtmlMark />} onClick={() => { endEdit(); download([d.id], 'html') }}>HTML</Button></Tooltip>
          </> : <Button variant="ghost" icon={<DownloadSimple size={15} />} trailing={<CaretDown size={11} />} aria-haspopup="menu" onClick={downloadMenu}>Download</Button>}
          {!viewer && (ai
            ? <Segmented<'format' | 'ask'> label="Right column" value={(column ?? '') as 'format' | 'ask'} onChange={(v) => setColumn(column === v ? null : v)}
                options={[{ value: 'format', label: <span className={s.seg}><SlidersHorizontal size={14} />Format</span>, title: 'Format (⌥⌘I)' }, { value: 'ask', label: <span className={s.seg}><ChatCircleText size={14} />Ask</span>, title: `Ask Ream (${modKey}J)` }]} />
            : <Tooltip label="Format" hint="⌥⌘I"><Button variant={column === 'format' ? 'secondary' : 'ghost'} aria-pressed={column === 'format'} icon={<SlidersHorizontal size={15} />} onClick={() => setColumn(column === 'format' ? null : 'format')}>Format</Button></Tooltip>)}
          <span className={s.presentGroup}>
            <Tooltip label="Present from this slide" hint="⇧F5"><Button variant="primary" icon={<Play size={14} weight="fill" />} onClick={() => present(false)}>Present</Button></Tooltip>
            <IconButton label="More ways to present" className={s.presentMore} aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ anchor: { x: r.right, y: r.bottom + 6, align: 'end' }, label: 'Present', items: [
              { label: 'From this slide', hint: '⇧F5', run: () => present(false) },
              { label: 'From the beginning', hint: 'F5', run: () => present(true) },
              { label: 'Presenter view', hint: '⌥F5', run: () => present(false, true) },
            ] }) }}><CaretDown size={12} weight="bold" /></IconButton>
          </span>
        </div>
      </header>
      <div className={s.body} data-column={showColumn || undefined} data-overlay={overlay || undefined} style={{ ['--col' as string]: `${colW}px` }}>
        <Rail deck={d} compact={compactRail} />
        <div className={s.stageWrap} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-ream-insert') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation() } }} onDrop={onDrop}>
          <Canvas deck={d} slide={cur} label={`Slide ${index + 1} of ${d.slides.length}`} readOnly={viewer} />
          <ZoomCluster />
          {find && <FindBar deck={d} replace={find.replace} onClose={() => { setFind(null); document.querySelector<HTMLElement>('[data-region="stage"]')?.focus() }} />}
        </div>
        {showColumn && (
          <div className={s.column}>
            <Splitter width={colW} onWidth={(w) => { setColW(w); write(WIDTH_KEY, String(w)) }} />
            {column === 'format' && <FormatPanel deck={d} slide={cur} index={index} onClose={() => setColumn(null)} />}
            {/* Ask stays mounted once opened, so switching to Format never stops or loses a run. */}
            {askMounted && ai && <div className={s.askHost} hidden={!askOn}><AgentPanel deck={d} slide={index} onClose={() => setColumn(null)} /></div>}
            {column === 'ask' && !ai && <FormatPanel deck={d} slide={cur} index={index} onClose={() => setColumn(null)} />}
          </div>
        )}
      </div>
      <TextBar />
      {presenting && <Present deck={d} presenter={presenter} start={presentFrom.current ?? index} onExit={(i) => { setEditor({ presenting: false, slideId: d.slides[i]?.id ?? cur.id }); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-region="stage"]')?.focus()) }} />}
      <Menu open={!!menu} anchor={menu?.anchor ?? null} items={menu?.items ?? []} label={menu?.label ?? ''} onClose={() => setMenu(null)} />
      <Toaster />
    </div>
  )
}

function InsertButton({ label, hint, icon, iconOnly, onClick, onDragStart, caret }: { label: string; hint: string; icon: React.ReactNode; iconOnly: boolean; onClick: (e: React.MouseEvent) => void; onDragStart: (e: React.DragEvent) => void; caret?: boolean }) {
  return (
    <Tooltip label={iconOnly ? label : hint}>
      <button type="button" className={s.insertBtn} aria-label={label} draggable onDragStart={onDragStart} onClick={onClick} aria-haspopup={caret ? 'menu' : undefined}>
        {icon}{!iconOnly && <span>{label}</span>}{caret && <CaretDown size={10} weight="bold" />}
      </button>
    </Tooltip>
  )
}

function ZoomCluster() {
  const zoom = useEditor((e) => e.zoom)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const z = zoom === 'fit' ? currentFit() : zoom
  const set = (v: number | 'fit') => setEditor({ zoom: v === 'fit' ? 'fit' : clampZoom(v) })
  return (
    <div className={s.zoom} role="group" aria-label="Zoom">
      <IconButton label="Zoom out" hint={`${modKey}−`} size="sm" tone="plain" side="top" onClick={() => set(z / 1.25)}><Minus size={13} /></IconButton>
      <button type="button" className={s.zoomValue} aria-haspopup="menu" aria-label={`Zoom ${Math.round(z * 100)}%`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 8 }) }}>{zoom === 'fit' ? 'Fit' : `${Math.round(z * 100)}%`}</button>
      <IconButton label="Zoom in" hint={`${modKey}=`} size="sm" tone="plain" side="top" onClick={() => set(z * 1.25)}><Plus size={13} /></IconButton>
      <Menu open={!!menu} anchor={menu} label="Zoom" onClose={() => setMenu(null)} items={[
        { label: 'Fit', hint: `${modKey}0`, selected: zoom === 'fit', run: () => set('fit') },
        { label: '50%', selected: zoom === 0.5, run: () => set(0.5) },
        { label: '100%', hint: `${modKey}1`, selected: zoom === 1, run: () => set(1) },
        { label: '200%', selected: zoom === 2, run: () => set(2) },
      ]} />
    </div>
  )
}

/** The column's splitter: drag (or arrow keys) between 300 and 520px. */
function Splitter({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const clamp = (w: number) => Math.round(Math.min(520, Math.max(300, w)))
  return (
    <div role="separator" aria-orientation="vertical" aria-label="Resize column" aria-valuemin={300} aria-valuemax={520} aria-valuenow={width} tabIndex={0} className={s.splitter}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onWidth(clamp(width + 16)); if (e.key === 'ArrowRight') onWidth(clamp(width - 16)) }}
      onPointerDown={(e) => {
        const x0 = e.clientX, w0 = width
        const move = (m: PointerEvent) => onWidth(clamp(w0 + (x0 - m.clientX)))
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
        addEventListener('pointermove', move); addEventListener('pointerup', up)
      }} />
  )
}

