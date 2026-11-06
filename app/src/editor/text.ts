// Text editing (spec: Text editing). The text is edited in place in the slide's shadow root, then
// normalized back to domOXML's text model: paragraphs (div.domoxml-text, or li inside ul/ol for lists,
// nested by level) holding runs (spans with inline style). Browser markup (<b>, <font>, stray divs) never
// reaches the stored HTML.
import type { Css } from './ops'

// ---------- selection inside a shadow root ----------

type ShadowSel = ShadowRoot & { getSelection?: () => Selection | null }
type ComposedSel = Selection & { getComposedRanges?: (o: { shadowRoots: ShadowRoot[] }) => StaticRange[] }

/** The selection's range inside `root` (Chrome: root.getSelection; Safari: getComposedRanges). */
export function rangeIn(root: ShadowRoot): Range | null {
  const own = (root as ShadowSel).getSelection?.()
  if (own && own.rangeCount) return own.getRangeAt(0)
  const sel = document.getSelection() as ComposedSel | null
  if (!sel) return null
  if (sel.getComposedRanges) {
    const [r] = sel.getComposedRanges({ shadowRoots: [root] })
    if (!r) return null
    const range = document.createRange()
    range.setStart(r.startContainer, r.startOffset)
    range.setEnd(r.endContainer, r.endOffset)
    return range
  }
  return sel.rangeCount ? sel.getRangeAt(0) : null
}

export function setRange(r: { startContainer: Node; startOffset: number; endContainer: Node; endOffset: number }) {
  document.getSelection()?.setBaseAndExtent(r.startContainer, r.startOffset, r.endContainer, r.endOffset)
}

// ---------- caret positions as (paragraph, character) ----------

export const PARA = '.domoxml-text, li, td > div:not(.domoxml-text), th > div:not(.domoxml-text)'
const paraEls = (host: Element) => [...host.querySelectorAll<HTMLElement>('.domoxml-text, li')]
type Pos = [number, number]

function textNodes(el: Node): Text[] {
  const out: Text[] = []
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text)
  return out
}

function posOf(host: Element, node: Node, offset: number): Pos {
  const paras = paraEls(host)
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement
  const p = el?.closest('.domoxml-text, li')
  const i = Math.max(0, p ? paras.indexOf(p as HTMLElement) : 0)
  const para = paras[i]
  if (!para) return [0, 0]
  const r = document.createRange()
  r.setStart(para, 0)
  try { r.setEnd(node, offset) } catch { return [i, 0] }
  return [i, r.toString().length]
}

function nodeAt(host: Element, [i, o]: Pos): [Node, number] {
  const paras = paraEls(host)
  const para = paras[Math.min(i, paras.length - 1)]
  if (!para) return [host, 0]
  let left = o
  for (const t of textNodes(para)) {
    if (left <= t.length) return [t, left]
    left -= t.length
  }
  const last = textNodes(para).pop()
  if (last) return [last, last.length]
  const span = para.querySelector('span') ?? para
  return [span, 0]
}

export function saveCaret(host: Element, r: Range): { start: Pos; end: Pos } {
  return { start: posOf(host, r.startContainer, r.startOffset), end: posOf(host, r.endContainer, r.endOffset) }
}
export function restoreCaret(host: Element, c: { start: Pos; end: Pos }) {
  const [sn, so] = nodeAt(host, c.start)
  const [en, eo] = nodeAt(host, c.end)
  setRange({ startContainer: sn, startOffset: so, endContainer: en, endOffset: eo })
}

// ---------- the paragraph model ----------

export type List = 'ul' | 'ol' | null
export type Para = { list: List; listStyle: string; gutter: string; level: number; style: string; runs: Run[]; start?: number }
type Run = { text: string; style: string } | { br: true; style: string }

const INLINE_STYLE: Record<string, string> = {
  B: 'font-weight:700', STRONG: 'font-weight:700', I: 'font-style:italic', EM: 'font-style:italic',
  U: 'text-decoration-line:underline', S: 'text-decoration-line:line-through', STRIKE: 'text-decoration-line:line-through',
  SUB: 'vertical-align:sub', SUP: 'vertical-align:super',
}

function mergeStyle(outer: string, inner: string): string {
  const m = new Map<string, string>()
  for (const s of [outer, inner]) {
    for (const decl of s.split(';')) {
      const i = decl.indexOf(':')
      if (i > 0) m.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim())
    }
  }
  return [...m].map(([k, v]) => `${k}:${v}`).join(';')
}

function inlineStyleOf(el: HTMLElement): string {
  let st = el.getAttribute('style') ?? ''
  if (INLINE_STYLE[el.tagName]) st = mergeStyle(INLINE_STYLE[el.tagName], st)
  if (el.tagName === 'FONT') {
    const c = el.getAttribute('color')
    if (c) st = mergeStyle(st, `color:${c}`)
  }
  return st
}

