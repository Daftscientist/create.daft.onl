// Lines and arrows (spec phase 2): domOXML's connector shape, an <svg> carrying the connector as
// JSON (data-domoxml-connector), which export writes as a native PowerPoint line (p:cxnSp) with its
// arrowheads. The payload is the truth on export, so every move or endpoint drag rewrites it with the
// drawing; an imported connector that moves exports where it is now.
const EMU = 9525
export type Pt = { x: number; y: number }
type Arrow = { type?: string; width?: string; length?: string } | null
export type Connector = { start: Pt; end: Pt; kind: string; vertical_first?: boolean; elbow?: number; line: { color: { r: number; g: number; b: number; a?: number }; width_emu: number; dash?: string; head?: Arrow; tail?: Arrow; [k: string]: unknown }; [k: string]: unknown }

export const isLine = (el: Element) => el.hasAttribute('data-domoxml-connector')
export function readLine(el: Element): Connector | null {
  try { return JSON.parse(el.getAttribute('data-domoxml-connector') ?? '') as Connector } catch { return null }
}
/** The line's ends in slide px. */
export function lineEnds(el: Element): [Pt, Pt] | null {
  const c = readLine(el)
  return c ? [{ x: c.start.x / EMU, y: c.start.y / EMU }, { x: c.end.x / EMU, y: c.end.y / EMU }] : null
}

const n = (v: number) => Math.round(v * 1000) / 1000
const LEN = { sm: 2, med: 3, lg: 5 }, WID = { sm: 2, med: 3, lg: 5 }

/** Redraws a connector element for new ends (px), keeping its style, and rewrites its payload. */
export function setLineEnds(el: HTMLElement, a: Pt, b: Pt) {
  const c = readLine(el)
  if (!c) return
  c.start = { x: Math.round(a.x * EMU), y: Math.round(a.y * EMU) }
  c.end = { x: Math.round(b.x * EMU), y: Math.round(b.y * EMU) }
  // Only straight lines are drawn by Ream; a bent or curved import that is moved keeps its kind.
  el.setAttribute('data-domoxml-connector', JSON.stringify(c))
  const w = c.line.width_emu / EMU
  const pad = Math.max(w * 2, 4)
  const minX = Math.min(a.x, b.x) - pad, minY = Math.min(a.y, b.y) - pad
  el.style.left = `${n(minX)}px`; el.style.top = `${n(minY)}px`
  el.style.width = `${n(Math.abs(b.x - a.x) + pad * 2)}px`; el.style.height = `${n(Math.abs(b.y - a.y) + pad * 2)}px`
  el.style.overflow = 'visible'
  el.removeAttribute('width'); el.removeAttribute('height'); el.removeAttribute('viewBox'); el.removeAttribute('preserveAspectRatio')
  el.innerHTML = lineBody(c, { x: a.x - minX, y: a.y - minY }, { x: b.x - minX, y: b.y - minY }, el.getAttribute('data-domoxml-node-id') ?? 'line')
}

function lineBody(c: Connector, a: Pt, b: Pt, id: string): string {
  const { r, g, b: bl, a: al = 1 } = c.line.color
  const color = `rgba(${r},${g},${bl},${al})`
  const w = c.line.width_emu / EMU
  let defs = '', marks = ''
  for (const [end, arrow] of [['head', c.line.head], ['tail', c.line.tail]] as const) {
    if (!arrow || arrow.type === 'none' || !arrow.type) continue
    const mid = `${id}-${end}`
    defs += `<marker id="${mid}" markerUnits="strokeWidth" viewBox="0 0 10 7" preserveAspectRatio="none" markerWidth="${LEN[(arrow.length ?? 'med') as 'med']}" markerHeight="${WID[(arrow.width ?? 'med') as 'med']}" refX="10" refY="3.5" orient="${end === 'head' ? 'auto-start-reverse' : 'auto'}"><polygon points="0 0, 10 3.5, 0 7" fill="${color}"/></marker>`
    marks += ` marker-${end === 'head' ? 'start' : 'end'}="url(#${mid})"`
  }
  const dash = c.line.dash && c.line.dash !== 'solid' ? ` stroke-dasharray="${c.line.dash === 'dot' ? `${w} ${w * 2}` : `${w * 4} ${w * 3}`}"` : ''
  return `${defs ? `<defs>${defs}</defs>` : ''}<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${color}" stroke-width="${n(w)}"${dash}${marks} fill="none" stroke-linecap="round"/>`
}

export function lineHtml(id: string, a: Pt, b: Pt, color: { r: number; g: number; b: number }, widthPx: number, arrow: boolean): string {
  const c: Connector = { start: { x: 0, y: 0 }, end: { x: 0, y: 0 }, kind: 'straight', line: { color: { ...color, a: 1 }, width_emu: Math.round(widthPx * EMU), head: null, tail: arrow ? { type: 'triangle', width: 'med', length: 'med' } : null } }
  const tmp = document.createElement('div')
  tmp.innerHTML = `<svg class="domoxml-shape" data-domoxml-node-id="${id}" xmlns="http://www.w3.org/2000/svg" style="position:absolute"></svg>`
  const el = tmp.firstElementChild as HTMLElement
  el.setAttribute('data-domoxml-connector', JSON.stringify(c))
  setLineEnds(el, a, b)
  return tmp.innerHTML
}

/** Style changes on a line (colour, width, dash, arrowheads), applied to the payload and redrawn. */
export function styleLine(el: HTMLElement, patch: { color?: string; widthPx?: number; dash?: string; head?: Arrow; tail?: Arrow }) {
  const c = readLine(el)
  const ends = lineEnds(el)
  if (!c || !ends) return
  if (patch.color) {
    const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(patch.color)
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(patch.color)
    if (m) c.line.color = { r: +m[1], g: +m[2], b: +m[3], a: 1 }
    else if (hex) c.line.color = { r: parseInt(hex[1], 16), g: parseInt(hex[2], 16), b: parseInt(hex[3], 16), a: 1 }
  }
  if (patch.widthPx !== undefined) c.line.width_emu = Math.max(1, Math.round(patch.widthPx * EMU))
  if (patch.dash !== undefined) c.line.dash = patch.dash
  if (patch.head !== undefined) c.line.head = patch.head
  if (patch.tail !== undefined) c.line.tail = patch.tail
  el.setAttribute('data-domoxml-connector', JSON.stringify(c))
  setLineEnds(el, ends[0], ends[1])
}
