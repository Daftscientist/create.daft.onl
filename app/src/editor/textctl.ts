// The live text edit: one object's text host made editable inside the stage's shadow root. Typing
// saves after 600ms idle (and on blur) without adding history; ending the edit records one transaction.
// Formatting has three targets (spec): the selected range, the caret (style for what's typed next),
// or, when no text is being edited, every run of the selected objects.
import { onBeforeSwitch } from '../data/accounts'
import { getLibrary, markUnsaved, onRemoteDeck, updateSlides } from '../data/library'
import { toast } from '../data/toasts'
import type { SlideDoc } from '../data/types'
import { transact } from './history'
import { plainText, cleanForStore, editSlide, find, openDeck, parasOf, removeObjects, runsOf, setBeforeEdit, setParaStyle, setRunStyle, textHost, type Css } from './ops'
import { getEditor, setEditor } from './session'
import { editParas, styleParas, indent, insertStyled, normalizeHost, rangeIn, readParas, renderParas, restoreCaret, saveCaret, styleAt, styleRange, toggleList } from './text'

type Live = {
  id: string
  slideId: string
  el: HTMLElement
  host: HTMLElement
  root: ShadowRoot
  from: SlideDoc[]
  pending: Css | null
  bookmark: ReturnType<typeof saveCaret> | null
  timer: number
  composing: boolean
  dispose: () => void
  /** The edit's own history: typing (grouped by pauses) and formatting, with the caret. */
  hist: { html: string; caret: ReturnType<typeof saveCaret> | null }[]
  pos: number
  histTimer: number
}
let live: Live | null = null
// Any other change commits the edit first (ops.editSlide); the edit stays open on the same object.
setBeforeEdit(() => { if (live && !ending) commitNow() })
let ending = false
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
export const onTextChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const editingLive = () => live
// Switching account mid-edit: the text being typed is saved first.
onBeforeSwitch('commit', () => { if (live) endEdit() })

/** Starts editing an object's text on the live stage. `at`: where the caret goes (client px). */
/** The table cell under a point (or at [row, column], or the first one). */
function cellOf(table: HTMLElement, root: ShadowRoot, at?: { x: number; y: number }, cell?: [number, number]): HTMLElement | null {
  if (cell) return (table.querySelectorAll('tr')[cell[0]]?.children[cell[1]] as HTMLElement | undefined) ?? null
  if (at) for (const e of root.elementsFromPoint(at.x, at.y)) { const td = e.closest('td, th'); if (td && table.contains(td)) return td as HTMLElement }
  return table.querySelector('td, th')
}

