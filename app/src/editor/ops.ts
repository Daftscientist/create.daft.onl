// Editor operations: the only way the editor changes a deck (spec contract 1). Each one parses the
// slide's stored HTML, changes it by object id, and records one transaction (history.ts). Live
// gestures preview on the stage's DOM and land here once, at gesture end.
import { getLibrary } from '../data/library'
import type { Deck, SlideDoc } from '../data/types'
import { fontStack } from '../slides/fonts'
import { boxOf, groupPayload, isGroup, members, setBox, unionBox, type Box } from './geometry'
import { transact } from './history'
import { parseSlide, topNodes } from './irdiff'
import { getEditor, setEditor } from './session'

export const newId = (p = 'ream') => `${p}-${Math.random().toString(36).slice(2, 10)}`

export function openDeck(): Deck | undefined {
  const { deckId } = getEditor()
  const d = deckId ? getLibrary().entries[deckId] : undefined
  return d?.type === 'deck' ? d : undefined
}
export function currentSlide(): { deck: Deck; slide: SlideDoc; index: number } | undefined {
  const deck = openDeck()
  if (!deck) return
  const id = getEditor().slideId
  const index = Math.max(0, deck.slides.findIndex((s) => s.id === id))
  return deck.slides[index] ? { deck, slide: deck.slides[index], index } : undefined
}

/** Finds an object by id anywhere on the slide (members of groups too). */
export const find = (root: Element, id: string) => root.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(id)}"]`)

/** Editor-only attributes never reach the stored HTML. */
const EDITOR_ATTRS = ['contenteditable', 'spellcheck', 'data-ream-editing', 'aria-multiline', 'data-ream-textbox']
export function cleanForStore(el: Element) {
  // Accessibility state set only while editing (textctl) comes off with its markers.
  for (const x of [el, ...el.querySelectorAll('[data-ream-textbox], [data-ream-muted]')]) {
    if (x.hasAttribute('data-ream-textbox')) x.removeAttribute('role')
    if (x.hasAttribute('data-ream-muted')) { x.removeAttribute('aria-hidden'); x.removeAttribute('data-ream-muted') }
  }
  for (const a of EDITOR_ATTRS) { el.removeAttribute(a); for (const x of el.querySelectorAll(`[${a}]`)) x.removeAttribute(a) }
}

type Mutate = (root: HTMLElement) => void | false

/** Set by the text editor: commits a live text edit before any other change, so a property change
 *  (fill, geometry, alignment) never races the edit's next save of the same object. */
let beforeEdit: (() => void) | null = null
export const setBeforeEdit = (fn: () => void) => { beforeEdit = fn }

/** Changes one slide as one transaction. `sel`: the selection afterwards (default: unchanged). */
export function editSlide(label: string, mutate: Mutate, opts: { slideId?: string; sel?: string[] } = {}): boolean {
  if (getEditor().readOnly) return false
  beforeEdit?.()
  const deck = openDeck()
  if (!deck) return false
  const slideId = opts.slideId ?? getEditor().slideId
  const i = deck.slides.findIndex((s) => s.id === slideId)
  if (i < 0 || getEditor().locked.includes(slideId!)) return false
  const root = parseSlide(deck.slides[i].html)
  if (mutate(root) === false) return false
  cleanForStore(root)
  const html = root.outerHTML
  if (html === deck.slides[i].html) return false
  const slides = deck.slides.slice()
  slides[i] = { ...slides[i], html }
  const { sel } = getEditor()
  transact(deck.id, slides, { label, selBefore: { slide: slideId!, ids: sel }, selAfter: { slide: slideId!, ids: opts.sel ?? sel } })
  if (opts.sel) setEditor({ sel: opts.sel, editing: null })
  return true
}

/** Changes the deck's slide list as one transaction (new, duplicate, delete, reorder, background). */
export function editSlides(label: string, fn: (slides: SlideDoc[]) => SlideDoc[] | false, after?: { slideId?: string; railSel?: string[] }) {
  if (getEditor().readOnly) return
  beforeEdit?.()
  const deck = openDeck()
  if (!deck) return
  const next = fn(deck.slides.slice())
  if (!next) return
  const { slideId, sel } = getEditor()
  transact(deck.id, next, { label, selBefore: { slide: slideId!, ids: sel }, selAfter: { slide: after?.slideId ?? slideId!, ids: [] } })
  if (after) setEditor({ slideId: after.slideId ?? slideId, railSel: after.railSel ?? [after.slideId ?? slideId!], railAnchor: after.slideId ?? slideId, sel: [], editing: null, scope: null })
}

