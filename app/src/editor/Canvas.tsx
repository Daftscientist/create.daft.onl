// The editor's stage (spec: Canvas and slide, Selection frame and handles, Smart guides). The slide is
// paper on an untinted ground; selection, handles, guides and the readout live in an overlay above the
// slide's shadow root, so they never touch its HTML. Gestures preview on the live DOM and commit once.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Deck, SlideDoc } from '../data/types'
import { SlideView } from '../slides/SlideView'
import { bounds, boxOf, isGroup, members, setBox, unionBox, type Box } from './geometry'
import { editSlide, find, hasText, setBoxes, textHost } from './ops'
import { isLine, lineEnds, setLineEnds, type Pt } from './line'
import { getEditor, select, setEditor, useEditor } from './session'
import { snapEdges, snapMove, type Guide } from './snap'
import { beginEdit, editingLive, endEdit, fitHeight, onTextChange } from './textctl'
import { CommentPins, startComment } from './CommentPins'
import { updateSlides } from '../data/library'
import { formatLength, localUnit } from './units'
import s from './Canvas.module.css'

const PAD = 48
type Dir = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'
const DIRS: Record<Dir, [number, number]> = { n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0], nw: [-1, -1] }
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize']

type Gesture =
  | { kind: 'move'; start: { x: number; y: number }; orig: Map<string, Box>; moved: boolean; reselect?: string }
  | { kind: 'resize'; dir: Dir; start: { x: number; y: number }; orig: Map<string, Box>; union: Box }
  | { kind: 'rotate'; id: string; orig: Box }
  | { kind: 'end'; id: string; which: 0 | 1; ends: [Pt, Pt] }
  | { kind: 'marquee'; start: { x: number; y: number }; base: string[] }
  | { kind: 'pinch'; d0: number; z0: number }
  | { kind: 'pan'; start: { x: number; y: number }; scroll: { l: number; t: number } }

let stageEl: HTMLDivElement | null = null
let fitNow = 0.5
let centreNow: () => { x: number; y: number } = () => ({ x: 640, y: 360 })
let pointNow: (cx: number, cy: number) => { x: number; y: number } = (x, y) => ({ x, y })
/** The live stage (inside the slide's shadow root) of the open editor. */
export const liveStage = () => stageEl
/** The zoom that fits the slide in the stage. */
export const currentFit = () => fitNow
/** The centre of the visible part of the slide (slide px): where inserted objects go. */
export const visibleCentre = () => centreNow()
/** A client point in slide px. */
export const slidePoint = (cx: number, cy: number) => pointNow(cx, cy)

