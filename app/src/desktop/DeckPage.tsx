// The deck editor (docs/design/specs/editor.md, v3 layout). Mica header: title with the deck menu, insert
// galleries, undo/redo, honest save status, Ask, Download and Present. Below: the slide rail, then the stage
// column (context bar, canvas, notes drawer), and the Ask column when open. Tablets edit too (touch-sized handles,
// pinch to zoom); phones have their own shell.
import { scoped } from '../data/accounts'
import { ArrowArcLeft, ArrowArcRight, ArrowLeft, CaretDown, ChartBar, Table, ChatCircleText, DownloadSimple, Image as ImageIcon, Minus, Play, Plus, Shapes, TextT } from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { download, openDeck as touchDeck, retrySave, setLastSlide, useLibrary, useSaveState } from '../data/library'
import { useActiveModel } from '../data/ai/settings'
import type { Deck } from '../data/types'
import { count } from '../lib/format'
import { back, navigate } from '../lib/router'
import { commentKey, modKey } from '../lib/shell'
import { Button, IconButton } from '../ui/Button'
import { HtmlMark, PptxMark } from '../ui/FileMarks'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { Popover } from '../ui/Popover'
import { Dialog } from '../ui/Dialog'
import { FlatSections } from '../ui/Inspector'
import { Tooltip } from '../ui/Tooltip'
import { Toaster } from '../ui/Toaster'
import { EmptyState } from '../compositions/PageHeader'
import { SyncInline } from '../compositions/SyncStatus'
import { AgentPanel } from '../compositions/AgentPanel'
import { Canvas, clampZoom, currentFit, slidePoint, visibleCentre } from '../editor/Canvas'
import { copySelection, onClipboardEvent, pasteFromMenu } from '../editor/clipboard'
import { ContextBar } from '../editor/ContextBar'
import { NotesDrawer } from '../editor/NotesDrawer'
import { ChartGallery, ShapesGallery, TableGallery } from '../editor/InsertGallery'
import { PicturePanel } from '../editor/PicturePanel'
import { DesignSection, FLAT, colorsOf, useMissingFonts } from '../editor/Sections'
import { AccessibilitySection, VersionsDialog } from '../editor/Review'
import { useHistory } from '../editor/history'
import { insertPicture, insertShape, insertText, pickPicture, type ShapeKind } from '../editor/insert'
import { insertChart, type ChartType } from '../editor/chart'
import { insertTable } from '../editor/table'
import { applyUndo, regionOf, useEditorKeys } from '../editor/keys'
import { duplicateObjects, group, newSlide, removeObjects, reorder, toggleAttr, ungroup } from '../editor/ops'
import { Present } from '../editor/Present'
import { FindBar } from '../editor/FindBar'
import { maybeKeep } from '../editor/versions'
import { copyFormat, hasFormat, pasteFormat } from '../editor/painter'
import { Rail } from '../editor/Rail'
import { getEditor, setEditor, useEditor, type Column } from '../editor/session'
import { endEdit, formatRuns, list, onTextChange, refocus, textHistory, textState } from '../editor/textctl'
import { startComment } from '../editor/CommentPins'
import { toast } from '../data/toasts'
import s from './DeckPage.module.css'

const kept = new Map<string, { slideId: string | null; sel: string[]; scope: string | null; zoom: number | 'fit' }>()
const COL_KEY = 'ream.editor.column'
const WIDTH_KEY = 'ream.editor.columnWidth'
const RAIL_KEY = 'ream.editor.railWidth'
const ASK = { min: 300, max: 600, start: 360 }, RAIL = { min: 140, max: 360, start: 200 }
/** A remembered width, always within its limits (a bad or zero value can't collapse a panel). */
const widthOf = (k: string, l: { min: number; max: number; start: number }) => { const v = Number(read(k)); return Number.isFinite(v) && v > 0 ? Math.min(l.max, Math.max(l.min, v)) : l.start }
type Gallery = { kind: 'shapes' | 'table' | 'chart' | 'picture'; anchor: HTMLElement }
function useWidth() {
  const [w, setW] = useState(innerWidth)
  useEffect(() => { const on = () => setW(innerWidth); addEventListener('resize', on); return () => removeEventListener('resize', on) }, [])
  return w
}
const read = (k: string) => { try { return localStorage.getItem(scoped(k)) } catch { return null } }
const write = (k: string, v: string) => { try { localStorage.setItem(scoped(k), v) } catch { /* ok */ } }