/** Runs of an inline subtree, styles merged from outer to inner. Links keep their <a>. */
function runsIn(node: Node, style: string, out: Run[]) {
  for (const c of node.childNodes) {
    if (c.nodeType === 3) { const t = (c as Text).data.replace(/​/g, ''); if (t) out.push({ text: t, style }) }
    else if (c.nodeType === 1) {
      const el = c as HTMLElement
      if (el.tagName === 'BR') { out.push({ br: true, style }); continue }
      if (BLOCK.has(el.tagName)) { runsIn(el, style, out); continue }
      runsIn(el, mergeStyle(style, inlineStyleOf(el)), out)
    }
  }
}

const BLOCK = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'])

/** Reads a text host's paragraphs, whatever the browser did to them while editing. */
export function readParas(host: Element): Para[] {
  const out: Para[] = []
  let loose: Run[] = []
  const lastStyle = () => out.at(-1)?.style ?? 'white-space:pre-wrap;text-align:left'
  const flushLoose = () => {
    if (loose.some((r) => 'br' in r || r.text.trim())) out.push({ list: null, listStyle: '', gutter: '', level: 0, style: lastStyle(), runs: loose })
    loose = []
  }
  const walk = (node: Element, list: List, listStyle: string, gutter: string, level: number) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if ((c as Text).data.trim() || list === null) runsIn({ childNodes: [c] } as unknown as Node, '', loose); continue }
      if (c.nodeType !== 1) continue
      const el = c as HTMLElement
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        flushLoose()
        const nested = list !== null
        walk(el, el.tagName.toLowerCase() as List, el.style.listStyleType || (el.tagName === 'OL' ? 'decimal' : 'disc'), el.style.paddingLeft || '18pt', nested ? level + 1 : 0)
      } else if (el.tagName === 'LI') {
        flushLoose()
        const runs: Run[] = []
        runsIn(el, '', runs)
        // An <li> can hold a nested list (some writers nest lists inside items).
        const nestedList = el.querySelector(':scope > ul, :scope > ol')
        if (nestedList) { const own: Run[] = []; for (const k of el.childNodes) if (k !== nestedList) runsIn({ childNodes: [k] } as unknown as Node, '', own); out.push({ list, listStyle, gutter, level, style: el.getAttribute('style') ?? '', runs: own, start: startOf(node, el) }); walk(nestedList as Element, nestedList.tagName.toLowerCase() as List, (nestedList as HTMLElement).style.listStyleType || 'disc', (nestedList as HTMLElement).style.paddingLeft || '18pt', level + 1) }
        else out.push({ list, listStyle, gutter, level, style: el.getAttribute('style') ?? '', runs, start: startOf(node, el) })
      } else if (BLOCK.has(el.tagName)) {
        flushLoose()
        if (el.querySelector('ul, ol, .domoxml-text')) { walk(el, list, listStyle, gutter, level); continue }
        const runs: Run[] = []
        runsIn(el, el.classList.contains('domoxml-text') ? '' : inlineStyleOf(el).replace(/text-align:[^;]*;?/g, ''), runs)
        const style = el.classList.contains('domoxml-text') ? el.getAttribute('style') ?? '' : mergeStyle(list ? 'white-space:pre-wrap;text-align:left' : lastStyle(), alignOf(el))
        out.push({ list: el.classList.contains('domoxml-text') ? null : list, listStyle, gutter, level, style, runs })
      } else runsIn({ childNodes: [el] } as unknown as Node, '', loose)
    }
  }
  walk(host, null, '', '', 0)
  flushLoose()
  return out
}

const alignOf = (el: HTMLElement) => (el.style.textAlign ? `text-align:${el.style.textAlign}` : '')
function startOf(list: Element, li: Element): number | undefined {
  if (list.tagName !== 'OL' || list.firstElementChild !== li) return undefined
  const s = parseInt(list.getAttribute('start') ?? '1', 10)
  return s !== 1 ? s : undefined
}