export function beginEdit(stage: HTMLElement, id: string, at?: { x: number; y: number }, cell?: [number, number]) {
  if (live?.id === id && !cell && live.el.tagName !== 'TABLE') { if (at) placeCaret(live, at); return }
  endEdit({ keepSession: true })
  const el = stage.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(id)}"]`)
  const deck = openDeck()
  const slideId = getEditor().slideId
  if (!el || !deck || !slideId) return
  const table = el.tagName === 'TABLE'
  let host = table ? cellOf(el, stage.getRootNode() as ShadowRoot, at, cell) : textHost(el)
  if (!host) return
  if (table && !host.querySelector('.domoxml-text, li')) host.insertAdjacentHTML('beforeend', '<div class="domoxml-text" style="white-space:pre-wrap;text-align:left"><span><br></span></div>')
  // An empty shape gets a centred, white first paragraph to type into; plain HTML text is made into paragraphs.
  if (!table && !host.querySelector('.domoxml-text, li') && plainText(host)) normalizeHost(host)
  if (!table && !host.querySelector('.domoxml-text, li')) {
    // A shape without text: give it an empty centred paragraph in the deck's text style.
    host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.justifyContent = 'center'
    host.insertAdjacentHTML('beforeend', `<div class="domoxml-text" style="white-space:pre-wrap;text-align:center"><span style="font-family:Instrument Sans,sans-serif;font-size:18pt;font-weight:400;font-style:normal;color:rgba(255,255,255,1)"><br></span></div>`)
    el.setAttribute('data-ream-empty', '')
  }
  if (!table) host = textHost(el)!
  const root = stage.getRootNode() as ShadowRoot
  host.setAttribute('contenteditable', 'true')
  host.setAttribute('spellcheck', 'true')
  // A labelled, multiline textbox for screen readers; the rest of the stage stays described by the
  // editor's object list.
  host.setAttribute('role', 'textbox')
  host.setAttribute('data-ream-textbox', '')
  host.setAttribute('aria-multiline', 'true')
  stage.removeAttribute('aria-hidden')
  for (const other of stage.querySelectorAll('.domoxml-slide > *')) if (!other.contains(host) && !other.hasAttribute('aria-hidden')) { other.setAttribute('data-ream-muted', ''); other.setAttribute('aria-hidden', 'true') }
  host.setAttribute('data-ream-host', '')
  el.setAttribute('data-ream-editing', '')
  const l: Live = { id, slideId, el, host, root, from: deck.slides, pending: null, bookmark: null, timer: 0, composing: false, dispose: () => {}, hist: [], pos: -1, histTimer: 0 }
  const onInput = () => {
    if (l.composing) return
    clearTimeout(l.histTimer)
    l.histTimer = window.setTimeout(() => record(l), 350)
    if (el.hasAttribute('data-ream-empty') && (host.textContent ?? '').trim()) el.removeAttribute('data-ream-empty')
    grow(l)
    saveSoon(l)
    emit()
  }
  const onBefore = (e: InputEvent) => {
    if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); step(l, e.inputType === 'historyRedo' ? 1 : -1); return }
    if (l.pending && e.inputType === 'insertText' && e.data && !e.isComposing) {
      const r = rangeIn(root)
      if (r) { e.preventDefault(); insertStyled(host, r, e.data, l.pending); l.pending = null; onInput() }
    }
  }
  const onKey = (e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y')) {
      e.preventDefault(); e.stopPropagation()
      step(l, e.key.toLowerCase() === 'y' || e.shiftKey ? 1 : -1)
      return
    }
    if (table && e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !readParas(host).some((p) => p.list)) {
      // Tab moves to the next cell (⇧Tab the previous), as in PowerPoint.
      e.preventDefault(); e.stopPropagation()
      const cells = [...el.querySelectorAll<HTMLElement>('td, th')]
      const next = cells[cells.indexOf(host) + (e.shiftKey ? -1 : 1)]
      if (next) { const tr = next.parentElement!; beginEdit(stage, id, undefined, [[...el.querySelectorAll('tr')].indexOf(tr as HTMLTableRowElement), [...tr.children].indexOf(next)]) }
      return
    }
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      const r = rangeIn(root)
      const inList = readParas(host).some((p) => p.list)
      if (inList) { e.preventDefault(); e.stopPropagation(); record(l); indent(host, r, e.shiftKey ? -1 : 1); onInput(); record(l) }
    }
  }
  const onPaste = (e: ClipboardEvent) => {
    // Pasted text takes the caret's styling; rich content keeps its paragraph breaks only.
    const text = e.clipboardData?.getData('text/plain')
    if (text === undefined) return
    e.preventDefault()
    e.stopPropagation()
    document.execCommand('insertText', false, text)
  }
  const onComp = (e: CompositionEvent) => { l.composing = e.type === 'compositionstart'; if (!l.composing) onInput() }
  const onBlur = () => { const r = rangeIn(root); if (r && host.contains(r.startContainer)) l.bookmark = saveCaret(host, r); save(l) }
  const onSel = () => { if (live === l) emit() }
  host.addEventListener('input', onInput)
  host.addEventListener('beforeinput', onBefore as EventListener)
  host.addEventListener('keydown', onKey)
  host.addEventListener('paste', onPaste)
  host.addEventListener('compositionstart', onComp as EventListener)
  host.addEventListener('compositionend', onComp as EventListener)
  host.addEventListener('blur', onBlur)
  document.addEventListener('selectionchange', onSel)
  l.dispose = () => {
    host.removeEventListener('input', onInput)
    host.removeEventListener('beforeinput', onBefore as EventListener)
    host.removeEventListener('keydown', onKey)
    host.removeEventListener('paste', onPaste)
    host.removeEventListener('compositionstart', onComp as EventListener)
    host.removeEventListener('compositionend', onComp as EventListener)
    host.removeEventListener('blur', onBlur)
    document.removeEventListener('selectionchange', onSel)
  }
  live = l
  host.focus({ preventScroll: true })
  placeCaret(l, at)
  record(l)
  emit()
}

