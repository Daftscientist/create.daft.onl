// Insert (spec: Insert bar): text box, basic shapes, pictures. New objects are centred in the visible
// part of the slide (or placed where dropped), selected, and take the deck's text colour and font.
import { toast } from '../data/toasts'
import { deckTextStyle, insertObject, newId, openDeck } from './ops'
import { lineHtml } from './line'

// Polygons are domOXML's own preset outlines (domoxml/core/drawingml/presets.py), so each exports as the native
// PowerPoint shape, not a freeform.
const POLY = {
  triangle: '50% 0%,100% 100%,0% 100%', rtTriangle: '0% 0%,100% 100%,0% 100%', diamond: '50% 0%,100% 50%,50% 100%,0% 50%',
  pentagon: '50% 0%,97.55% 34.55%,79.39% 90.45%,20.61% 90.45%,2.45% 34.55%', hexagon: '25% 0%,75% 0%,100% 50%,75% 100%,25% 100%,0% 50%',
  octagon: '29.29% 0%,70.71% 0%,100% 29.29%,100% 70.71%,70.71% 100%,29.29% 100%,0% 70.71%,0% 29.29%',
  parallelogram: '25% 0%,100% 0%,75% 100%,0% 100%', trapezoid: '25% 0%,75% 0%,100% 100%,0% 100%',
  plus: '25% 0%,75% 0%,75% 25%,100% 25%,100% 75%,75% 75%,75% 100%,25% 100%,25% 75%,0% 75%,0% 25%,25% 25%',
  rightArrow: '0% 25%,50% 25%,50% 0%,100% 50%,50% 100%,50% 75%,0% 75%', leftArrow: '0% 50%,50% 0%,50% 25%,100% 25%,100% 75%,50% 75%,50% 100%',
  upArrow: '50% 0%,100% 50%,75% 50%,75% 100%,25% 100%,25% 50%,0% 50%', downArrow: '25% 0%,75% 0%,75% 50%,100% 50%,50% 100%,0% 50%,25% 50%',
  chevron: '0% 0%,50% 0%,100% 50%,50% 100%,0% 100%,50% 50%',
  star: '50% 0%,61.23% 34.55%,97.55% 34.55%,68.16% 55.9%,79.39% 90.45%,50% 69.1%,20.61% 90.45%,31.84% 55.9%,2.45% 34.55%,38.77% 34.55%',
  star4: '50% 0%,58.84% 41.16%,100% 50%,58.84% 58.84%,50% 100%,41.16% 58.84%,0% 50%,41.16% 41.16%',
} as const