// ---------- geometry ----------

export function setBoxes(boxes: Map<string, Box>, label = 'Move') {
  editSlide(label, (root) => { for (const [id, b] of boxes) { const el = find(root, id); if (el) setBox(el, b) } })
}

export function nudge(ids: string[], dx: number, dy: number) {
  editSlide('Nudge', (root) => {
    for (const id of ids) { const el = find(root, id); if (!el || el.hasAttribute('data-ream-locked')) continue; const b = boxOf(el); setBox(el, { ...b, x: b.x + dx, y: b.y + dy }) }
  })
}

export type Align = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
/** Aligns objects to each other, or to the slide when one object is selected (PowerPoint's rule). */
export function align(ids: string[], how: Align, size: { w: number; h: number }) {
  editSlide('Align', (root) => {
    const els = ids.map((id) => find(root, id)).filter((e): e is HTMLElement => !!e)
    const ref: Box = els.length > 1 ? unionBox(els.map(boxOf)) : { x: 0, y: 0, w: size.w, h: size.h, rot: 0 }
    for (const el of els) {
      const b = boxOf(el)
      const x = how === 'left' ? ref.x : how === 'center' ? ref.x + (ref.w - b.w) / 2 : how === 'right' ? ref.x + ref.w - b.w : b.x
      const y = how === 'top' ? ref.y : how === 'middle' ? ref.y + (ref.h - b.h) / 2 : how === 'bottom' ? ref.y + ref.h - b.h : b.y
      setBox(el, { ...b, x, y })
    }
  })
}

export function distribute(ids: string[], axis: 'h' | 'v') {
  editSlide('Distribute', (root) => {
    const els = ids.map((id) => find(root, id)).filter((e): e is HTMLElement => !!e)
    if (els.length < 3) return false
    const items = els.map((el) => ({ el, b: boxOf(el) })).sort((a, b) => (axis === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y))
    const first = items[0].b, last = items[items.length - 1].b
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y
    const total = items.reduce((n, i) => n + (axis === 'h' ? i.b.w : i.b.h), 0)
    const gap = (span - total) / (items.length - 1)
    let at = axis === 'h' ? first.x : first.y
    for (const { el, b } of items) {
      setBox(el, axis === 'h' ? { ...b, x: at } : { ...b, y: at })
      at += (axis === 'h' ? b.w : b.h) + gap
    }
  })
}

// ---------- style ----------

export type Css = Record<string, string | null>
const setCss = (el: HTMLElement, css: Css) => { for (const [k, v] of Object.entries(css)) { if (v === null || v === '') el.style.removeProperty(k); else el.style.setProperty(k, v) } }

/** Shape styles (fill, border, radius, opacity, shadow). An SVG shape takes its fill and stroke on its paths. */
export function setObjectStyle(ids: string[], css: Css, label = 'Format') {
  editSlide(label, (root) => {
    for (const id of ids) {
      const el = find(root, id)
      if (!el) continue
      for (const target of isGroup(el) ? members(el) : [el]) styleObject(target, css)
    }
  })
}
function styleObject(el: HTMLElement, css: Css) {
  if (el.tagName.toLowerCase() === 'svg') {
    const paths = el.querySelectorAll('path, polygon, rect, ellipse, circle')
    for (const p of paths) {
      if ('background-color' in css) p.setAttribute('fill', css['background-color'] ?? 'none')
      if ('border-color' in css && css['border-color']) p.setAttribute('stroke', css['border-color'])
      if ('border-width' in css) p.setAttribute('stroke-width', css['border-width'] ?? '0')
    }
    const rest = Object.fromEntries(Object.entries(css).filter(([k]) => !k.startsWith('background') && !k.startsWith('border')))
    setCss(el, rest)
  } else setCss(el, css)
  // domOXML trusts an effects payload over the CSS: a changed shadow or opacity makes it stale.
  if ('box-shadow' in css || 'filter' in css) el.removeAttribute('data-domoxml-effects')
}