function record(l: Live) {
  clearTimeout(l.histTimer)
  const r = rangeIn(l.root)
  const s = { html: l.host.innerHTML, caret: r && l.host.contains(r.startContainer) ? saveCaret(l.host, r) : null }
  if (l.hist[l.pos]?.html === s.html) { l.hist[l.pos] = s; return }
  l.hist = l.hist.slice(0, l.pos + 1)
  l.hist.push(s)
  if (l.hist.length > 200) l.hist.shift()
  l.pos = l.hist.length - 1
}

/** Undo (-1) or redo (+1) inside the edit. Past its start, ⌘Z ends the edit and undoes in the deck. */
function step(l: Live, by: 1 | -1) {
  record(l) // whatever was typed since the last pause is a step of its own
  const i = l.pos + by
  if (i < 0 || i >= l.hist.length) return
  l.pos = i
  const s = l.hist[i]
  l.host.innerHTML = s.html
  if (s.caret) restoreCaret(l.host, s.caret)
  grow(l)
  saveSoon(l)
  emit()
}
/** The edit's own undo/redo, for the header buttons (the same steps as ⌘Z inside the text). */
export function textHistory(): { canUndo: boolean; canRedo: boolean } | null {
  const l = live
  if (!l) return null
  return { canUndo: l.pos > 0 || l.host.innerHTML !== l.hist[l.pos]?.html, canRedo: l.pos < l.hist.length - 1 }
}
export function textUndo(by: 1 | -1) { if (live) step(live, by) }

/** Formatting is a step in the edit's history too. */
const formatted = (l: Live) => { record(l); grow(l); saveSoon(l); emit() }

type CaretDoc = Document & { caretPositionFromPoint?: (x: number, y: number, o?: { shadowRoots: ShadowRoot[] }) => { offsetNode: Node; offset: number } | null; caretRangeFromPoint?: (x: number, y: number) => Range | null }
function placeCaret(l: Live, at?: { x: number; y: number }) {
  const d = document as CaretDoc
  let node: Node | null = null, offset = 0
  if (at) {
    const p = d.caretPositionFromPoint?.(at.x, at.y, { shadowRoots: [l.root] })
    if (p) { node = p.offsetNode; offset = p.offset }
    else { const r = d.caretRangeFromPoint?.(at.x, at.y); if (r) { node = r.startContainer; offset = r.startOffset } }
  }
  if (!node || !l.host.contains(node)) {
    // No point (Enter, a new box): the whole text is selected for an empty box, else the caret goes to the end.
    const r = document.createRange()
    // An empty box: the caret goes inside its styled empty run, so typing takes that style.
    const emptyRun = l.el.hasAttribute('data-ream-empty') ? l.host.querySelector('span') : null
    if (emptyRun) { r.setStart(emptyRun, 0); r.collapse(true) }
    else { r.selectNodeContents(l.host); r.collapse(false) }
    document.getSelection()?.removeAllRanges()
    document.getSelection()?.addRange(r)
    return
  }
  document.getSelection()?.setBaseAndExtent(node, offset, node, offset)
}