const escHtml = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
const escAttr = (t: string) => t.replace(/"/g, '&quot;')

function runsHtml(runs: Run[], fallback: string): string {
  // Adjacent runs with the same style merge; an empty paragraph keeps one styled, empty run.
  const merged: Run[] = []
  for (const r of runs) {
    const prev = merged.at(-1)
    if (prev && 'text' in prev && 'text' in r && prev.style === r.style) prev.text += r.text
    else merged.push({ ...r })
  }
  if (!merged.some((r) => 'text' in r && r.text)) return `<span style="${escAttr(runs[0]?.style || fallback)}"><br></span>`
  // A trailing <br> is only the browser's placeholder for an empty last line.
  while (merged.length > 1 && 'br' in merged.at(-1)!) merged.pop()
  return merged.map((r) => ('br' in r ? '<br>' : `<span style="${escAttr(r.style)}">${escHtml(r.text)}</span>`)).join('')
}

/** domOXML's text HTML: plain paragraphs as div.domoxml-text, consecutive list paragraphs as nested lists. */
export function renderParas(paras: Para[], fallbackRun = ''): string {
  const out: string[] = []
  const open: { tag: string; level: number }[] = []
  const closeTo = (level: number) => { while (open.length && open.at(-1)!.level > level) out.push(`</${open.pop()!.tag}>`) }
  for (const p of paras) {
    if (p.list) {
      const target = p.level + 1
      closeTo(target)
      if (open.length && open.at(-1)!.level === target && open.at(-1)!.tag !== p.list) closeTo(target - 1)
      while (!open.length || open.at(-1)!.level < target) {
        const lvl = open.length ? open.at(-1)!.level + 1 : target
        const start = p.start && lvl === target ? ` start="${p.start}"` : ''
        out.push(`<${p.list} style="list-style-type:${escAttr(p.listStyle || (p.list === 'ol' ? 'decimal' : 'disc'))};padding-left:${escAttr(p.gutter || '18pt')}"${start}>`)
        open.push({ tag: p.list, level: lvl })
        if (lvl > target) break
      }
      const style = p.style.replace(/white-space:[^;]*;?/g, '').replace(/^;|;$/g, '')
      out.push(`<li style="${escAttr(mergeStyle('white-space:pre-wrap', style))}">${runsHtml(p.runs, fallbackRun)}</li>`)
    } else {
      closeTo(0)
      out.push(`<div class="domoxml-text" style="${escAttr(p.style || 'white-space:pre-wrap;text-align:left')}">${runsHtml(p.runs, fallbackRun)}</div>`)
    }
  }
  closeTo(0)
  return out.join('')
}

/** Normalizes a text host in place. Returns whether it holds any text. */
export function normalizeHost(host: HTMLElement): boolean {
  const fallback = host.querySelector('span')?.getAttribute('style') ?? ''
  const paras = readParas(host)
  const keep = [...host.childNodes].filter((c) => c.nodeType === 1 && !(c as Element).matches('.domoxml-text, ul, ol, div, p, li, span, br, b, i, u, font, strong, em, a'))
  host.innerHTML = renderParas(paras.length ? paras : [{ list: null, listStyle: '', gutter: '', level: 0, style: 'white-space:pre-wrap;text-align:left', runs: [] }], fallback)
  for (const k of keep) host.prepend(k)
  // domOXML consolidates plain paragraphs into one text body only when told to; lists are read as lists.
  const shape = host.closest('[data-domoxml-node-id]')
  if (shape && shape === host) {
    if (paras.some((p) => p.list)) shape.removeAttribute('data-domoxml-text-body')
    else shape.setAttribute('data-domoxml-text-body', 'true')
  }
  return paras.some((p) => p.runs.some((r) => 'text' in r && r.text.trim()))
}

// ---------- formatting a range ----------

/** Splits text so the range covers whole text nodes, each alone in its own span; returns those spans. */
function isolate(host: HTMLElement, r: Range): HTMLElement[] {
  if (r.collapsed) return []
  if (r.endContainer.nodeType === 3 && r.endOffset < (r.endContainer as Text).length) (r.endContainer as Text).splitText(r.endOffset)
  if (r.startContainer.nodeType === 3 && r.startOffset > 0) {
    const t = (r.startContainer as Text).splitText(r.startOffset)
    if (r.endContainer === r.startContainer) r.setEnd(t, t.length)
    r.setStart(t, 0)
  }
  const nodes = textNodes(host).filter((t) => r.intersectsNode(t) && t.length > 0)
  return nodes.map((t) => {
    const parent = t.parentElement!
    if (parent.tagName !== 'SPAN') {
      const span = host.ownerDocument.createElement('span')
      t.replaceWith(span)
      span.appendChild(t)
      return span
    }
    if (parent.childNodes.length === 1) return parent
    const before = parent.cloneNode(false) as HTMLElement, after = parent.cloneNode(false) as HTMLElement
    let n = parent.firstChild
    while (n && n !== t) { const next = n.nextSibling; before.appendChild(n); n = next }
    n = t.nextSibling
    while (n) { const next = n.nextSibling; after.appendChild(n); n = next }
    if (before.childNodes.length) parent.before(before)
    if (after.childNodes.length) parent.after(after)
    return parent
  })
}

/** Applies run styles to the selected text and keeps it selected. */
export function styleRange(host: HTMLElement, r: Range, css: Css) {
  const spans = isolate(host, r)
  for (const s of spans) for (const [k, v] of Object.entries(css)) { if (v === null) s.style.removeProperty(k); else s.style.setProperty(k, v) }
  if (spans.length) {
    const first = spans[0].firstChild!, last = spans.at(-1)!.firstChild as Text
    setRange({ startContainer: first, startOffset: 0, endContainer: last, endOffset: last.length })
  }
}

/** The computed run style at the start of a range (what the toolbar shows). */
export function styleAt(node: Node | null): CSSStyleDeclaration | null {
  const el = node?.nodeType === 3 ? node.parentElement : (node as Element | null)
  return el ? getComputedStyle(el) : null
}

/** Inserts text at the caret as a new run with the pending style (formatting set with only a caret). */
export function insertStyled(host: HTMLElement, r: Range, text: string, css: Css) {
  const base = r.startContainer.nodeType === 3 ? r.startContainer.parentElement : (r.startContainer as HTMLElement)
  const span = host.ownerDocument.createElement('span')
  const inherit = base?.closest('span')?.getAttribute('style') ?? ''
  span.setAttribute('style', inherit)
  for (const [k, v] of Object.entries(css)) { if (v === null) span.style.removeProperty(k); else span.style.setProperty(k, v) }
  span.textContent = text
  r.deleteContents()
  const at = r.startContainer
  if (at.nodeType === 3) {
    const t = at as Text
    const tail = t.splitText(r.startOffset)
    const outer = t.parentElement?.tagName === 'SPAN' ? t.parentElement : null
    if (outer) {
      // Split the run around the caret, so the new run sits between its halves, not inside.
      const after = outer.cloneNode(false) as HTMLElement
      let n: Node | null = tail
      while (n) { const next: Node | null = n.nextSibling; after.appendChild(n); n = next }
      outer.after(span)
      if (after.textContent) span.after(after)
    } else t.after(span)
  } else {
    const el = at as HTMLElement
    const ref = el.childNodes[r.startOffset] ?? null
    if (el.tagName === 'SPAN' && el.textContent === '') { el.replaceWith(span) }
    else el.insertBefore(span, ref)
  }
  for (const br of [...(span.parentElement?.querySelectorAll(':scope > span > br') ?? [])]) if (br.parentElement !== span && br.parentElement!.textContent === '') br.parentElement!.remove()
  const t = span.firstChild as Text
  setRange({ startContainer: t, startOffset: t.length, endContainer: t, endOffset: t.length })
}

/** The paragraphs a range touches (indices into the host's paragraphs). */
export function parasInRange(host: Element, r: Range | null): number[] {
  const all = paraEls(host)
  if (!r) return all.map((_, i) => i)
  const out = all.map((p, i) => (r.intersectsNode(p) ? i : -1)).filter((i) => i >= 0)
  return out.length ? out : [posOf(host, r.startContainer, r.startOffset)[0]]
}

/** Changes paragraphs through the model (lists, levels, alignment), keeping the caret where it was. */
export function editParas(host: HTMLElement, r: Range | null, fn: (p: Para, i: number) => Para) {
  const caret = r ? saveCaret(host, r) : null
  const which = new Set(parasInRange(host, r))
  const paras = readParas(host).map((p, i) => (which.has(i) ? fn(p, i) : p))
  const fallback = host.querySelector('span')?.getAttribute('style') ?? ''
  host.innerHTML = renderParas(paras, fallback)
  if (caret) restoreCaret(host, caret)
}

export function toggleList(host: HTMLElement, r: Range | null, kind: 'ul' | 'ol') {
  const paras = readParas(host)
  const which = parasInRange(host, r)
  const on = which.some((i) => paras[i]?.list !== kind)
  editParas(host, r, (p) => (on ? { ...p, list: kind, listStyle: kind === 'ol' ? 'decimal' : 'disc', gutter: p.gutter || '18pt' } : { ...p, list: null, level: 0, style: mergeStyle('white-space:pre-wrap', p.style) }))
}

export function indent(host: HTMLElement, r: Range | null, by: 1 | -1) {
  editParas(host, r, (p) => (p.list ? { ...p, level: Math.max(0, Math.min(8, p.level + by)), listStyle: p.list === 'ul' ? (['disc', 'circle', 'square'][Math.max(0, p.level + by) % 3]) : p.listStyle } : p))
}

export function alignParas(host: HTMLElement, r: Range | null, align: string) {
  editParas(host, r, (p) => ({ ...p, style: mergeStyle(p.style, `text-align:${align}`) }))
}