/** Every text run in the objects (formatting with the object selected, not editing). */
export const runsOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('.domoxml-text span, li span, td span, th span')].filter((s) => !s.querySelector('span'))
export const parasOf = (el: Element) => [...el.querySelectorAll<HTMLElement>('.domoxml-text, li')]

export function setRunStyle(ids: string[], css: Css, label = 'Format text') {
  editSlide(label, (root) => { for (const id of ids) { const el = find(root, id); if (el) for (const r of runsOf(el)) setCss(r, css) } })
}
export function setParaStyle(ids: string[], css: Css, label = 'Format paragraph') {
  editSlide(label, (root) => { for (const id of ids) { const el = find(root, id); if (el) for (const p of parasOf(el)) setCss(p, css) } })
}
/** Vertical alignment of a text box: domOXML's flex column anchor. */
export function setAnchor(ids: string[], anchor: 'top' | 'middle' | 'bottom') {
  editSlide('Vertical align', (root) => {
    for (const id of ids) {
      const el = find(root, id)
      if (!el) continue
      const host = textHost(el)
      if (!host) continue
      if (anchor === 'top') { for (const p of ['display', 'flex-direction', 'justify-content']) host.style.removeProperty(p) }
      else setCss(host, { display: 'flex', 'flex-direction': 'column', 'justify-content': anchor === 'middle' ? 'center' : 'flex-end' })
    }
  })
}

/** The element holding an object's paragraphs (the shape itself in domOXML's plain layout). */
export function textHost(el: HTMLElement): HTMLElement | null {
  const first = el.querySelector<HTMLElement>('.domoxml-text, ul, ol')
  if (!first) return el.tagName.toLowerCase() === 'div' && el.classList.contains('domoxml-shape') ? el : null
  let p = first.parentElement
  while (p && p !== el && (p.tagName === 'UL' || p.tagName === 'OL')) p = p.parentElement
  return p
}
export const hasText = (el: Element) => !!el.querySelector('.domoxml-text, li') && (el.textContent ?? '').trim().length > 0

// ---------- structure ----------

export function insertObject(html: string, label: string, opts: { edit?: boolean } = {}): string | undefined {
  const tmp = parseSlide(`<div class="domoxml-slide">${html}</div>`)
  const el = tmp.firstElementChild as HTMLElement
  const id = el.getAttribute('data-domoxml-node-id')!
  const ok = editSlide(label, (root) => {
    const scope = getEditor().scope
    const parent = (scope && find(root, scope)) || root
    parent.appendChild(root.ownerDocument.importNode(el, true))
  }, { sel: [id] })
  if (!ok) return
  if (opts.edit) setEditor({ editing: id })
  return id
}

export function removeObjects(ids: string[], label = 'Delete') {
  editSlide(label, (root) => {
    for (const id of ids) {
      const el = find(root, id)
      if (!el || el.hasAttribute('data-ream-locked')) continue
      const parent = el.parentElement
      el.remove()
      // A group left with one member or none dissolves, as in PowerPoint.
      if (parent && isGroup(parent) && members(parent).length < 2) parent.replaceWith(...parent.childNodes)
    }
  }, { sel: [] })
}

export type Order = 'forward' | 'backward' | 'front' | 'back'
export function reorder(ids: string[], how: Order) {
  editSlide(how === 'front' ? 'Bring to front' : how === 'back' ? 'Send to back' : how === 'forward' ? 'Bring forward' : 'Send backward', (root) => {
    const els = ids.map((id) => find(root, id)).filter((e): e is HTMLElement => !!e)
    if (!els.length) return false
    const parent = els[0].parentElement!
    const sibs = () => [...parent.children]
    if (how === 'front') for (const el of els) parent.appendChild(el)
    else if (how === 'back') for (const el of [...els].reverse()) parent.insertBefore(el, parent.firstChild)
    else if (how === 'forward') {
      for (const el of [...els].reverse()) { const next = el.nextElementSibling; if (next && !els.includes(next as HTMLElement)) next.after(el) }
    } else {
      for (const el of els) { const prev = el.previousElementSibling; if (prev && !els.includes(prev as HTMLElement)) prev.before(el) }
    }
    void sibs
  })
}