/** Boxes inserted in Ream grow with their text (PowerPoint's "resize shape to fit text"). */
function grow(l: Live) {
  const h = fitHeight(l.el)
  if (h) l.el.style.height = `${h}px`
}
/** The height an auto-growing box needs for its text, or null for boxes that keep their size. */
export function fitHeight(el: HTMLElement): number | null {
  if (!el.hasAttribute('data-ream-autogrow')) return null
  const host = textHost(el) ?? el
  const cs = getComputedStyle(el)
  const h = Math.ceil([...host.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight + parseFloat(getComputedStyle(c).marginTop) + parseFloat(getComputedStyle(c).marginBottom), 0) + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom))
  return h > 0 ? h : null
}

function saveSoon(l: Live) {
  markUnsaved(true)
  clearTimeout(l.timer)
  l.timer = window.setTimeout(() => save(l), 600)
}

/** The object as it stands, normalized for storage (the live DOM itself is left alone). */
function snapshot(l: Live): HTMLElement {
  const clone = l.el.cloneNode(true) as HTMLElement
  cleanForStore(clone)
  const host = clone.matches('[data-ream-host]') ? clone : clone.querySelector<HTMLElement>('[data-ream-host]')
  if (host) {
    host.removeAttribute('data-ream-host')
    if (normalizeHost(host)) clone.removeAttribute('data-ream-empty')
    else clone.setAttribute('data-ream-empty', '')
  }
  return clone
}

function replaceIn(l: Live, slides: SlideDoc[]): SlideDoc[] | null {
  const i = slides.findIndex((s) => s.id === l.slideId)
  if (i < 0) return null
  const doc = new DOMParser().parseFromString(`<body>${slides[i].html}</body>`, 'text/html')
  const root = doc.body.querySelector('.domoxml-slide') ?? doc.body
  const el = find(root, l.id)
  if (!el) return null
  el.replaceWith(doc.importNode(snapshot(l), true))
  const html = root.outerHTML
  if (html === slides[i].html) return null
  const next = slides.slice()
  next[i] = { ...slides[i], html }
  return next
}

/** Saves the text so far (no history: ending the edit records it once). */
function save(l: Live) {
  clearTimeout(l.timer)
  if (l.composing) return
  markUnsaved(false)
  const deck = openDeck()
  if (!deck) return
  const next = replaceIn(l, deck.slides)
  if (next) updateSlides(deck.id, next)
}

/** Ends the edit: one transaction for everything typed. A box made in Ream and left empty goes. */
/** Commits the text so far as one transaction (the edit continues with a fresh starting point), then
 *  ends the edit: the next change re-renders the object from the store, which now holds its text. */
function commitNow() {
  const l = live
  if (!l) return
  const id = l.id
  endEdit()
  setEditor({ sel: [id] })
}

// A change from another device to the slide being typed on: the edit wins (local wins), and once it
// ends a notice offers their version of the slide instead.
let theirs: { deckId: string; slideId: string; slide: SlideDoc } | null = null
onRemoteDeck((deckId) => {
  const l = live
  if (!l) return
  const d = getLibrary().entries[deckId]
  const slide = d?.type === 'deck' ? d.slides.find((s) => s.id === l.slideId) : undefined
  if (slide && openDeck()?.id === deckId) theirs = { deckId, slideId: l.slideId, slide }
})