export type ShapeKind = 'rect' | 'rounded' | 'ellipse' | 'line' | 'arrow' | keyof typeof POLY
export type ShapeGroup = 'Lines' | 'Basic shapes' | 'Arrows and stars'
export const SHAPES: { kind: ShapeKind; label: string; group: ShapeGroup; poly?: string }[] = [
  { kind: 'line', label: 'Line', group: 'Lines' }, { kind: 'arrow', label: 'Arrow', group: 'Lines' },
  { kind: 'rect', label: 'Rectangle', group: 'Basic shapes' }, { kind: 'rounded', label: 'Rounded rectangle', group: 'Basic shapes' },
  { kind: 'ellipse', label: 'Ellipse', group: 'Basic shapes' },
  ...([['triangle', 'Triangle'], ['rtTriangle', 'Right triangle'], ['diamond', 'Diamond'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'],
    ['octagon', 'Octagon'], ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['plus', 'Plus']] as const).map(([kind, label]) => ({ kind, label, group: 'Basic shapes' as const, poly: POLY[kind] })),
  ...([['rightArrow', 'Right arrow'], ['leftArrow', 'Left arrow'], ['upArrow', 'Up arrow'], ['downArrow', 'Down arrow'], ['chevron', 'Chevron'],
    ['star', 'Star'], ['star4', '4-point star']] as const).map(([kind, label]) => ({ kind, label, group: 'Arrows and stars' as const, poly: POLY[kind] })),
]

const esc = (t: string) => t.replace(/"/g, '&quot;')
const pos = (x: number, y: number, w: number, h: number) => `position:absolute;box-sizing:border-box;left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(w)}px;height:${Math.round(h)}px`

/** Where a new object goes: centred on `at` (slide px), or on the visible part of the slide. */
export type Place = { x: number; y: number }
const centred = (at: Place, w: number, h: number) => ({ x: at.x - w / 2, y: at.y - h / 2 })

export function insertText(at: Place) {
  const deck = openDeck()
  if (!deck) return
  const { color, font } = deckTextStyle(deck)
  const w = 480, h = 56
  const p = centred(at, w, h)
  const id = newId()
  insertObject(
    `<div class="domoxml-shape" data-domoxml-node-id="${id}" data-domoxml-text-body="true" data-ream-autogrow data-ream-empty style="${pos(p.x, p.y, w, h)};padding:7.5px 10px">`
    + `<div class="domoxml-text" style="white-space:pre-wrap;text-align:left"><span style="${esc(`font-family:${font};font-size:24pt;font-weight:400;font-style:normal;color:${color}`)}"><br></span></div></div>`,
    'Insert text box', { edit: true },
  )
}

export function insertShape(kind: ShapeKind, at: Place) {
  if (kind === 'line' || kind === 'arrow') {
    const deck = openDeck()
    const hex = deck ? deckTextStyle(deck).color : 'rgba(23,23,28,1)'
    const m = /rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(hex)
    const color = m ? { r: +m[1], g: +m[2], b: +m[3] } : { r: 23, g: 23, b: 28 }
    insertObject(lineHtml(newId('line'), { x: at.x - 160, y: at.y }, { x: at.x + 160, y: at.y }, color, 3, kind === 'arrow'), `Insert ${kind}`)
    return
  }
  const wide = (['rect', 'rounded', 'parallelogram', 'trapezoid', 'rightArrow', 'leftArrow'] as ShapeKind[]).includes(kind)
  const w = wide ? 320 : 240, h = wide ? 180 : 240
  const p = centred(at, w, h)
  const fill = 'rgba(232,96,60,1)'
  const poly = SHAPES.find((x) => x.kind === kind)?.poly
  const extra = kind === 'rounded' ? ';border-radius:24px' : kind === 'ellipse' ? ';border-radius:50%' : poly ? `;clip-path:polygon(${poly})` : ''
  insertObject(`<div class="domoxml-shape" data-domoxml-node-id="${newId()}" data-ream-shape="${kind}" style="${pos(p.x, p.y, w, h)};background-color:${fill}${extra}"></div>`, `Insert ${SHAPES.find((x) => x.kind === kind)!.label.toLowerCase()}`)
}

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
const MAX_EDGE = 2400

/** Pictures come in at up to 2400px on the long edge (plenty for a slide), in their own format. */
export async function insertPicture(file: File, at: Place, slide: { w: number; h: number }) {
  if (!PICTURE_TYPES.includes(file.type)) { toast({ message: 'That file isn’t a picture Ream can use (PNG, JPEG, GIF, WebP, SVG).', tone: 'danger' }); return }
  let src: string, nw: number, nh: number
  try { ({ src, nw, nh } = await readPicture(file)) } catch { toast({ message: 'Couldn’t read that picture.', tone: 'danger' }); return }
  // Fit within 60% of the slide, keeping its aspect.
  const k = Math.min(1, (slide.w * 0.6) / nw, (slide.h * 0.6) / nh)
  const w = nw * k, h = nh * k
  const p = centred(at, w, h)
  insertObject(`<img class="domoxml-shape" data-domoxml-node-id="${newId()}" src="${src}" alt="" style="${pos(p.x, p.y, w, h)};object-fit:fill">`, 'Insert picture')
}

/** Replaces a picture's image, keeping its frame (spec: Picture → Replace). */
export async function readPicture(file: File): Promise<{ src: string; nw: number; nh: number }> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const nw = img.naturalWidth || 400, nh = img.naturalHeight || 300
    if (file.type === 'image/svg+xml' || file.type === 'image/gif' || Math.max(nw, nh) <= MAX_EDGE) return { src: await dataUrl(file), nw, nh }
    const k = MAX_EDGE / Math.max(nw, nh)
    const c = document.createElement('canvas')
    c.width = Math.round(nw * k); c.height = Math.round(nh * k)
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
    return { src: c.toDataURL(file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg', 0.9), nw, nh }
  } finally { URL.revokeObjectURL(url) }
}

const dataUrl = (f: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.onerror = () => rej(r.error); r.readAsDataURL(f) })

export function pickPicture(): Promise<File | null> {
  return new Promise((res) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: PICTURE_TYPES.join(',') })
    input.onchange = () => res(input.files?.[0] ?? null)
    input.oncancel = () => res(null)
    input.click()
  })
}