/** Moves one object to a position in the stacking order (object list drag). 0 = backmost. */
export function moveToIndex(id: string, index: number) {
  editSlide('Reorder', (root) => {
    const el = find(root, id)
    if (!el) return false
    const parent = el.parentElement!
    el.remove()
    const ref = parent.children[index] ?? null
    parent.insertBefore(el, ref)
  })
}

export function group(ids: string[]) {
  if (ids.length < 2) return
  const gid = newId('group')
  editSlide('Group', (root) => {
    const els = ids.map((id) => find(root, id)).filter((e): e is HTMLElement => !!e && e.parentElement === root)
    if (els.length < 2) return false
    const g = root.ownerDocument.createElement('div')
    g.className = 'domoxml-group'
    g.setAttribute('data-domoxml-node-id', gid)
    g.setAttribute('style', 'display:contents')
    // The group takes the place of its topmost member, keeping the members' stacking order.
    const ordered = [...root.children].filter((c) => els.includes(c as HTMLElement)) as HTMLElement[]
    ordered[ordered.length - 1].after(g)
    for (const el of ordered) g.appendChild(el)
    g.setAttribute('data-domoxml-group', groupPayload(ordered))
  }, { sel: [gid] })
  setEditor({ scope: null })
}

export function ungroup(ids: string[]) {
  const out: string[] = []
  editSlide('Ungroup', (root) => {
    let any = false
    for (const id of ids) {
      const el = find(root, id)
      if (!el || !isGroup(el)) continue
      out.push(...members(el).map((m) => m.getAttribute('data-domoxml-node-id')!).filter(Boolean))
      el.replaceWith(...el.childNodes)
      any = true
    }
    return any ? undefined : false
  }, { sel: out })
  setEditor({ sel: out, scope: null })
}

export function toggleAttr(ids: string[], attr: 'data-ream-locked' | 'data-ream-hidden', label: string) {
  editSlide(label, (root) => {
    const els = ids.map((id) => find(root, id)).filter((e): e is HTMLElement => !!e)
    const on = els.some((e) => !e.hasAttribute(attr))
    for (const el of els) {
      if (on) el.setAttribute(attr, '')
      else el.removeAttribute(attr)
      if (attr === 'data-ream-hidden') { if (on) el.style.visibility = 'hidden'; else el.style.removeProperty('visibility') }
    }
  })
}

export function setBackground(color: string, slideIds?: string[]) {
  const ids = slideIds ?? [getEditor().slideId!]
  editSlides('Background', (slides) => slides.map((s) => {
    if (!ids.includes(s.id)) return s
    const root = parseSlide(s.html)
    root.style.backgroundColor = color
    root.style.removeProperty('background-image')
    root.style.removeProperty('background')
    root.style.backgroundColor = color
    return { ...s, html: root.outerHTML }
  }))
}

/** Duplicates objects with new ids, offset by 12px (⌘D). Returns the new ids. */
export function duplicateObjects(ids: string[]): string[] {
  const out: string[] = []
  editSlide('Duplicate', (root) => {
    for (const id of ids) {
      const el = find(root, id)
      if (!el) continue
      const copy = el.cloneNode(true) as HTMLElement
      reId(copy)
      setBox(copy, (() => { const b = boxOf(el); return { ...b, x: b.x + 12, y: b.y + 12 } })())
      el.parentElement!.appendChild(copy)
      out.push(copy.getAttribute('data-domoxml-node-id')!)
    }
  }, { sel: out })
  setEditor({ sel: out })
  return out
}

/** Gives an object (and its members) fresh ids and drops what tied it to the import. */
export function reId(el: HTMLElement) {
  for (const x of [el, ...el.querySelectorAll<HTMLElement>('[data-domoxml-node-id]')]) {
    x.setAttribute('data-domoxml-node-id', newId(isGroup(x) ? 'group' : 'ream'))
    for (const a of ['data-domoxml-source-id', 'data-domoxml-source-part', 'data-domoxml-source-format', 'data-domoxml-owner-node-id']) x.removeAttribute(a)
  }
  if (isGroup(el)) el.setAttribute('data-domoxml-group', groupPayload(members(el)))
}

// ---------- slides ----------