export function endEdit(opts: { keepSession?: boolean } = {}) {
  const l = live
  if (!l) return
  live = null
  ending = true
  clearTimeout(l.timer)
  markUnsaved(false)
  l.dispose()
  const deck = openDeck()
  if (deck) {
    const next = replaceIn(l, deck.slides) ?? deck.slides
    if (next !== l.from) {
      const sel = { slide: l.slideId, ids: [l.id] }
      transact(deck.id, next, { label: 'Edit text', from: l.from, selBefore: sel, selAfter: sel })
    }
  }
  l.host.removeAttribute('contenteditable')
  l.host.removeAttribute('spellcheck')
  if (l.host.hasAttribute('data-ream-textbox')) { l.host.removeAttribute('role'); l.host.removeAttribute('data-ream-textbox'); l.host.removeAttribute('aria-multiline') }
  const stageEl = l.root.querySelector('.stage')
  stageEl?.setAttribute('aria-hidden', 'true')
  for (const m of l.root.querySelectorAll('[data-ream-muted]')) { m.removeAttribute('data-ream-muted'); m.removeAttribute('aria-hidden') }
  l.host.removeAttribute('data-ream-host')
  l.el.removeAttribute('data-ream-editing')
  document.getSelection()?.removeAllRanges()
  if (!opts.keepSession && getEditor().editing === l.id) setEditor({ editing: null })
  const empty = (l.host.textContent ?? '').trim() === ''
  ending = false
  if (theirs && theirs.slideId === l.slideId) {
    const t = theirs
    theirs = null
    toast({ message: 'This slide also changed on another device. Your edit was kept.', duration: 12000, action: { label: 'Use theirs', run: () => {
      const d = getLibrary().entries[t.deckId]
      if (d?.type !== 'deck') return
      transact(t.deckId, d.slides.map((s) => (s.id === t.slideId ? t.slide : s)), { label: 'Use the other device’s version' })
    } } })
  }
  if (empty && l.el.hasAttribute('data-ream-autogrow') && !l.el.hasAttribute('data-ream-placeholder')) removeObjects([l.id], 'Delete empty text box')
  emit()
}

/** Returns focus to the text being edited, at the caret or range it had (text bar fields and popovers). */
export function refocus() {
  const l = live
  if (!l) return
  l.host.focus({ preventScroll: true })
  if (l.bookmark) restoreCaret(l.host, l.bookmark)
}

// ---------- formatting ----------

function liveRange(l: Live): Range | null {
  const r = rangeIn(l.root)
  if (r && l.host.contains(r.commonAncestorContainer)) return r
  if (l.bookmark) { l.host.focus({ preventScroll: true }); restoreCaret(l.host, l.bookmark); return rangeIn(l.root) }
  return null
}

/** Run formatting (bold, size, colour, font…) on whatever the current target is. */
export function formatRuns(css: Css, label = 'Format text') {
  const l = live
  if (l) {
    const r = liveRange(l)
    if (!r || r.collapsed) { l.pending = { ...l.pending, ...css }; emit(); return }
    record(l)
    styleRange(l.host, r, css)
    formatted(l)
    return
  }
  setRunStyle(getEditor().sel, css, label)
}

export function formatParas(css: Css) {
  const l = live
  if (l) {
    record(l)
    styleParas(l.host, liveRange(l), css)
    formatted(l)
    return
  }
  setParaStyle(getEditor().sel, css, css['text-align'] ? 'Align text' : 'Paragraph spacing')
}

export function list(kind: 'ul' | 'ol') {
  const l = live
  if (l) { record(l); toggleList(l.host, liveRange(l), kind); formatted(l); return }
  editSlide(kind === 'ul' ? 'Bullets' : 'Numbering', (root) => {
    for (const id of getEditor().sel) {
      const el = find(root, id)
      const host = el && textHost(el)
      if (!host || !host.querySelector('.domoxml-text, li')) continue
      toggleList(host, null, kind)
      if (host === el) { if (host.querySelector('ul, ol')) el.removeAttribute('data-domoxml-text-body'); else el.setAttribute('data-domoxml-text-body', 'true') }
    }
  })
}

export function shiftIndent(by: 1 | -1) {
  const l = live
  if (l) { record(l); indent(l.host, liveRange(l), by); formatted(l); return }
  editSlide('Indent', (root) => {
    for (const id of getEditor().sel) { const host = find(root, id) && textHost(find(root, id)!); if (host) editParas(host, null, (p) => (p.list ? { ...p, level: Math.max(0, Math.min(8, p.level + by)) } : p)) }
  })
}

