// The editor's commands in ⌘K (spec: "our Search for commands"): every action the editor has, by the
// names PowerPoint users know, available while a deck is open.
import { download } from '../data/library'
import { liveStage, visibleCentre } from './Canvas'
import { applyUndo } from './keys'
import { align, distribute, duplicateObjects, duplicateSlides, deleteSlides, group, newSlide, removeObjects, reorder, toggleAttr, toggleHidden, ungroup } from './ops'
import { insertPicture, insertShape, insertText, pickPicture, SHAPES } from './insert'
import { CHART_TYPES, insertChart } from './chart'
import { insertTable } from './table'
import { getEditor, setEditor } from './session'
import { list } from './textctl'

export type EditorCommand = { id: string; title: string; hint?: string; keywords?: string; run: () => void }

export function editorCommands(): EditorCommand[] {
  const st = getEditor()
  if (!st.deckId) return []
  const sel = st.sel
  const deckId = st.deckId
  const slide = st.slideId
  const size = { w: 1280, h: 720 }
  const out: EditorCommand[] = [
    { id: 'e-text', title: 'Insert text box', keywords: 'add text', run: () => insertText(visibleCentre()) },
    ...SHAPES.map((x) => ({ id: `e-shape-${x.kind}`, title: `Insert ${x.label.toLowerCase()}`, keywords: 'shape add', run: () => insertShape(x.kind, visibleCentre()) })),
    { id: 'e-picture', title: 'Insert picture…', keywords: 'image photo add', run: () => void pickPicture().then((f) => f && insertPicture(f, visibleCentre(), size)) },
    { id: 'e-table', title: 'Insert table', keywords: 'grid', run: () => insertTable(3, 3, visibleCentre()) },
    ...CHART_TYPES.map((t) => ({ id: `e-chart-${t.type}`, title: `Insert ${t.label.toLowerCase()} chart`, keywords: 'graph data', run: () => insertChart(t.type, visibleCentre()) })),
    { id: 'e-new-slide', title: 'New slide', hint: '⌘↵', run: () => newSlide() },
    { id: 'e-blank-slide', title: 'New blank slide', run: () => newSlide('blank') },
    ...(slide ? [
      { id: 'e-dup-slide', title: 'Duplicate slide', run: () => duplicateSlides([slide]) },
      { id: 'e-hide-slide', title: 'Hide or show slide', run: () => toggleHidden([slide]) },
      { id: 'e-del-slide', title: 'Delete slide', run: () => deleteSlides([slide]) },
    ] : []),
    { id: 'e-undo', title: 'Undo', hint: '⌘Z', run: () => applyUndo(deckId, 'undo') },
    { id: 'e-redo', title: 'Redo', hint: '⇧⌘Z', run: () => applyUndo(deckId, 'redo') },
    { id: 'e-present', title: 'Present from this slide', hint: '⇧F5', keywords: 'slideshow play', run: () => setEditor({ presenting: true }) },
    { id: 'e-format', title: 'Show Format', hint: '⌥⌘I', keywords: 'inspector properties', run: () => setEditor({ column: 'format' }) },
    { id: 'e-zoom-fit', title: 'Zoom to fit', hint: '⌘0', run: () => setEditor({ zoom: 'fit' }) },
    { id: 'e-zoom-100', title: 'Zoom to 100%', hint: '⌘1', run: () => setEditor({ zoom: 1 }) },
    { id: 'e-pptx', title: 'Download PowerPoint (.pptx)', keywords: 'export save', run: () => download([deckId], 'pptx') },
    { id: 'e-html', title: 'Download HTML', keywords: 'export save', run: () => download([deckId], 'html') },
  ]
  if (sel.length) {
    out.push(
      { id: 'e-dup', title: 'Duplicate', hint: '⌘D', run: () => duplicateObjects(sel) },
      { id: 'e-del', title: 'Delete', hint: '⌫', run: () => removeObjects(sel) },
      { id: 'e-front', title: 'Bring to front', hint: '⌥⌘]', run: () => reorder(sel, 'front') },
      { id: 'e-forward', title: 'Bring forward', hint: '⌘]', run: () => reorder(sel, 'forward') },
      { id: 'e-backward', title: 'Send backward', hint: '⌘[', run: () => reorder(sel, 'backward') },
      { id: 'e-back', title: 'Send to back', hint: '⌥⌘[', run: () => reorder(sel, 'back') },
      { id: 'e-lock', title: 'Lock or unlock', hint: '⇧⌘L', run: () => toggleAttr(sel, 'data-ream-locked', 'Lock') },
      { id: 'e-bullets', title: 'Bullets', keywords: 'list', run: () => list('ul') },
      { id: 'e-numbering', title: 'Numbering', keywords: 'list numbered', run: () => list('ol') },
      ...(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((a) => ({ id: `e-align-${a}`, title: `Align ${a === 'center' ? 'centre' : a}`, keywords: 'arrange', run: () => align(sel, a, size) })),
    )
    if (sel.length > 1) out.push({ id: 'e-group', title: 'Group', hint: '⌘G', run: () => group(sel) })
    if (sel.length > 2) out.push({ id: 'e-dist-h', title: 'Distribute horizontally', run: () => distribute(sel, 'h') }, { id: 'e-dist-v', title: 'Distribute vertically', run: () => distribute(sel, 'v') })
    out.push({ id: 'e-ungroup', title: 'Ungroup', hint: '⇧⌘G', run: () => ungroup(sel) })
  }
  void liveStage
  return out
}