const blankHtml = (w: number, h: number, bg = 'rgba(255,255,255,1)') =>
  `<div class="domoxml-slide" style="position:relative;overflow:hidden;box-sizing:border-box;width:${w}px;height:${h}px;background-color:${bg}"></div>`

/** A new slide from the current one's layout (its title and body boxes, emptied, and its background),
 *  or a blank one. Inserted after the current slide. */
export function newSlide(kind: 'layout' | 'blank' = 'layout') {
  const cur = currentSlide()
  if (!cur) return
  const { w, h } = cur.deck.size ?? { w: 1280, h: 720 }
  const slide: SlideDoc = { id: newId('s'), html: kind === 'blank' ? blankHtml(w, h, parseSlide(cur.slide.html).style.backgroundColor || undefined) : layoutOf(cur.slide.html, w, h) }
  editSlides('New slide', (slides) => { slides.splice(cur.index + 1, 0, slide); return slides }, { slideId: slide.id })
}

function layoutOf(html: string, w: number, h: number): string {
  const src = parseSlide(html)
  const out = parseSlide(blankHtml(w, h))
  for (const a of src.attributes) if (a.name !== 'data-transition') out.setAttribute(a.name, a.value)
  const texts = [...topNodes(src).values()].filter((el) => el.querySelector('.domoxml-text, li')) as HTMLElement[]
  const size = (el: HTMLElement) => Math.max(0, ...runsOf(el).map((r) => parseFloat(r.style.fontSize) || 0))
  const area = (el: HTMLElement) => { const b = boxOf(el); return b.w * b.h }
  const title = [...texts].sort((a, b) => size(b) - size(a) || boxOf(a).y - boxOf(b).y)[0]
  const body = texts.filter((t) => t !== title && boxOf(t).h > 60).sort((a, b) => area(b) - area(a))[0]
  // A title-only slide (a cover) continues as PowerPoint's "Title and Content": the title moves to
  // the top in the same style, with a bulleted body under it.
  if (title && !body) return titleAndContent(out, title, w, h)
  for (const [el, hint] of [[title, 'Click to add title'], [body, 'Click to add text']] as const) {
    if (!el) continue
    const copy = el.cloneNode(true) as HTMLElement
    reId(copy)
    for (const a of ['data-domoxml-text-payload', 'data-domoxml-effects']) copy.removeAttribute(a)
    emptyText(copy)
    copy.setAttribute('data-ream-placeholder', hint)
    out.appendChild(out.ownerDocument.importNode(copy, true))
  }
  return out.outerHTML
}

function titleAndContent(out: HTMLElement, title: HTMLElement, w: number, h: number): string {
  const run = runsOf(title)[0]
  const st = run?.getAttribute('style') ?? 'font-family:Instrument Sans,sans-serif;color:rgba(22,22,27,1)'
  const without = (s: string, ...props: string[]) => s.split(';').filter((d) => !props.includes(d.split(':')[0].trim())).join(';')
  const titleRun = `${without(st, 'font-size')};font-size:36pt`
  const bodyRun = `${without(st, 'font-size', 'font-weight', 'letter-spacing')};font-size:20pt;font-weight:400`
  const mx = Math.round(w * 0.075)
  out.insertAdjacentHTML('beforeend',
    `<div class="domoxml-shape" data-domoxml-node-id="${newId()}" data-domoxml-text-body="true" data-ream-placeholder="Click to add title" data-ream-empty style="position:absolute;box-sizing:border-box;left:${mx}px;top:${Math.round(h * 0.07)}px;width:${w - mx * 2}px;height:${Math.round(h * 0.15)}px;display:flex;flex-direction:column;justify-content:flex-end">`
    + `<div class="domoxml-text" style="white-space:pre-wrap;text-align:left"><span style="${titleRun.replace(/"/g, '&quot;')}"><br></span></div></div>`
    + `<div class="domoxml-shape" data-domoxml-node-id="${newId()}" data-ream-placeholder="Click to add text" data-ream-empty style="position:absolute;box-sizing:border-box;left:${mx}px;top:${Math.round(h * 0.27)}px;width:${w - mx * 2}px;height:${Math.round(h * 0.62)}px">`
    + `<ul style="list-style-type:disc;padding-left:18pt"><li style="white-space:pre-wrap;text-align:left"><span style="${bodyRun.replace(/"/g, '&quot;')}"><br></span></li></ul></div>`)
  return out.outerHTML
}

