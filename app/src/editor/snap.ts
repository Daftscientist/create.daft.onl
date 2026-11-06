// Smart guides (spec: Smart guides). Targets in priority order: the slide's centre lines, its edges,
// other objects' edges, their centres, then equal spacing between neighbours. Threshold 6 screen px.
import type { Box } from './geometry'

export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number; kind: 'slide' | 'object' | 'space'; label?: string }

type Target = { v: number; prio: number; span: [number, number]; kind: Guide['kind'] }

function targets(axis: 'x' | 'y', others: Box[], slide: { w: number; h: number }): Target[] {
  const len = axis === 'x' ? slide.h : slide.w
  const full: [number, number] = [0, len]
  const out: Target[] = axis === 'x'
    ? [{ v: slide.w / 2, prio: 0, span: full, kind: 'slide' }, { v: 0, prio: 1, span: full, kind: 'slide' }, { v: slide.w, prio: 1, span: full, kind: 'slide' }]
    : [{ v: slide.h / 2, prio: 0, span: full, kind: 'slide' }, { v: 0, prio: 1, span: full, kind: 'slide' }, { v: slide.h, prio: 1, span: full, kind: 'slide' }]
  for (const b of others) {
    const [s, l, cross, crossL] = axis === 'x' ? [b.x, b.w, b.y, b.h] : [b.y, b.h, b.x, b.w]
    const span: [number, number] = [cross, cross + crossL]
    out.push({ v: s, prio: 2, span, kind: 'object' }, { v: s + l, prio: 2, span, kind: 'object' }, { v: s + l / 2, prio: 3, span, kind: 'object' })
  }
  return out
}

/** Snaps a moving box. Returns the offset to add and the guides to draw. */
export function snapMove(box: Box, others: Box[], slide: { w: number; h: number }, threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const guides: Guide[] = []
  const axis = (a: 'x' | 'y') => {
    const [s, l, cross, crossL] = a === 'x' ? [box.x, box.w, box.y, box.h] : [box.y, box.h, box.x, box.w]
    const edges = [s, s + l / 2, s + l]
    let best: { d: number; t: Target; prio: number } | null = null
    for (const t of targets(a, others, slide)) {
      for (const e of edges) {
        const d = t.v - e
        if (Math.abs(d) > threshold) continue
        if (!best || t.prio < best.prio || (t.prio === best.prio && Math.abs(d) < Math.abs(best.d))) best = { d, t, prio: t.prio }
      }
    }
    let d = best?.d ?? 0
    if (best) {
      for (const t of targets(a, others, slide)) {
        if (Math.abs(t.v - (s + d)) < 0.5 || Math.abs(t.v - (s + l / 2 + d)) < 0.5 || Math.abs(t.v - (s + l + d)) < 0.5) {
          guides.push({ axis: a, at: t.v, from: Math.min(t.span[0], cross), to: Math.max(t.span[1], cross + crossL), kind: t.kind })
        }
      }
    } else {
      // Equal spacing: the gap to the nearest neighbour on one side matches the one on the other.
      const space = equalSpacing(a, box, others, threshold)
      if (space) { d = space.d; guides.push(...space.guides) }
    }
    return d
  }
  const dx = axis('x'), dy = axis('y')
  return { dx, dy, guides }
}

function equalSpacing(a: 'x' | 'y', box: Box, others: Box[], threshold: number): { d: number; guides: Guide[] } | null {
  const lo = (b: Box) => (a === 'x' ? b.x : b.y), len = (b: Box) => (a === 'x' ? b.w : b.h)
  const clo = (b: Box) => (a === 'x' ? b.y : b.x), clen = (b: Box) => (a === 'x' ? b.h : b.w)
  const overlaps = (b: Box) => clo(b) < clo(box) + clen(box) && clo(b) + clen(b) > clo(box)
  const row = others.filter(overlaps)
  const left = row.filter((b) => lo(b) + len(b) <= lo(box) + threshold).sort((p, q) => lo(q) + len(q) - (lo(p) + len(p)))[0]
  const right = row.filter((b) => lo(b) >= lo(box) + len(box) - threshold).sort((p, q) => lo(p) - lo(q))[0]
  if (!left || !right) return null
  const total = lo(right) - (lo(left) + len(left)) - len(box)
  const want = lo(left) + len(left) + total / 2
  const d = want - lo(box)
  if (Math.abs(d) > threshold || total < 0) return null
  const gap = Math.round(total / 2)
  const mid = clo(box) + clen(box) / 2
  const g = (from: number, to: number): Guide => ({ axis: a === 'x' ? 'y' : 'x', at: mid, from, to, kind: 'space', label: `${gap}` })
  return { d, guides: [g(lo(left) + len(left), want), g(want + len(box), lo(right))] }
}

/** Snaps the moving edges of a box being resized (unrotated boxes only). */
export function snapEdges(box: Box, moving: { l: boolean; r: boolean; t: boolean; b: boolean }, others: Box[], slide: { w: number; h: number }, threshold: number): { box: Box; guides: Guide[] } {
  const out = { ...box }
  const guides: Guide[] = []
  const try1 = (a: 'x' | 'y', edge: number, apply: (d: number) => void) => {
    let best: Target | null = null, bd = Infinity
    for (const t of targets(a, others, slide)) { const d = t.v - edge; if (Math.abs(d) <= threshold && (Math.abs(d) < Math.abs(bd))) { best = t; bd = d } }
    if (best) {
      apply(bd)
      const cross = a === 'x' ? [out.y, out.y + out.h] : [out.x, out.x + out.w]
      guides.push({ axis: a, at: best.v, from: Math.min(best.span[0], cross[0]), to: Math.max(best.span[1], cross[1]), kind: best.kind })
    }
  }
  if (moving.l) try1('x', out.x, (d) => { out.x += d; out.w -= d })
  if (moving.r) try1('x', out.x + out.w, (d) => { out.w += d })
  if (moving.t) try1('y', out.y, (d) => { out.y += d; out.h -= d })
  if (moving.b) try1('y', out.y + out.h, (d) => { out.h += d })
  return { box: out, guides }
}
