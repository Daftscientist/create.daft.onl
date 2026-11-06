// Object geometry in slide px, read from and written to normalized HTML. A top-level object is
// absolutely positioned by left/top/width/height with an optional rotate() (domOXML's output); a
// group is display:contents, so its box is its payload's (EMU), kept in step with its children.
export const EMU_PER_PX = 9525

export type Box = { x: number; y: number; w: number; h: number; rot: number }

const px = (v: string | undefined) => (v && v.endsWith('px') ? parseFloat(v) : v ? parseFloat(v) || 0 : 0)
const round = (n: number) => Math.round(n * 1000) / 1000

export function rotationOf(el: HTMLElement): number {
  const m = /rotate\((-?[\d.]+)deg\)/.exec(el.style.transform)
  return m ? parseFloat(m[1]) : 0
}

/** Base64url JSON payloads (domOXML's data-domoxml-* attributes). */
export function decodePayload<T>(v: string | null): T | null {
  if (!v) return null
  try {
    const b = atob(v.replace(/-/g, '+').replace(/_/g, '/'))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0)))) as T
  } catch { return null }
}
export function encodePayload(v: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(v))
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_')
}

type EmuBox = { x: number; y: number; width: number; height: number }
export type GroupPayload = { box: EmuBox; child_box: EmuBox; transform?: unknown; members: { node_id: string; box?: EmuBox; projected_box?: EmuBox | null; start?: unknown; end?: unknown }[] }

const fromEmu = (b: EmuBox): Box => ({ x: b.x / EMU_PER_PX, y: b.y / EMU_PER_PX, w: b.width / EMU_PER_PX, h: b.height / EMU_PER_PX, rot: 0 })
const toEmu = (b: Box): EmuBox => ({ x: Math.round(b.x * EMU_PER_PX), y: Math.round(b.y * EMU_PER_PX), width: Math.max(1, Math.round(b.w * EMU_PER_PX)), height: Math.max(1, Math.round(b.h * EMU_PER_PX)) })

export const isGroup = (el: Element) => el.classList.contains('domoxml-group')

/** The members of a group (display:contents): its element children. */
export const members = (el: Element) => [...el.children].filter((c): c is HTMLElement => c instanceof HTMLElement || (c as Element).nodeType === 1) as HTMLElement[]

function union(boxes: Box[]): Box {
  if (!boxes.length) return { x: 0, y: 0, w: 0, h: 0, rot: 0 }
  const x = Math.min(...boxes.map((b) => b.x)), y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y, rot: 0 }
}
export { union as unionBox }

/** An object's unrotated box and its rotation (PowerPoint's X/Y/W/H and angle). */
export function boxOf(el: HTMLElement): Box {
  if (isGroup(el)) {
    const p = decodePayload<GroupPayload>(el.getAttribute('data-domoxml-group'))
    return p ? fromEmu(p.box) : union(members(el).map(boxOf))
  }
  const st = el.style
  if (el.tagName.toLowerCase() === 'svg' && !st.width) {
    return { x: px(st.left), y: px(st.top), w: px(el.getAttribute('width') ?? ''), h: px(el.getAttribute('height') ?? ''), rot: rotationOf(el) }
  }
  return { x: px(st.left), y: px(st.top), w: px(st.width), h: px(st.height), rot: rotationOf(el) }
}

function setTransform(el: HTMLElement, rot: number) {
  const rest = el.style.transform.replace(/rotate\([^)]*\)\s*/g, '').trim()
  const t = [rot ? `rotate(${round(rot)}deg)` : '', rest].filter(Boolean).join(' ')
  if (t) el.style.transform = t
  else el.style.removeProperty('transform')
}

/** Kinds of object that redraw for a new size (tables scale their grid, charts redraw). */
export const resizeHooks: ((el: HTMLElement, w: number, h: number) => void)[] = []

/** Writes an object's box. A group maps its members (and its payload) from the old box to the new one. */
export function setBox(el: HTMLElement, b: Box) {
  if (isGroup(el)) {
    const old = boxOf(el)
    const sx = old.w ? b.w / old.w : 1, sy = old.h ? b.h / old.h : 1
    const map = (c: Box): Box => ({ x: b.x + (c.x - old.x) * sx, y: b.y + (c.y - old.y) * sy, w: c.w * sx, h: c.h * sy, rot: c.rot })
    for (const m of members(el)) setBox(m, map(boxOf(m)))
    const p = decodePayload<GroupPayload>(el.getAttribute('data-domoxml-group'))
    if (p) {
      const mapEmu = (e: EmuBox) => toEmu(map(fromEmu(e)))
      p.box = mapEmu(p.box)
      p.members = p.members.map((m) => (m.projected_box ? { ...m, projected_box: mapEmu(m.projected_box) } : m))
      el.setAttribute('data-domoxml-group', encodePayload(p))
    }
    return
  }
  for (const hook of resizeHooks) hook(el, Math.max(1, b.w), Math.max(1, b.h))
  el.style.left = `${round(b.x)}px`
  el.style.top = `${round(b.y)}px`
  el.style.width = `${round(Math.max(1, b.w))}px`
  el.style.height = `${round(Math.max(1, b.h))}px`
  if (el.tagName.toLowerCase() === 'svg') { el.removeAttribute('width'); el.removeAttribute('height'); el.setAttribute('preserveAspectRatio', 'none') }
  setTransform(el, b.rot)
}

/** Makes a group payload for objects grouped in Ream, so the export keeps them a PowerPoint group. */
export function groupPayload(items: HTMLElement[]): string {
  const u = toEmu(union(items.map(boxOf)))
  return encodePayload({
    box: u, child_box: u, transform: null,
    members: items.map((m) => ({ node_id: m.getAttribute('data-domoxml-node-id')!, box: toEmu(boxOf(m)), projected_box: toEmu(boxOf(m)) })),
  })
}

/** The axis-aligned bounds of a (possibly rotated) box. */
export function bounds(b: Box): Box {
  if (!b.rot) return b
  const r = (b.rot * Math.PI) / 180
  const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r))
  const w = b.w * c + b.h * s, h = b.w * s + b.h * c
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h, rot: 0 }
}