export function Canvas({ deck, slide, label, readOnly = false }: { deck: Deck; slide: SlideDoc; label: string; readOnly?: boolean }) {
  const size = deck.size ?? { w: 1280, h: 720 }
  const vp = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const [vpSize, setVpSize] = useState({ w: 0, h: 0 })
  const zoomPref = useEditor((e) => e.zoom)
  const sel = useEditor((e) => e.sel)
  const scope = useEditor((e) => e.scope)
  const editing = useEditor((e) => e.editing)
  const locked = useEditor((e) => e.locked).includes(slide.id) || readOnly
  const commenting = useEditor((e) => e.commenting)
  const [, setTick] = useState(0)
  const rerender = useCallback(() => setTick((t) => t + 1), [])
  const gesture = useRef<Gesture | null>(null)
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const [dragging, setDragging] = useState(false)
  const [guides, setGuides] = useState<Guide[]>([])
  const [marquee, setMarquee] = useState<Box | null>(null)
  const [readout, setReadout] = useState<{ x: number; y: number; text: string } | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const [space, setSpace] = useState(false)
  const [stage, setStage] = useState<HTMLDivElement | null>(null)
  const [announce, setAnnounce] = useState('')
  const caretAt = useRef<{ x: number; y: number } | null>(null)

  const fit = vpSize.w ? Math.max(0.05, Math.min((vpSize.w - PAD * 2) / size.w, (vpSize.h - PAD * 2) / size.h)) : 0.5
  const z = zoomPref === 'fit' ? fit : zoomPref
  fitNow = fit
  centreNow = () => {
    const v = vp.current?.getBoundingClientRect(), h = host.current?.getBoundingClientRect()
    if (!v || !h) return { x: size.w / 2, y: size.h / 2 }
    const l = Math.max(v.left, h.left), r = Math.min(v.right, h.right), t = Math.max(v.top, h.top), b = Math.min(v.bottom, h.bottom)
    if (r <= l || b <= t) return { x: size.w / 2, y: size.h / 2 }
    return { x: ((l + r) / 2 - h.left) / z, y: ((t + b) / 2 - h.top) / z }
  }
  pointNow = (cx, cy) => { const h = host.current!.getBoundingClientRect(); return { x: (cx - h.left) / z, y: (cy - h.top) / z } }

  useLayoutEffect(() => {
    const el = vp.current!
    const ro = new ResizeObserver(() => setVpSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => onTextChange(rerender), [rerender])
  useEffect(() => { stageEl = stage; return () => { if (stageEl === stage) stageEl = null } }, [stage])

  // Zoom keeps the stage centre (or the cursor, for ⌘-wheel) fixed.
  const lastZ = useRef(z)
  const zoomAnchor = useRef<{ cx: number; cy: number } | null>(null)
  useLayoutEffect(() => {
    const el = vp.current
    if (!el || lastZ.current === z) return
    const a = zoomAnchor.current ?? { cx: el.clientWidth / 2, cy: el.clientHeight / 2 }
    const sx = (el.scrollLeft + a.cx - offset(lastZ.current).x) / lastZ.current
    const sy = (el.scrollTop + a.cy - offset(lastZ.current).y) / lastZ.current
    lastZ.current = z
    zoomAnchor.current = null
    el.scrollLeft = sx * z + offset(z).x - a.cx
    el.scrollTop = sy * z + offset(z).y - a.cy
  })
  const world = (zz: number) => ({ w: Math.max(vpSize.w, size.w * zz + PAD * 2), h: Math.max(vpSize.h, size.h * zz + PAD * 2) })
  const offset = (zz: number) => { const wd = world(zz); return { x: (wd.w - size.w * zz) / 2, y: (wd.h - size.h * zz) / 2 } }
  const wsize = world(z)
  const off = offset(z)

  // ---------- reading the live slide ----------
  const live = (id: string) => stage?.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(id)}"]`) ?? null
  // Ask's changes landing on this slide: new objects fade in, changed ones get a brief glow (spec: streaming edits).
  const [glows, setGlows] = useState<{ key: number; box: Box }[]>([])
  const glowed = useRef(new Map<string, number>())
  useEffect(() => {
    let n = 0
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ slideId: string; nodes: string[]; fresh?: string[]; added: boolean }>).detail
      if (d.slideId !== slide.id) return
      requestAnimationFrame(() => {
        const calm = document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches
        const fresh: { key: number; box: Box }[] = []
        const now = performance.now()
        for (const id of d.nodes.slice(0, 40)) {
          const el = live(id)
          if (!el) continue
          // A glow at most every 1.5s per object (drafts update it several times a second); only new ones fade in.
          if (now - (glowed.current.get(id) ?? -1e9) > 1500) { glowed.current.set(id, now); fresh.push({ key: ++n, box: bounds(boxOf(el)) }) }
          if (!calm && (d.fresh ?? []).includes(id)) el.animate([{ opacity: 0, transform: `${el.style.transform || ''} translateY(8px)`.trim() }, { opacity: 1, transform: el.style.transform || 'none' }], { duration: 320, easing: 'cubic-bezier(.2,.8,.2,1)' })
        }
        setGlows((g) => [...g, ...fresh])
        setTimeout(() => setGlows((g) => g.filter((x) => !fresh.includes(x))), 1400)
      })
    }
    addEventListener('ream:ai-edit', on)
    return () => removeEventListener('ream:ai-edit', on)
  }, [slide.id, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  const slideRoot = () => stage?.querySelector<HTMLElement>('.domoxml-slide') ?? null
  const scopeEl = () => (scope ? live(scope) : null)
  /** The objects that can be picked at this level: the slide's, or the entered group's members. */
  const pickable = (): HTMLElement[] => {
    const g = scopeEl()
    const list = g ? members(g) : [...(slideRoot()?.children ?? [])] as HTMLElement[]
    return list.filter((el) => el.hasAttribute('data-domoxml-node-id') && !el.hasAttribute('data-ream-locked'))
  }
  const idOf = (el: Element) => el.getAttribute('data-domoxml-node-id')!

  const toSlide = (cx: number, cy: number) => {
    const r = host.current!.getBoundingClientRect()
    return { x: (cx - r.left) / z, y: (cy - r.top) / z }
  }

  /** Objects under a point, topmost first, mapped to the current level (top-level or group member). */
  const hitsAt = (cx: number, cy: number): string[] => {
    const root = stage?.getRootNode() as ShadowRoot | undefined
    const slideEl = slideRoot()
    if (!root || !slideEl) return []
    const g = scopeEl()
    const out: string[] = []
    for (const el of root.elementsFromPoint(cx, cy)) {
      let cur: Element | null = el
      while (cur && cur.parentElement && cur.parentElement !== slideEl && cur.parentElement !== g) cur = cur.parentElement
      if (!cur || !cur.parentElement || cur === slideEl) continue
      if (cur === g) continue
      const id = cur.getAttribute('data-domoxml-node-id')
      if (!id || cur.hasAttribute('data-ream-locked') || out.includes(id)) continue
      out.push(id)
    }
    return out
  }
  const memberHit = (cx: number, cy: number, groupId: string): string | null => {
    const root = stage?.getRootNode() as ShadowRoot | undefined
    const g = live(groupId)
    if (!root || !g) return null
    for (const el of root.elementsFromPoint(cx, cy)) {
      let cur: Element | null = el
      while (cur && cur.parentElement && cur.parentElement !== g) cur = cur.parentElement
      if (cur?.parentElement === g) return idOf(cur)
    }
    return null
  }

  // ---------- gestures ----------
  const threshold = 6 / z
  const others = (ids: string[]) => pickable().filter((el) => !ids.includes(idOf(el))).map((el) => bounds(boxOf(el)))

  const onPointerDown = (e: React.PointerEvent) => {
    // Touch: two fingers pinch to zoom (whatever the first finger was doing is cancelled).
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.current.size === 2) {
        if (gesture.current && gesture.current.kind !== 'pan') finish(true)
        const [a, b] = [...touches.current.values()]
        gesture.current = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: zoomPref === 'fit' ? fit : zoomPref }
        return
      }
    }
    if (e.button === 1 || space) {
      e.preventDefault()
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, scroll: { l: vp.current!.scrollLeft, t: vp.current!.scrollTop } }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (e.button !== 0 && e.button !== 2) return
    // Comment mode: this click drops a comment pin here.
    if (getEditor().commenting && e.button === 0) { e.preventDefault(); startComment(toSlide(e.clientX, e.clientY)); return }
    const target = e.target as HTMLElement
    const handle = target.closest<HTMLElement>('[data-handle]')
    const ed = editingLive()
    if (ed && e.nativeEvent.composedPath().includes(ed.host)) return // the caret is the text editor's
    if (locked) return
    // No native image drag or text selection on the stage: the editor owns the pointer.
    e.preventDefault()
    vp.current?.focus({ preventScroll: true, focusVisible: false } as FocusOptions)
    const p = toSlide(e.clientX, e.clientY)
    if (handle && e.button === 0) {
      if (ed) endEdit()
      const kind = handle.dataset.handle!
      const orig = new Map(sel.map((id) => [id, boxOf(live(id)!)] as const).filter(([, b]) => b))
      if (kind === 'end0' || kind === 'end1') { const ends = lineEnds(live(sel[0])!); if (ends) gesture.current = { kind: 'end', id: sel[0], which: kind === 'end0' ? 0 : 1, ends } }
      else if (kind === 'rotate') gesture.current = { kind: 'rotate', id: sel[0], orig: orig.get(sel[0])! }
      else gesture.current = { kind: 'resize', dir: kind as Dir, start: p, orig, union: unionBox([...orig.values()].map(bounds)) }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      setDragging(true)
      return
    }
    if (ed) endEdit()
    const hits = hitsAt(e.clientX, e.clientY)
    // A click outside the entered group leaves it.
    if (scope && !(hits[0] && live(scope)?.contains(live(hits[0])))) setEditor({ scope: null })
    if (e.button === 2) { if (hits[0] && !sel.includes(hits[0])) select([hits[0]]); else if (!hits.length) select([]); return }
    if (!hits.length && e.pointerType === 'touch') {
      // A finger on empty slide pans (as on an iPad); a tap there clears the selection.
      select([])
      gesture.current = { kind: 'pan', start: { x: e.clientX, y: e.clientY }, scroll: { l: vp.current!.scrollLeft, t: vp.current!.scrollTop } }
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    if (!hits.length) {
      gesture.current = { kind: 'marquee', start: p, base: e.shiftKey ? sel : [] }
      if (!e.shiftKey) select([])
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
      return
    }
    let id = hits[0]
    if (e.altKey && hits.length > 1) {
      // ⌥-click: the next object underneath, cycling.
      const i = hits.indexOf(sel[0])
      id = hits[(i + 1) % hits.length]
    }
    let nextSel = sel
    let reselect: string | undefined
    if (e.shiftKey || e.metaKey) nextSel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
    else if (!sel.includes(id)) nextSel = [id]
    else reselect = id // a click (not a drag) on a member of a multi-selection selects just it
    if (nextSel !== sel) select(nextSel)
    if (!nextSel.includes(id)) return
    const movable = nextSel.filter((x) => { const el = live(x); return el && !el.hasAttribute('data-ream-locked') })
    gesture.current = { kind: 'move', start: p, orig: new Map(movable.map((x) => [x, boxOf(live(x)!)])), moved: false, reselect }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const g = gesture.current
    if (g?.kind === 'pinch') {
      if (touches.current.size < 2) return
      const [a, b] = [...touches.current.values()]
      const r = vp.current!.getBoundingClientRect()
      zoomAnchor.current = { cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top }
      setEditor({ zoom: clampZoom(g.z0 * Math.hypot(a.x - b.x, a.y - b.y) / g.d0) })
      return
    }
    if (!g) {
      if (e.pointerType === 'mouse' && !dragging) { const h = hitsAt(e.clientX, e.clientY)[0] ?? null; if (h !== hover) setHover(h) }
      return
    }
    if (g.kind === 'pan') { vp.current!.scrollLeft = g.scroll.l - (e.clientX - g.start.x); vp.current!.scrollTop = g.scroll.t - (e.clientY - g.start.y); return }
    const p = toSlide(e.clientX, e.clientY)
    const snapOn = !(e.metaKey || e.ctrlKey)
    const unit = localUnit()
    if (g.kind === 'move') {
      let dx = p.x - g.start.x, dy = p.y - g.start.y
      if (!g.moved && Math.hypot(dx * z, dy * z) < 3) return
      if (!g.moved) { g.moved = true; setDragging(true); setHover(null) }
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 } // ⇧ constrains to an axis
      const u = unionBox([...g.orig.values()].map(bounds))
      let gs: Guide[] = []
      if (snapOn) {
        const sn = snapMove({ ...u, x: u.x + dx, y: u.y + dy }, others([...g.orig.keys()]), size, threshold)
        dx += sn.dx; dy += sn.dy; gs = sn.guides
      }
      for (const [id, b] of g.orig) { const el = live(id); if (el) setBox(el, { ...b, x: b.x + dx, y: b.y + dy }) }
      setGuides(gs)
      const first = [...g.orig.values()][0]
      setReadout({ x: e.clientX, y: e.clientY, text: `X ${formatLength(first.x + dx, unit)} · Y ${formatLength(first.y + dy, unit)}` })
      rerender()
    } else if (g.kind === 'resize') {
      const one = g.orig.size === 1 ? [...g.orig][0] : null
      const keep = e.shiftKey !== (one ? live(one[0])?.tagName === 'IMG' || !!live(one[0])?.querySelector('img:only-child') : false)
      let gs: Guide[] = []
      if (one) {
        const [id, b] = one
        let nb = resizeBox(b, g.dir, p, keep, e.altKey)
        if (snapOn && !b.rot && !keep) { const [hx, hy] = DIRS[g.dir]; const sn = snapEdges(nb, { l: hx < 0, r: hx > 0, t: hy < 0, b: hy > 0 }, others([id]), size, threshold); nb = sn.box; gs = sn.guides }
        const el = live(id)
        if (el) setBox(el, nb)
        setReadout({ x: e.clientX, y: e.clientY, text: `${formatLength(nb.w, unit)} × ${formatLength(nb.h, unit)}` })
      } else {
        // Several objects scale proportionally (spec), so rotated members never shear; ⇧ frees it.
        const nu = resizeBox(g.union, g.dir, p, !e.shiftKey, e.altKey)
        const sx = g.union.w ? nu.w / g.union.w : 1, sy = g.union.h ? nu.h / g.union.h : 1
        for (const [id, b] of g.orig) {
          const el = live(id)
          if (el) setBox(el, { x: nu.x + (b.x - g.union.x) * sx, y: nu.y + (b.y - g.union.y) * sy, w: b.w * sx, h: b.h * sy, rot: b.rot })
        }
        setReadout({ x: e.clientX, y: e.clientY, text: `${formatLength(nu.w, unit)} × ${formatLength(nu.h, unit)}` })
      }
      setGuides(gs)
      rerender()
    } else if (g.kind === 'end') {
      const other = g.ends[g.which ? 0 : 1]
      let q = { x: p.x, y: p.y }
      if (e.shiftKey) {
        // ⇧ keeps the line at multiples of 45°.
        const a = Math.round(Math.atan2(q.y - other.y, q.x - other.x) / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.hypot(q.x - other.x, q.y - other.y)
        q = { x: other.x + Math.cos(a) * len, y: other.y + Math.sin(a) * len }
      } else if (snapOn) {
        const sn = snapMove({ x: q.x, y: q.y, w: 0, h: 0, rot: 0 }, others([g.id]), size, threshold)
        q = { x: q.x + sn.dx, y: q.y + sn.dy }
        setGuides(sn.guides)
      }
      const el = live(g.id)
      if (el) setLineEnds(el, g.which ? other : q, g.which ? q : other)
      setReadout({ x: e.clientX, y: e.clientY, text: `${formatLength(Math.hypot(q.x - other.x, q.y - other.y), unit)} · ${Math.round(((Math.atan2(other.y - q.y, q.x - other.x) * 180) / Math.PI + 360) % 360)}°` })
      rerender()
    } else if (g.kind === 'rotate') {
      const c = { x: g.orig.x + g.orig.w / 2, y: g.orig.y + g.orig.h / 2 }
      let a = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90
      if (e.shiftKey) a = Math.round(a / 15) * 15
      a = ((Math.round(a * 10) / 10) % 360 + 360) % 360
      const el = live(g.id)
      if (el) setBox(el, { ...g.orig, rot: a })
      setReadout({ x: e.clientX, y: e.clientY, text: `${Math.round(a)}°` })
      rerender()
    } else if (g.kind === 'marquee') {
      const r = { x: Math.min(g.start.x, p.x), y: Math.min(g.start.y, p.y), w: Math.abs(p.x - g.start.x), h: Math.abs(p.y - g.start.y), rot: 0 }
      setMarquee(r)
      const touched = pickable().filter((el) => { const b = bounds(boxOf(el)); return b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y }).map(idOf)
      const next = [...new Set([...g.base, ...touched])]
      if (next.join() !== getEditor().sel.join()) select(next)
    }
  }

  const finish = (cancel: boolean) => {
    const g = gesture.current
    if (g?.kind === 'pinch') { if (touches.current.size < 2) gesture.current = null; return }
    gesture.current = null
    setGuides([]); setMarquee(null); setReadout(null); setDragging(false)
    if (!g) return
    if (g.kind === 'end') {
      const el = live(g.id)
      const ends = el && lineEnds(el)
      if (cancel || !ends) { if (el) setLineEnds(el, g.ends[0], g.ends[1]); rerender(); return }
      editSlide('Move line end', (root) => { const x = find(root, g.id); if (!x) return false; setLineEnds(x, ends[0], ends[1]) })
      return
    }
    if (g.kind === 'move' || g.kind === 'resize' || g.kind === 'rotate') {
      const ids = g.kind === 'rotate' ? [g.id] : [...g.orig.keys()]
      const orig = g.kind === 'rotate' ? new Map([[g.id, g.orig]]) : g.orig
      if (cancel) { for (const id of ids) { const el = live(id); if (el) setBox(el, orig.get(id)!) } rerender(); return }
      if (g.kind === 'move' && !g.moved) { if (g.reselect) select([g.reselect]); return }
      const boxes = new Map(ids.map((id) => [id, boxOf(live(id)!)] as const))
      setBoxes(boxes, g.kind === 'move' ? 'Move' : g.kind === 'resize' ? 'Resize' : 'Rotate')
    }
  }

  // Esc during a drag cancels it (spec: Esc ladder step 1).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && gesture.current && gesture.current.kind !== 'pan') { e.preventDefault(); e.stopImmediatePropagation(); finish(true) } }
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !editingLive() && !(e.target as HTMLElement).matches('input, textarea, [contenteditable]') && document.activeElement === vp.current) { e.preventDefault(); setSpace(true) } }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false) }
    addEventListener('keydown', onKey, true)
    addEventListener('keydown', down)
    addEventListener('keyup', up)
    return () => { removeEventListener('keydown', onKey, true); removeEventListener('keydown', down); removeEventListener('keyup', up) }
  })

  const onDoubleClick = (e: React.MouseEvent) => {
    if (locked) return
    const ed = editingLive()
    if (ed && e.nativeEvent.composedPath().includes(ed.host)) return
    const id = hitsAt(e.clientX, e.clientY)[0]
    if (!id) return
    const el = live(id)
    if (!el) return
    if (isGroup(el) && !scope) {
      const m = memberHit(e.clientX, e.clientY, id)
      setEditor({ scope: id, sel: m ? [m] : [], editing: null })
      return
    }
    if (canEditText(el)) { caretAt.current = { x: e.clientX, y: e.clientY }; setEditor({ sel: [id], editing: id }) }
  }

  useEffect(() => {
    if (!stage) return
    const els = sel.map((id) => live(id)).filter((e): e is HTMLElement => !!e)
    setAnnounce(els.length === 1 ? `${describe(els[0])}, selected` : els.length ? `${els.length} objects selected` : '')
  }, [sel.join(','), stage]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-growing boxes keep fitting their text after any change (formatting from the Format column,
  // undo, the AI): the height is corrected in place, without a history entry of its own.
  useEffect(() => {
    if (!stage || dragging || editingLive()) return
    const fixes = new Map<string, number>()
    for (const el of stage.querySelectorAll<HTMLElement>('[data-ream-autogrow]')) {
      const h = fitHeight(el)
      if (h && Math.abs(h - parseFloat(el.style.height)) > 1) fixes.set(idOf(el), h)
    }
    if (!fixes.size) return
    const cur = deck.slides.find((x) => x.id === slide.id)
    if (!cur) return
    const root = new DOMParser().parseFromString(`<body>${cur.html}</body>`, 'text/html').body.querySelector('.domoxml-slide')!
    for (const [id, h] of fixes) { const el = root.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(id)}"]`); if (el) el.style.height = `${h}px` }
    updateSlides(deck.id, deck.slides.map((x) => (x.id === slide.id ? { ...x, html: root.outerHTML } : x)))
  }, [slide.html, stage, dragging]) // eslint-disable-line react-hooks/exhaustive-deps

  // Text editing follows the session (Enter, double-click, a new text box).
  useEffect(() => {
    if (!stage) return
    const ed = editingLive()
    if (editing && ed?.id !== editing) { const el = live(editing); if (el && canEditText(el)) beginEdit(stage, editing, caretAt.current ?? undefined); else setEditor({ editing: null }) }
    caretAt.current = null
    if (!editing && ed) endEdit()
  }, [editing, stage]) // eslint-disable-line react-hooks/exhaustive-deps
  // Leaving the slide (or the editor) ends the edit.
  useEffect(() => () => endEdit(), [slide.id])

  // ⌘/Ctrl + wheel or pinch zooms around the cursor.
  useEffect(() => {
    const el = vp.current!
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      const r = el.getBoundingClientRect()
      zoomAnchor.current = { cx: e.clientX - r.left, cy: e.clientY - r.top }
      const cur = getEditor().zoom === 'fit' ? fit : (getEditor().zoom as number)
      setEditor({ zoom: clampZoom(cur * Math.exp(-e.deltaY * 0.01)) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [fit])

  // ---------- overlay ----------
  const selEls = sel.map((id) => [id, live(id)] as const).filter((x): x is readonly [string, HTMLElement] => !!x[1])
  const boxes = selEls.map(([id, el]) => ({ id, el, b: boxOf(el) }))
  const single = boxes.length === 1 ? boxes[0] : null
  const frame: Box | null = single ? single.b : boxes.length > 1 ? unionBox(boxes.map((x) => bounds(x.b))) : null
  const isEditing = !!editing && editing === single?.id
  const anyLocked = boxes.some((x) => x.el.hasAttribute('data-ream-locked'))
  const scr = (b: Box) => ({ left: b.x * z, top: b.y * z, width: b.w * z, height: b.h * z, transform: b.rot ? `rotate(${b.rot}deg)` : undefined })
  const hoverBox = hover && !sel.includes(hover) && !dragging ? (() => { const el = live(hover); return el ? boxOf(el) : null })() : null
  const scopeBox = scope ? (() => { const g = live(scope); return g ? unionBox(members(g).map((m) => bounds(boxOf(m)))) : null })() : null

  const handles = (b: Box) => {
    if (anyLocked || isEditing) return null
    const w = b.w * z, h = b.h * z
    const dirs: Dir[] = w < 12 || h < 12 ? ['se'] : w < 24 || h < 24 ? ['nw', 'ne', 'se', 'sw'] : ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
    const rot = single?.b.rot ?? 0
    return dirs.map((d) => {
      const [hx, hy] = DIRS[d]
      const base = d === 'n' || d === 's' ? 0 : d === 'ne' || d === 'sw' ? 1 : d === 'e' || d === 'w' ? 2 : 3
      const cursor = CURSORS[(((base + Math.round(rot / 45)) % 4) + 4) % 4]
      return <span key={d} data-handle={d} className={s.handle} style={{ left: `${50 + hx * 50}%`, top: `${50 + hy * 50}%`, cursor }} />
    })
  }
  const canRotate = single && !isGroup(single.el) && !isLine(single.el) && !anyLocked && !isEditing

  return (
    <div
      ref={vp}
      className={s.viewport}
      data-stage
      data-region="stage"
      tabIndex={0}
      role="group"
      aria-label={label}
      aria-describedby="stage-objects"
      aria-activedescendant={sel[0] ? `obj-${sel[0]}` : undefined}
      data-space={space || undefined}
      data-commenting={commenting || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => { touches.current.delete(e.pointerId); finish(false) }}
      onPointerCancel={(e) => { touches.current.delete(e.pointerId); finish(true) }}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        // In text being edited: our text menu (⇧ right-click keeps the browser's, for spelling suggestions).
        const inText = !!editingLive() && e.nativeEvent.composedPath().includes(editingLive()!.host)
        if (inText && e.shiftKey) return
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('ream:canvas-menu', { detail: { x: e.clientX, y: e.clientY, text: inText } }))
      }}
    >
      <div className={s.world} style={{ width: wsize.w, height: wsize.h }}>
        <div ref={host} className={s.paper} style={{ left: off.x, top: off.y, width: size.w * z, height: size.h * z }}>
          <SlideView slide={slide} size={size} css={deck.css} editor hold={dragging || (!!editing && editingLive()?.id === editing)} onStage={setStage} />
        </div>
        <div className={s.overlay} style={{ left: off.x, top: off.y, width: size.w * z, height: size.h * z }} aria-hidden>
          {scopeBox && <div className={s.scope} style={scr(scopeBox)} />}
          {hoverBox && <div className={s.hover} style={scr(hoverBox)} />}
          {boxes.length > 1 && boxes.map((x) => <div key={x.id} className={s.member} style={scr(x.b)} />)}
          {single && isLine(single.el) && !anyLocked && (() => {
            const ends = lineEnds(single.el)
            return ends && ends.map((p, i) => <span key={i} data-handle={`end${i}`} className={s.endpoint} style={{ left: p.x * z, top: p.y * z, pointerEvents: 'auto' }} />)
          })()}
          {frame && !(single && isLine(single.el)) && (
            <div className={s.frame} data-editing={isEditing || undefined} data-locked={anyLocked || undefined} style={scr(frame)}>
              {handles(frame)}
              {canRotate && <span data-handle="rotate" className={s.rotate} />}
            </div>
          )}
          {guides.map((g, i) => (
            <div key={i} className={s.guide} data-axis={g.axis} data-kind={g.kind} style={g.axis === 'x' ? { left: g.at * z, top: g.from * z, height: (g.to - g.from) * z } : { top: g.at * z, left: g.from * z, width: (g.to - g.from) * z }}>
              {g.label && <span className={s.pill}>{formatLength(+g.label, localUnit())}</span>}
            </div>
          ))}
          {marquee && <div className={s.marquee} style={scr(marquee)} />}
          {glows.map((g) => <div key={g.key} className={s.glow} style={scr(g.box)} />)}
          {/* Fixed-size boxes whose text runs past them (spec: imported boxes keep their size). */}
          {/* Shown on the selected box only (as Keynote does), so imported decks don't fill with marks. */}
          {!dragging && boxes.map((x) => x.el).filter((el) => !el.hasAttribute('data-ream-autogrow') && overflows(el)).map((el) => {
            const b = boxOf(el)
            return <span key={idOf(el)} className={s.overflow} style={{ left: (b.x + b.w) * z - 10, top: (b.y + b.h) * z - 10 }} title="This text doesn’t fit its box. Make the box bigger or the text smaller." />
          })}
        </div>
        <div className={s.pinLayer} style={{ left: off.x, top: off.y, width: size.w * z, height: size.h * z }}>
          <CommentPins slide={slide} stage={stage} z={z} readOnly={readOnly} />
        </div>
      </div>
      {commenting && <div className={s.lockNote} role="status">Click where the comment goes · Esc to cancel</div>}
      {locked && !readOnly && <div className={s.lockNote} role="status">Ream is editing this slide</div>}
      {/* What a screen reader gets for the stage: each object by kind and text, the selection, and a
          polite note when it changes (spec: Accessibility). */}
      <ul className={s.sr} role="listbox" aria-label={`Objects on ${label}`} aria-multiselectable id="stage-objects">
        {pickable().map((el) => { const id = idOf(el); return <li key={id} id={`obj-${id}`} role="option" aria-selected={sel.includes(id)}>{describe(el)}</li> })}
      </ul>
      <div className={s.sr} aria-live="polite">{announce}</div>
      {readout && <div className={s.readout} style={{ left: Math.min(readout.x + 12, innerWidth - 180), top: Math.min(readout.y + 18, innerHeight - 32) }}>{readout.text}</div>}
    </div>
  )
}

export const clampZoom = (z: number) => Math.min(4, Math.max(0.1, z))

/** Text can be edited in shapes, text boxes and table cells; not in pictures or kept payloads. */
export function canEditText(el: HTMLElement): boolean {
  if (el.tagName === 'IMG' || el.classList.contains('domoxml-preserved') || isGroup(el) || el.tagName.toLowerCase() === 'svg' || el.hasAttribute('data-chart')) return false
  if (el.tagName === 'TABLE') return true
  return hasText(el) || !!textHost(el)
}

/** PowerPoint's resize: the opposite handle stays put (⌥: the centre), in the box's own rotated frame. */
function resizeBox(b: Box, dir: Dir, p: { x: number; y: number }, keepAspect: boolean, fromCentre: boolean): Box {
  const [hx, hy] = DIRS[dir]
  const r = (b.rot * Math.PI) / 180
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 }
  const lx = Math.cos(-r) * (p.x - c.x) - Math.sin(-r) * (p.y - c.y)
  const ly = Math.sin(-r) * (p.x - c.x) + Math.cos(-r) * (p.y - c.y)
  const ax = fromCentre ? 0 : -hx * b.w / 2, ay = fromCentre ? 0 : -hy * b.h / 2
  let w = hx ? Math.max(1, fromCentre ? 2 * hx * lx : hx * (lx - ax)) : b.w
  let h = hy ? Math.max(1, fromCentre ? 2 * hy * ly : hy * (ly - ay)) : b.h
  if (keepAspect) {
    const k = hx && hy ? Math.max(w / b.w, h / b.h) : hx ? w / b.w : h / b.h
    w = Math.max(1, b.w * k); h = Math.max(1, b.h * k)
  }
  const clx = fromCentre ? 0 : hx ? ax + hx * w / 2 : 0
  const cly = fromCentre ? 0 : hy ? ay + hy * h / 2 : 0
  const cx = c.x + Math.cos(r) * clx - Math.sin(r) * cly
  const cy = c.y + Math.sin(r) * clx + Math.cos(r) * cly
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot: b.rot }
}

/** An object as a screen reader names it: its kind and text ("Text box: Q3 review"). */
function describe(el: HTMLElement): string {
  const kind = isGroup(el) ? 'Group' : el.hasAttribute('data-chart') || el.classList.contains('domoxml-preserved') ? 'Chart'
    : el.tagName === 'IMG' ? 'Picture' : el.tagName === 'TABLE' ? 'Table' : isLine(el) ? 'Line' : el.querySelector('.domoxml-text, li') ? 'Text box' : 'Shape'
  const text = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return `${kind}${el.hasAttribute('data-ream-locked') ? ' (locked)' : ''}${text ? `: ${text}` : ''}`
}

/** Whether a text box's text runs past its bottom. */
function overflows(el: HTMLElement): boolean {
  if (el.tagName !== 'DIV' || !el.querySelector('.domoxml-text, li') || el.style.overflow === 'hidden') return false
  return el.scrollHeight > el.clientHeight + 3
}