/** Leaves one empty paragraph that keeps the first run's style (so typing picks it up). */
export function emptyText(el: HTMLElement) {
  const host = textHost(el)
  if (!host) return
  const firstPara = host.querySelector<HTMLElement>('.domoxml-text, li')
  const firstRun = host.querySelector<HTMLElement>('span')
  const doc = el.ownerDocument
  const p = doc.createElement('div')
  p.className = 'domoxml-text'
  p.setAttribute('style', firstPara?.tagName === 'DIV' ? firstPara.getAttribute('style') ?? '' : 'white-space:pre-wrap;text-align:left')
  const span = doc.createElement('span')
  span.setAttribute('style', firstRun?.getAttribute('style') ?? '')
  span.appendChild(doc.createElement('br'))
  p.appendChild(span)
  for (const c of [...host.children]) if (c.matches('.domoxml-text, ul, ol')) c.remove()
  host.appendChild(p)
  el.setAttribute('data-ream-empty', '')
}

export function duplicateSlides(ids: string[]) {
  const deck = openDeck()
  if (!deck) return
  const copies: SlideDoc[] = []
  editSlides('Duplicate slide', (slides) => {
    const last = Math.max(...ids.map((id) => slides.findIndex((s) => s.id === id)))
    for (const s of slides.filter((s) => ids.includes(s.id))) {
      // A copy is a new slide: it keeps the original's IR so it still exports exactly.
      copies.push({ ...s, id: newId('s') })
    }
    slides.splice(last + 1, 0, ...copies)
    return slides
  }, { slideId: undefined })
  if (copies.length) setEditor({ slideId: copies[0].id, railSel: copies.map((c) => c.id), railAnchor: copies[0].id, sel: [] })
}

export function deleteSlides(ids: string[]) {
  const deck = openDeck()
  if (!deck || !ids.length) return
  const first = deck.slides.findIndex((s) => ids.includes(s.id))
  const rest = deck.slides.filter((s) => !ids.includes(s.id))
  const { w, h } = deck.size ?? { w: 1280, h: 720 }
  const next = rest.length ? rest : [{ id: newId('s'), html: blankHtml(w, h) }]
  const focus = next[Math.min(first, next.length - 1)].id
  editSlides(ids.length === 1 ? 'Delete slide' : `Delete ${ids.length} slides`, () => next, { slideId: focus })
}

/** Moves the selected slides as one block so they land before `beforeId` (null: at the end). */
export function moveSlides(ids: string[], beforeIndex: number) {
  editSlides(ids.length === 1 ? 'Move slide' : 'Move slides', (slides) => {
    const moving = slides.filter((s) => ids.includes(s.id))
    const before = slides.slice(0, beforeIndex).filter((s) => !ids.includes(s.id)).length
    const rest = slides.filter((s) => !ids.includes(s.id))
    rest.splice(before, 0, ...moving)
    return rest.every((s, i) => s === slides[i]) ? false : rest
  }, { slideId: getEditor().slideId ?? undefined, railSel: ids })
}

export function toggleHidden(ids: string[]) {
  editSlides('Hide slide', (slides) => {
    const on = slides.some((s) => ids.includes(s.id) && !s.hidden)
    return slides.map((s) => (ids.includes(s.id) ? { ...s, hidden: on || undefined } : s))
  })
}

/** Slide-level attributes domOXML reads on export: data-notes (speaker notes), data-transition*. */
export function setSlideAttrs(attrs: Record<string, string | null>, label: string, slideIds?: string[]) {
  const ids = slideIds ?? [getEditor().slideId!]
  editSlides(label, (slides) => {
    let changed = false
    const next = slides.map((s) => {
      if (!ids.includes(s.id)) return s
      const root = parseSlide(s.html)
      for (const [k, v] of Object.entries(attrs)) { if (v === null || v === '') root.removeAttribute(k); else root.setAttribute(k, v) }
      const html = root.outerHTML
      if (html === s.html) return s
      changed = true
      return { ...s, html }
    })
    return changed ? next : false
  })
}
export const setNotes = (slideId: string, notes: string) => setSlideAttrs({ 'data-notes': notes.trim() ? notes : null }, 'Speaker notes', [slideId])
export const notesOf = (s: SlideDoc) => parseSlide(s.html).getAttribute('data-notes') ?? ''