export function DeckPage({ deckId, slide }: { deckId: string; slide?: number }) {
  const lib = useLibrary()
  const deck = lib.entries[deckId]
  const isDeck = deck?.type === 'deck' && deck.trashedAt === null
  const width = useWidth()
  const ai = !!useActiveModel()
  const slideId = useEditor((e) => e.slideId)
  const column = useEditor((e) => e.column)
  const presenting = useEditor((e) => e.presenting)
  const save = useSaveState()
  const deckHist = useHistory(deckId)
  useEditor((e) => e.editing)
  const th = textHistory()
  const hist = th ? { canUndo: th.canUndo, canRedo: th.canRedo, undoLabel: 'typing', redoLabel: 'typing' } : deckHist
  const [colW, setColW] = useState(() => widthOf(WIDTH_KEY, ASK))
  const [railW, setRailW] = useState(() => widthOf(RAIL_KEY, RAIL))
  const [askMounted, setAskMounted] = useState(false)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[]; label: string } | null>(null)
  const [find, setFind] = useState<{ replace: boolean } | null>(null)
  const [gallery, setGallery] = useState<Gallery | null>(null)
  const [galleryAside, setGalleryAside] = useState(false)
  const [deckDialog, setDeckDialog] = useState<'design' | 'a11y' | 'versions' | null>(null)
  const page = useRef<HTMLDivElement>(null)

  // Open the editor session on this deck.
  useEffect(() => {
    if (!isDeck) return
    const d = deck
    const start = d.slides[Math.min(slide ?? d.lastSlide ?? 0, d.slides.length - 1)]?.id ?? null
    const saved = read(COL_KEY) as Column | 'none' | null
    const col: Column = saved === 'ask' ? 'ask' : null
    // Coming back (a resize across the phone layout, browser zoom): the same slide, selection and zoom.
    const back = kept.get(deckId)
    const slideOk = back && d.slides.some((x) => x.id === back.slideId)
    setEditor({ deckId, slideId: slideOk ? back.slideId : start, sel: slideOk ? back.sel : [], scope: slideOk ? back.scope : null, editing: null, railSel: start ? [slideOk ? back.slideId! : start] : [], railAnchor: start, zoom: back?.zoom ?? 'fit', column: col, locked: [], presenting: false, readOnly: false })
    touchDeck(deckId)
    void import('../engine').then((m) => m.warmEngine()) // a deck is open: have the engine ready for export
    return () => { endEdit(); const st = getEditor(); kept.set(deckId, { slideId: st.slideId, sel: st.sel, scope: st.scope, zoom: st.zoom }); setEditor({ deckId: null, slideId: null, sel: [], editing: null }) }
  }, [deckId]) // eslint-disable-line react-hooks/exhaustive-deps

  const d = isDeck ? deck : null
  const index = d ? Math.max(0, d.slides.findIndex((x) => x.id === slideId)) : 0
  const cur = d?.slides[index]
  // The displayed slide was deleted (here, by undo, or on another device): show its neighbour.
  useEffect(() => { if (d && slideId && !d.slides.some((x) => x.id === slideId)) setEditor({ slideId: d.slides[Math.min(index, d.slides.length - 1)]?.id ?? null, sel: [] }) })
  useEffect(() => { if (d) setLastSlide(d.id, index) }, [d?.id, index]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (column === 'ask') setAskMounted(true) }, [column])
  const [, bump] = useState(0)
  useEffect(() => onTextChange(() => bump((n) => n + 1)), [])
  // Local version history: a copy when the deck opens, then at most every 10 minutes of editing.
  useEffect(() => { if (d) void maybeKeep(d, !keptOnOpen.current); keptOnOpen.current = true }, [d?.slides]) // eslint-disable-line react-hooks/exhaustive-deps
  const keptOnOpen = useRef(false)
  // Leaving with a write in flight: the browser asks first.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { endEdit(); if (save !== 'saved') { e.preventDefault() } }
    addEventListener('beforeunload', warn)
    return () => removeEventListener('beforeunload', warn)
  }, [save])

  const setColumn = (c: Column) => {
    // Closing the column with focus inside it hands focus to the stage, not the page.
    if (!c && document.activeElement?.closest('[data-region="column"]')) requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-region="stage"]')?.focus())
    setEditor({ column: c }); write(COL_KEY, c ?? 'none')
  }
  const leave = () => { endEdit(); if (history.length > 1) back(); else navigate({ name: 'home' }) }
  const present = useCallback((fromStart: boolean, withPresenter = false) => { endEdit(); presentFrom.current = fromStart ? 0 : null; setPresenter(withPresenter); setEditor({ presenting: true, sel: getEditor().sel }) }, [])
  const presentFrom = useRef<number | null>(null)
  const [presenter, setPresenter] = useState(false)
  const keyOpts = useMemo(() => ({
    readOnly: false, deckId, slides: d?.slides.map((x) => x.id) ?? [],
    onPresent: present,
    onAsk: () => setColumn(getEditor().column === 'ask' ? null : 'ask'),
    onFormat: () => dispatchEvent(new Event('ream:focus-bar')),
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

  // The editor is a fixed screen: the page itself never scrolls (something briefly taller, or a scrollIntoView
  // reaching the document, used to leave the whole editor shifted up with empty ground below).
  useEffect(() => {
    const html = document.documentElement
    const was = html.style.overflow
    html.style.overflow = 'hidden'
    const back = () => { if (html.scrollTop || document.body.scrollTop) { html.scrollTop = 0; document.body.scrollTop = 0 } }
    addEventListener('scroll', back, true)
    back()
    return () => { html.style.overflow = was; removeEventListener('scroll', back, true) }
  }, [])

  // While Ask works, the stage follows it to the slide it's changing, unless you've used the editor in the
  // last few seconds (then it stays where you are; the rail shows the change).
  useEffect(() => {
    let last = 0
    const touch = () => { last = Date.now() }
    const on = (e: Event) => {
      const id = (e as CustomEvent<{ slideId: string }>).detail.slideId
      const st = getEditor()
      if (Date.now() - last < 4000 || st.slideId === id || st.editing) return
      setEditor({ slideId: id, railSel: [id], railAnchor: id, sel: [], scope: null })
    }
    addEventListener('pointerdown', touch, true)
    addEventListener('keydown', touch, true)
    addEventListener('ream:ai-edit', on)
    return () => { removeEventListener('pointerdown', touch, true); removeEventListener('keydown', touch, true); removeEventListener('ream:ai-edit', on) }
  }, [])

  useEffect(() => {
    const on = (e: Event) => setFind({ replace: (e as CustomEvent<boolean>).detail })
    addEventListener('ream:find', on)
    return () => removeEventListener('ream:find', on)
  }, [])

  // The canvas context menu.
  useEffect(() => {
    const on = (e: Event) => {
      const { x, y, text } = (e as CustomEvent<{ x: number; y: number; text?: boolean }>).detail
      const sel = getEditor().sel
      if (text) {
        // Editing text: the clipboard and the formatting a right-click should offer (Keynote, PowerPoint).
        const t = textState(null)
        const keepFocus = () => requestAnimationFrame(refocus)
        setMenu({ anchor: { x, y }, label: 'Text', items: [
          { label: 'Cut', hint: `${modKey}X`, run: () => { refocus(); document.execCommand('cut') } },
          { label: 'Copy', hint: `${modKey}C`, run: () => { refocus(); document.execCommand('copy') } },
          { label: 'Paste', hint: `${modKey}V`, run: () => { void navigator.clipboard.readText().then((v) => { refocus(); document.execCommand('insertText', false, v) }).catch(() => toast({ message: `Use ${modKey}V to paste here.` })) } },
          { label: 'Select all', hint: `${modKey}A`, run: () => { refocus(); document.execCommand('selectAll') } },
          { kind: 'sep' },
          { label: 'Bold', hint: `${modKey}B`, selected: !!t?.bold, run: () => { formatRuns({ 'font-weight': t?.bold ? '400' : '700' }, 'Bold'); keepFocus() } },
          { label: 'Italic', hint: `${modKey}I`, selected: !!t?.italic, run: () => { formatRuns({ 'font-style': t?.italic ? 'normal' : 'italic' }, 'Italic'); keepFocus() } },
          { label: 'Underline', hint: `${modKey}U`, selected: !!t?.underline, run: () => { formatRuns({ 'text-decoration-line': t?.underline ? null : 'underline' }, 'Underline'); keepFocus() } },
          { kind: 'sep' },
          { label: 'Bullets', selected: t?.list === 'ul', run: () => { list('ul'); keepFocus() } },
          { label: 'Numbering', selected: t?.list === 'ol', run: () => { list('ol'); keepFocus() } },
          { kind: 'sep' },
          { label: 'Comment', hint: commentKey, run: () => { endEdit(); startComment() } },
          { kind: 'note', text: 'Shift + right-click for spelling suggestions' },
        ] })
        return
      }
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
          <Button variant="secondary" onClick={() => navigate({ name: 'home' })}>Back to Home</Button>
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
  // Ask docks only while the slide keeps at least 560px; otherwise it floats over the stage.
  const overlay = width - railW - colW - 40 < 560
  const compactRail = railW < 150
  const askOn = ai && column === 'ask'

  const openGallery = (kind: Gallery['kind']) => (e: React.MouseEvent<HTMLElement>) => { const a = e.currentTarget; setGallery((g) => (g?.kind === kind ? null : { kind, anchor: a })) }
  const picked = (run: () => void) => { setGallery(null); run() }
  const downloadMenu = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect()
    setMenu({ anchor: { x: r.right, y: r.bottom + 6, align: 'end' }, label: 'Download', items: [
      { label: 'PowerPoint (.pptx)', icon: <PptxMark />, run: () => { endEdit(); download([d.id], 'pptx') } },
      { label: 'Web page (.html)', icon: <HtmlMark />, run: () => { endEdit(); download([d.id], 'html') } },
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
      else if (kind.startsWith('table')) { const [, c, r] = kind.split(':').map(Number); insertTable(r || 3, c || 3, at) }
      else if (kind.startsWith('chart')) insertChart((kind.split(':')[1] ?? 'column') as ChartType, at)
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
          <span className={s.titleRow}>
            <h1 title={d.name}>{d.name}</h1>
            <IconButton label="Deck options" size="sm" tone="plain" aria-haspopup="menu" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ anchor: { x: r.left, y: r.bottom + 6 }, label: 'Deck', items: [
              { label: 'Find and replace', hint: `⇧${modKey}H`, run: () => setFind({ replace: true }) },
              { kind: 'sep' },
              { label: 'Design: fonts, colours, slide size…', run: () => setDeckDialog('design') },
              { label: 'Check accessibility…', run: () => setDeckDialog('a11y') },
              { label: 'Version history…', run: () => setDeckDialog('versions') },
            ] }) }}><CaretDown size={12} weight="bold" /></IconButton>
          </span>
          <span>
            {count(d.slides.length, 'slide')} · {status ?? <><button type="button" className={s.notSaved} onClick={retrySave}>Not saved · Retry</button> · <button type="button" className={s.notSaved} onClick={() => download([d.id], 'pptx')}>Download a copy</button></>} <SyncInline />
          </span>
        </div>
        <div className={s.insert} role="toolbar" aria-label="Insert">
          <InsertButton label="Text" hint="Insert a text box" iconOnly={iconOnly} icon={<TextT size={16} />} onClick={() => insertText(visibleCentre())} onDragStart={dragInsert('text')} />
          <InsertButton label="Shapes" hint="Insert a shape" iconOnly={iconOnly} icon={<Shapes size={16} />} onClick={openGallery('shapes')} onDragStart={dragInsert('rect')} expanded={gallery?.kind === 'shapes'} caret />
          <InsertButton label="Picture" hint="Insert or generate a picture" iconOnly={iconOnly} icon={<ImageIcon size={16} />} onClick={openGallery('picture')} onDragStart={dragInsert('picture')} expanded={gallery?.kind === 'picture'} caret />
          <InsertButton label="Table" hint="Insert a table" iconOnly={iconOnly} icon={<Table size={16} />} onClick={openGallery('table')} onDragStart={dragInsert('table')} expanded={gallery?.kind === 'table'} caret />
          <InsertButton label="Chart" hint="Insert a chart" iconOnly={iconOnly} icon={<ChartBar size={16} />} onClick={openGallery('chart')} onDragStart={dragInsert('chart')} expanded={gallery?.kind === 'chart'} caret />
        </div>
        {width >= 760 && (
          <div className={s.history}>
            <IconButton label={hist.canUndo ? `Undo ${hist.undoLabel?.toLowerCase() ?? ''}`.trim() : 'Undo'} hint={`${modKey}Z`} tone="plain" disabled={!hist.canUndo} onClick={() => applyUndo(d.id, 'undo')}><ArrowArcLeft size={16} /></IconButton>
            <IconButton label={hist.canRedo ? `Redo ${hist.redoLabel?.toLowerCase() ?? ''}`.trim() : 'Redo'} hint={`⇧${modKey}Z`} tone="plain" disabled={!hist.canRedo} onClick={() => applyUndo(d.id, 'redo')}><ArrowArcRight size={16} /></IconButton>
          </div>
        )}
        <div className={s.actions}>
          {ai && <Tooltip label="Ask Ream" hint={`${modKey}J`}><Button variant={column === 'ask' ? 'secondary' : 'ghost'} aria-pressed={column === 'ask'} icon={<ChatCircleText size={15} />} onClick={() => setColumn(column === 'ask' ? null : 'ask')}>Ask</Button></Tooltip>}
          <Button variant="ghost" icon={<DownloadSimple size={15} />} trailing={<CaretDown size={11} />} aria-haspopup="menu" onClick={downloadMenu}>Download</Button>
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
      <div className={s.body} data-overlay={overlay || undefined} style={{ ['--col' as string]: `${colW}px`, ['--rail' as string]: `${railW}px` }}>
        <div className={s.railCol}>
          <Rail deck={d} compact={compactRail} readOnly={false} />
          <Splitter edge="right" label="Resize slides" value={railW} limits={RAIL} onChange={(w) => { setRailW(w); write(RAIL_KEY, String(w)) }} />
        </div>
        <div className={s.stageCol}>
          <ContextBar deck={d} slide={cur} index={index} />
          <div className={s.stageWrap} onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-ream-insert') || e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation() } }} onDrop={onDrop}>
            <Canvas deck={d} slide={cur} label={`Slide ${index + 1} of ${d.slides.length}`} readOnly={false} />
            <ZoomCluster />
            {find && <FindBar deck={d} replace={find.replace} onClose={() => { setFind(null); document.querySelector<HTMLElement>('[data-region="stage"]')?.focus() }} />}
          </div>
          <NotesDrawer slide={cur} />
        </div>
        {/* Ask stays mounted once opened, so closing it never stops or loses a run. */}
        {askMounted && ai && (
          <div className={s.askHost} data-region="column" data-overlay={overlay || undefined} hidden={!askOn}>
            <Splitter edge="left" label="Resize Ask" value={colW} limits={ASK} onChange={(w) => { setColW(w); write(WIDTH_KEY, String(w)) }} />
            <AgentPanel deck={d} slide={index} onClose={() => setColumn(null)} />
          </div>
        )}
      </div>
      {gallery && (
        <Popover anchor={gallery.anchor} label={gallery.kind === 'shapes' ? 'Shapes' : gallery.kind === 'table' ? 'Table' : gallery.kind === 'picture' ? 'Picture' : 'Chart'} width={gallery.kind === 'shapes' ? 268 : gallery.kind === 'table' ? 258 : gallery.kind === 'picture' ? 320 : 248}
          className={galleryAside ? s.aside : undefined} onClose={() => setGallery(null)}>
          {gallery.kind === 'shapes' && <ShapesGallery onPick={(k) => picked(() => insertShape(k, visibleCentre()))} onDrag={(on) => { setGalleryAside(on); if (!on) setGallery(null) }} />}
          {gallery.kind === 'table' && <TableGallery onPick={(r, c) => picked(() => insertTable(r, c, visibleCentre()))} onDrag={(on) => { setGalleryAside(on); if (!on) setGallery(null) }} />}
          {gallery.kind === 'picture' && <PicturePanel onFile={() => picked(() => void pic())} onPicture={(url, name) => picked(() => void fetch(url).then((r) => r.blob()).then((b) => insertPicture(new File([b], `${name || 'Generated picture'}.png`, { type: b.type || 'image/png' }), visibleCentre(), size)))} />}
          {gallery.kind === 'chart' && <ChartGallery onPick={(t) => picked(() => insertChart(t, visibleCentre()))} onDrag={(on) => { setGalleryAside(on); if (!on) setGallery(null) }} />}
        </Popover>
      )}
      {deckDialog === 'design' && <DesignDialog deck={d} onClose={() => setDeckDialog(null)} />}
      {deckDialog === 'a11y' && <Dialog title="Accessibility" width={480} onClose={() => setDeckDialog(null)} actions={<Button variant="secondary" onClick={() => setDeckDialog(null)}>Done</Button>}><FlatSections.Provider value="bare"><AccessibilitySection deck={d} sec={FLAT} /></FlatSections.Provider></Dialog>}
      {deckDialog === 'versions' && <VersionsDialog deck={d} onClose={() => setDeckDialog(null)} />}
      {presenting && <Present deck={d} presenter={presenter} start={presentFrom.current ?? index} onExit={(i) => { setEditor({ presenting: false, slideId: d.slides[i]?.id ?? cur.id }); requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-region="stage"]')?.focus()) }} />}
      <Menu open={!!menu} anchor={menu?.anchor ?? null} items={menu?.items ?? []} label={menu?.label ?? ''} onClose={() => setMenu(null)} />
      <Toaster />
    </div>
  )
}

/** Deck-wide design (the deck menu): replace fonts and colours throughout, slide size, missing fonts. */
function DesignDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const missing = useMissingFonts(deck)
  return (
    <Dialog title="Design" width={480} onClose={onClose} actions={<Button variant="secondary" onClick={onClose}>Done</Button>}>
      <FlatSections.Provider value="bare">
        <DesignSection deck={deck} sec={FLAT} colors={colorsOf(deck)} />
      </FlatSections.Provider>
      {missing.map((f) => <p key={f} className={s.dialogNote}>{f} isn’t available here; showing a similar font. Exports keep {f}.</p>)}
    </Dialog>
  )
}

function InsertButton({ label, hint, icon, iconOnly, onClick, onDragStart, caret, expanded }: { label: string; hint: string; icon: React.ReactNode; iconOnly: boolean; onClick: (e: React.MouseEvent<HTMLElement>) => void; onDragStart: (e: React.DragEvent) => void; caret?: boolean; expanded?: boolean }) {
  return (
    <Tooltip label={iconOnly ? label : hint}>
      <button type="button" className={s.insertBtn} aria-label={label} draggable onDragStart={onDragStart} onClick={onClick} aria-haspopup={caret ? 'dialog' : undefined} aria-expanded={caret ? !!expanded : undefined}>
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

/** A panel's edge: drag it (or arrow keys, 16px a step) to resize within its limits. `edge`: which side of the
 *  panel it sits on (the rail's right edge, Ask's left edge). */
function Splitter({ value, limits, onChange, edge, label }: { value: number; limits: { min: number; max: number }; onChange: (w: number) => void; edge: 'left' | 'right'; label: string }) {
  const clamp = (w: number) => Math.round(Math.min(limits.max, Math.max(limits.min, w)))
  const dir = edge === 'right' ? 1 : -1
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={value} tabIndex={0} className={s.splitter} data-edge={edge}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onChange(clamp(value - 16 * dir)); if (e.key === 'ArrowRight') onChange(clamp(value + 16 * dir)) }}
      onPointerDown={(e) => {
        e.preventDefault()
        const x0 = e.clientX, w0 = value
        const move = (m: PointerEvent) => onChange(clamp(w0 + (m.clientX - x0) * dir))
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up) }
        addEventListener('pointermove', move); addEventListener('pointerup', up)
      }} />
  )
}