/** What the text controls show: the style at the caret (editing) or of the first run (object). */
export type TextState = { family: string; sizePt: number; bold: boolean; italic: boolean; underline: boolean; color: string; align: string; list: 'ul' | 'ol' | null; lineHeight: number; before: number; after: number; mixed: Set<string> }
export function textState(stage: HTMLElement | null): TextState | null {
  const l = live
  let node: Element | null = null
  let para: Element | null = null
  if (l) {
    const r = rangeIn(l.root)
    const at = r && l.host.contains(r.startContainer) ? r.startContainer : l.host.querySelector('span')
    node = at ? (at.nodeType === 3 ? at.parentElement : (at as Element)) : null
    if (node && node.tagName !== 'SPAN') node = node.querySelector('span') ?? node
    para = node?.closest('.domoxml-text, li') ?? null
  } else if (stage) {
    // The first selected object that has text (a picture or empty shape in the selection doesn't count).
    const el = getEditor().sel.map((id) => find(stage, id)).find((e): e is HTMLElement => !!e && (runsOf(e).length > 0 || plainText(e))) ?? null
    if (!el) return null
    // Plain HTML text (not yet in paragraphs): its own style is the text's style.
    node = runsOf(el)[0] ?? el
    para = parasOf(el)[0] ?? el
  }
  const cs = styleAt(node)
  if (!cs || !node) return null
  const p = l?.pending ?? {}
  const pt = (px: string) => Math.round((parseFloat(px) * 0.75) * 10) / 10
  return {
    family: (p['font-family'] ?? cs.fontFamily).split(',')[0].replace(/["']/g, '').trim(),
    sizePt: p['font-size'] ? parseFloat(p['font-size']) : pt(cs.fontSize),
    bold: p['font-weight'] ? parseInt(p['font-weight']) >= 600 : parseInt(cs.fontWeight) >= 600,
    italic: p['font-style'] ? p['font-style'] === 'italic' : cs.fontStyle === 'italic',
    underline: p['text-decoration-line'] !== undefined ? p['text-decoration-line'] === 'underline' : cs.textDecorationLine.includes('underline'),
    color: p.color ?? cs.color,
    align: para ? getComputedStyle(para).textAlign.replace('start', 'left').replace('end', 'right') : 'left',
    list: para?.tagName === 'LI' ? (para.parentElement?.tagName === 'OL' ? 'ol' : 'ul') : null,
    // Line spacing as PowerPoint's multiple of single spacing (domOXML writes 1.2 × the multiple).
    lineHeight: (() => { const lh = (para as HTMLElement | null)?.style.lineHeight; const v = lh ? parseFloat(lh) : NaN; return Number.isFinite(v) && !/px|pt/.test(lh!) ? Math.round((v / 1.2) * 100) / 100 : 1 })(),
    before: para ? Math.round(parseFloat(getComputedStyle(para).marginTop) * 0.75 * 10) / 10 : 0,
    after: para ? Math.round(parseFloat(getComputedStyle(para).marginBottom) * 0.75 * 10) / 10 : 0,
    mixed: l || !stage ? new Set() : mixedAcross(stage),
  }
}

/** Which text properties differ across every run of the selected objects (shown as "Mixed"). */
function mixedAcross(stage: HTMLElement): Set<string> {
  const out = new Set<string>()
  const seen: Record<string, Set<string>> = { family: new Set(), size: new Set(), bold: new Set(), italic: new Set(), underline: new Set(), color: new Set(), align: new Set() }
  for (const id of getEditor().sel) {
    const el = find(stage, id)
    if (!el) continue
    for (const r of runsOf(el).slice(0, 200)) {
      const cs = getComputedStyle(r)
      seen.family.add(cs.fontFamily.split(',')[0].replace(/["']/g, '').trim())
      seen.size.add(cs.fontSize)
      seen.bold.add(String(parseInt(cs.fontWeight) >= 600))
      seen.italic.add(cs.fontStyle)
      seen.underline.add(String(cs.textDecorationLine.includes('underline')))
      seen.color.add(cs.color)
    }
    for (const p of parasOf(el)) seen.align.add(getComputedStyle(p).textAlign)
  }
  for (const [k, v] of Object.entries(seen)) if (v.size > 1) out.add(k)
  return out
}

/** Plain-HTML helpers for ops that build text (new text boxes). */
export const paragraphsHtml = renderParas
export const libraryNow = getLibrary