/** An object's animation (domOXML's data-animate*: one effect per object here; others are kept). */
export type Anim = { effect: string; step: number; delay: number; duration: number }
export function animOf(el: Element): Anim | null {
  const effect = el.getAttribute('data-animate')?.split(/\s+/)[0]
  if (!effect) return null
  const n = (a: string, d: number) => { const v = parseFloat(el.getAttribute(a)?.split(/\s+/)[0] ?? ''); return Number.isFinite(v) ? v : d }
  return { effect, step: n('data-animate-step', 0), delay: n('data-animate-delay', 0), duration: n('data-animate-duration', 500) }
}
export function setAnimation(ids: string[], anim: Anim | null) {
  editSlide(anim ? 'Animation' : 'Remove animation', (root) => {
    // A new "on click" effect goes after every click already on the slide.
    const steps = [...root.querySelectorAll('[data-animate-step]')].flatMap((e) => e.getAttribute('data-animate-step')!.split(/\s+/).map(Number))
    const last = Math.max(0, ...steps.filter(Number.isFinite))
    let i = 0
    for (const id of ids) {
      const el = find(root, id)
      if (!el) continue
      if (!anim) { for (const a of ['data-animate', 'data-animate-step', 'data-animate-delay', 'data-animate-duration', 'data-animate-amount', 'data-animate-order']) el.removeAttribute(a); continue }
      const step = anim.step < 0 ? last + 1 + i++ : anim.step
      const keep = (a: string) => (el.getAttribute(a) ?? '').split(/\s+/).slice(1).join(' ')
      const put = (a: string, v: string) => el.setAttribute(a, [v, keep(a)].filter(Boolean).join(' '))
      put('data-animate', anim.effect)
      put('data-animate-step', String(step))
      put('data-animate-delay', String(Math.round(anim.delay)))
      put('data-animate-duration', String(Math.round(anim.duration)))
      if (!el.hasAttribute('data-animate-amount')) el.setAttribute('data-animate-amount', '0')
      el.removeAttribute('data-animate-order')
    }
  })
}

// ---------- defaults for new objects ----------

/** The deck's most used text colour and font, so new objects match it (not hard-coded black). */
export function deckTextStyle(deck: Deck): { color: string; font: string } {
  const colors = new Map<string, number>(), fonts = new Map<string, number>()
  for (const s of deck.slides.slice(0, 30)) {
    for (const m of s.html.matchAll(/<span style="([^"]*)"/g)) {
      const st = m[1]
      const c = /(?:^|;)color:([^;]+)/.exec(st)?.[1]
      const f = /font-family:([^;]+)/.exec(st)?.[1]
      if (c) colors.set(c, (colors.get(c) ?? 0) + 1)
      if (f && !f.startsWith('+')) fonts.set(f, (fonts.get(f) ?? 0) + 1)
    }
  }
  const top = (m: Map<string, number>, d: string) => [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? d
  return { color: top(colors, 'rgba(23,23,28,1)'), font: top(fonts, 'Instrument Sans,sans-serif') }
}

// ---------- deck design (PowerPoint's Replace Fonts, theme colours, slide size) ----------

const hex = (c: string) => {
  const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c)
  if (m) return `#${[m[1], m[2], m[3]].map((x) => (+x).toString(16).padStart(2, '0')).join('')}`
  return c.trim().toLowerCase()
}

