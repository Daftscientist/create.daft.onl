// Insert (spec: Insert bar): text box, basic shapes, pictures. New objects are centred in the visible
// part of the slide (or placed where dropped), selected, and take the deck's text colour and font.
import { toast } from '../data/toasts'
import { deckTextStyle, insertObject, newId, openDeck } from './ops'

export type ShapeKind = 'rect' | 'rounded' | 'ellipse' | 'triangle' | 'star'
export const SHAPES: { kind: ShapeKind; label: string }[] = [
  { kind: 'rect', label: 'Rectangle' }, { kind: 'rounded', label: 'Rounded rectangle' }, { kind: 'ellipse', label: 'Ellipse' },
  { kind: 'triangle', label: 'Triangle' }, { kind: 'star', label: 'Star' },
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

const STAR = '50% 0%,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%'
export function insertShape(kind: ShapeKind, at: Place) {
  const w = kind === 'rect' || kind === 'rounded' ? 320 : 240, h = 240 * (kind === 'rect' || kind === 'rounded' ? 0.75 : 1)
  const p = centred(at, w, h)
  const fill = 'rgba(232,96,60,1)'
  const extra = kind === 'rounded' ? ';border-radius:24px'
    : kind === 'ellipse' ? ';border-radius:50%'
    : kind === 'triangle' ? ';clip-path:polygon(50% 0%,100% 100%,0% 100%)'
    : kind === 'star' ? `;clip-path:polygon(${STAR})` : ''
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
