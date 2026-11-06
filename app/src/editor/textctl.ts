// The live text edit: one object's text host made editable inside the stage's shadow root. Typing
// saves after 600ms idle (and on blur) without adding history; ending the edit records one transaction.
// Formatting has three targets (spec): the selected range, the caret (style for what's typed next),
// or, when no text is being edited, every run of the selected objects.
import { getLibrary, updateSlides } from '../data/library'
import type { SlideDoc } from '../data/types'
import { transact } from './history'
import { cleanForStore, editSlide, find, openDeck, parasOf, removeObjects, runsOf, setParaStyle, setRunStyle, textHost, type Css } from './ops'
import { getEditor, setEditor } from './session'
import { alignParas, editParas, indent, insertStyled, normalizeHost, rangeIn, readParas, renderParas, restoreCaret, saveCaret, styleAt, styleRange, toggleList } from './text'

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
}
let live: Live | null = null
const listeners = new Set<() => void>()
const emit = () => { for (const l of listeners) l() }
export const onTextChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
export const editingLive = () => live

/** Starts editing an object's text on the live stage. `at`: where the caret goes (client px). */
export function beginEdit(stage: HTMLElement, id: string, at?: { x: number; y: number }) {
  if (live?.id === id) { if (at) placeCaret(live, at); return }
  endEdit({ keepSession: true })
  const el = stage.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(id)}"]`)
  const deck = openDeck()
  const slideId = getEditor().slideId
  if (!el || !deck || !slideId) return
  let host = textHost(el)
  if (!host) return
  if (!host.querySelector('.domoxml-text, li')) {
    // A shape without text: give it an empty centred paragraph in the deck's text style.
    host.style.display = 'flex'; host.style.flexDirection = 'column'; host.style.justifyContent = 'center'
    host.insertAdjacentHTML('beforeend', `<div class="domoxml-text" style="white-space:pre-wrap;text-align:center"><span style="font-family:Instrument Sans,sans-serif;font-size:18pt;font-weight:400;font-style:normal;color:rgba(255,255,255,1)"><br></span></div>`)
    el.setAttribute('data-ream-empty', '')
  }
  host = textHost(el)!
  const root = stage.getRootNode() as ShadowRoot
  host.setAttribute('contenteditable', 'true')
  host.setAttribute('spellcheck', 'true')
  host.setAttribute('data-ream-host', '')
  el.setAttribute('data-ream-editing', '')
  const l: Live = { id, slideId, el, host, root, from: deck.slides, pending: null, bookmark: null, timer: 0, composing: false, dispose: () => {} }
  const onInput = () => {
    if (l.composing) return
    if (el.hasAttribute('data-ream-empty') && (host.textContent ?? '').trim()) el.removeAttribute('data-ream-empty')
    grow(l)
    saveSoon(l)
    emit()
  }
  const onBefore = (e: InputEvent) => {
    if (l.pending && e.inputType === 'insertText' && e.data && !e.isComposing) {
      const r = rangeIn(root)
      if (r) { e.preventDefault(); insertStyled(host, r, e.data, l.pending); l.pending = null; onInput() }
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey) {
      const r = rangeIn(root)
      const inList = readParas(host).some((p) => p.list)
      if (inList) { e.preventDefault(); e.stopPropagation(); indent(host, r, e.shiftKey ? -1 : 1); onInput() }
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
  emit()
}

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
  if (!l.el.hasAttribute('data-ream-autogrow')) return
  const pad = parseFloat(getComputedStyle(l.el).paddingTop) + parseFloat(getComputedStyle(l.el).paddingBottom)
  const h = Math.ceil([...l.host.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0) + pad)
  if (h > 0) l.el.style.height = `${h}px`
}

function saveSoon(l: Live) {
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
  const deck = openDeck()
  if (!deck) return
  const next = replaceIn(l, deck.slides)
  if (next) updateSlides(deck.id, next)
}

/** Ends the edit: one transaction for everything typed. A box made in Ream and left empty goes. */
export function endEdit(opts: { keepSession?: boolean } = {}) {
  const l = live
  if (!l) return
  live = null
  clearTimeout(l.timer)
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
  l.host.removeAttribute('data-ream-host')
  l.el.removeAttribute('data-ream-editing')
  document.getSelection()?.removeAllRanges()
  if (!opts.keepSession && getEditor().editing === l.id) setEditor({ editing: null })
  const empty = (l.host.textContent ?? '').trim() === ''
  if (empty && l.el.hasAttribute('data-ream-autogrow') && !l.el.hasAttribute('data-ream-placeholder')) removeObjects([l.id], 'Delete empty text box')
  emit()
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
    styleRange(l.host, r, css)
    saveSoon(l)
    emit()
    return
  }
  setRunStyle(getEditor().sel, css, label)
}

export function formatParas(css: Css) {
  const l = live
  if (l) {
    const r = liveRange(l)
    if (css['text-align']) alignParas(l.host, r, css['text-align'])
    saveSoon(l)
    emit()
    return
  }
  setParaStyle(getEditor().sel, css, 'Align text')
}

export function list(kind: 'ul' | 'ol') {
  const l = live
  if (l) { toggleList(l.host, liveRange(l), kind); saveSoon(l); emit(); return }
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
  if (l) { indent(l.host, liveRange(l), by); saveSoon(l); emit(); return }
  editSlide('Indent', (root) => {
    for (const id of getEditor().sel) { const host = find(root, id) && textHost(find(root, id)!); if (host) editParas(host, null, (p) => (p.list ? { ...p, level: Math.max(0, Math.min(8, p.level + by)) } : p)) }
  })
}

/** What the text controls show: the style at the caret (editing) or of the first run (object). */
export type TextState = { family: string; sizePt: number; bold: boolean; italic: boolean; underline: boolean; color: string; align: string; list: 'ul' | 'ol' | null }
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
    const id = getEditor().sel[0]
    const el = id ? find(stage, id) : null
    if (!el) return null
    node = runsOf(el)[0] ?? null
    para = parasOf(el)[0] ?? null
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
  }
}

/** Plain-HTML helpers for ops that build text (new text boxes). */
export const paragraphsHtml = renderParas
export const libraryNow = getLibrary