/** Every run in `from` (by its first family) becomes `to`, across the deck. */
export function replaceFont(from: string, to: string) {
  const norm = (f: string) => f.split(',')[0].replace(/["']/g, '').trim().toLowerCase()
  editSlides(`Replace ${from} with ${to}`, (slides) => slides.map((sl) => {
    const root = parseSlide(sl.html)
    let changed = false
    for (const el of root.querySelectorAll<HTMLElement>('[style*="font-family"]')) {
      if (norm(el.style.fontFamily) === norm(from)) { el.style.fontFamily = fontStack(to); changed = true }
    }
    return changed ? { ...sl, html: root.outerHTML } : sl
  }))
}

/** Every use of a colour (text, fills, borders, lines) becomes another, across the deck. */
export function replaceColour(from: string, to: string) {
  const f = hex(from)
  editSlides('Replace colour', (slides) => slides.map((sl) => {
    const root = parseSlide(sl.html)
    let changed = false
    for (const el of [root, ...root.querySelectorAll<HTMLElement>('*')]) {
      for (const prop of ['color', 'background-color', 'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color']) {
        const v = el.style?.getPropertyValue(prop)
        if (v && hex(v) === f) { el.style.setProperty(prop, to); changed = true }
      }
      for (const attr of ['fill', 'stroke']) { const v = el.getAttribute(attr); if (v && hex(v) === f) { el.setAttribute(attr, to); changed = true } }
    }
    return changed ? { ...sl, html: root.outerHTML } : sl
  }))
}

/** A new slide size: content scales to fit and stays centred ("Ensure fit"). Slides then export
 *  from their HTML, since their imported IR is for the old size. */
export function setSlideSize(w: number, h: number) {
  const deck = openDeck()
  if (!deck) return
  const old = deck.size ?? { w: 1280, h: 720 }
  if (old.w === w && old.h === h) return
  const k = Math.min(w / old.w, h / old.h)
  const dx = (w - old.w * k) / 2, dy = (h - old.h * k) / 2
  const slides = deck.slides.map((sl) => {
    const root = parseSlide(sl.html)
    root.style.width = `${w}px`
    root.style.height = `${h}px`
    for (const el of topNodes(root).values()) {
      const b = boxOf(el as HTMLElement)
      setBox(el as HTMLElement, { x: dx + b.x * k, y: dy + b.y * k, w: b.w * k, h: b.h * k, rot: b.rot })
      // Text scales with its box, as PowerPoint's "Ensure fit" does.
      if (k !== 1) for (const r of el.querySelectorAll<HTMLElement>('[style*="font-size"]')) { const pt = parseFloat(r.style.fontSize); if (pt) r.style.fontSize = `${Math.round(pt * k * 10) / 10}pt` }
    }
    const { ir: _ir, irDirty: _d, irMoved: _m, irSlide: _s, irAnim: _a, ...rest } = sl
    return { ...rest, html: root.outerHTML }
  })
  const d = getLibrary().entries[deck.id]
  if (d?.type !== 'deck') return
  const { slideId, sel } = getEditor()
  transact(deck.id, slides, { label: 'Slide size', extra: { size: w === 1280 && h === 720 ? undefined : { w, h } }, selBefore: { slide: slideId!, ids: sel }, selAfter: { slide: slideId!, ids: [] } })
  setEditor({ sel: [] })
}

export function deckFonts(deck: Deck): string[] {
  const out = new Map<string, number>()
  for (const sl of deck.slides) for (const m of sl.html.matchAll(/font-family:\s*([^;"]+)/g)) {
    const f = m[1].split(',')[0].replace(/&quot;|["']/g, '').trim()
    if (f && !f.startsWith('+')) out.set(f, (out.get(f) ?? 0) + 1)
  }
  return [...out].sort((a, b) => b[1] - a[1]).map(([f]) => f)
}

// ---------- comments ----------

export function addComment(slideId: string, text: string, objectId?: string) {
  editSlides('Comment', (slides) => slides.map((s) => (s.id === slideId ? { ...s, comments: [...(s.comments ?? []), { id: newId('c'), text, at: Date.now(), objectId }] } : s)))
}
export function replyComment(slideId: string, commentId: string, text: string) {
  editSlides('Reply', (slides) => slides.map((s) => (s.id === slideId ? { ...s, comments: (s.comments ?? []).map((c) => (c.id === commentId ? { ...c, replies: [...(c.replies ?? []), { id: newId('r'), text, at: Date.now() }] } : c)) } : s)))
}
export function resolveComment(slideId: string, commentId: string, resolved: boolean) {
  editSlides(resolved ? 'Resolve comment' : 'Reopen comment', (slides) => slides.map((s) => (s.id === slideId ? { ...s, comments: (s.comments ?? []).map((c) => (c.id === commentId ? { ...c, resolved } : c)) } : s)))
}
export function deleteComment(slideId: string, commentId: string) {
  editSlides('Delete comment', (slides) => slides.map((s) => (s.id === slideId ? { ...s, comments: (s.comments ?? []).filter((c) => c.id !== commentId) } : s)))
}
