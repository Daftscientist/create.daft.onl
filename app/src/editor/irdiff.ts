// Per-object exactness (docs/design/specs/editor.md, contract 2). An imported slide keeps its domOXML
// IR; each change to its HTML is diffed object by object (top-level nodes, matched by
// data-domoxml-node-id) against the HTML before it:
// - only geometry changed (left/top/width/height/rotation): the node is *moved*, and export patches the
//   original IR node's box, so it stays native and exact;
// - anything else changed: the node is *dirty*, and export captures it from the HTML.
// Untouched and moved nodes keep shipping their original IR, so a chart next to an edited title stays
// a native chart. Works for every writer (editor, AI agent, sync) since it only compares HTML.
import type { SlideDoc } from '../data/types'

const GEOMETRY = new Set(['left', 'top', 'width', 'height', 'transform', 'transform-origin'])
// Payloads that change whenever their node moves (domOXML re-derives them), so they don't make a node dirty.
const MOVE_PAYLOADS = ['data-domoxml-group']

export const parseSlide = (html: string): HTMLElement => {
  const body = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html').body
  return (body.querySelector('.domoxml-slide') as HTMLElement | null) ?? body
}

export function topNodes(slide: Element): Map<string, Element> {
  const out = new Map<string, Element>()
  for (const el of slide.children) {
    const id = el.getAttribute('data-domoxml-node-id')
    if (id) out.set(id, el)
  }
  return out
}

function withoutGeometry(el: Element): string {
  const c = el.cloneNode(true) as HTMLElement
  const strip = (x: HTMLElement) => {
    for (const p of [...x.style]) if (GEOMETRY.has(p)) x.style.removeProperty(p)
    for (const a of MOVE_PAYLOADS) x.removeAttribute(a)
  }
  strip(c)
  // A group's geometry is its children's (it is display:contents).
  if (c.classList.contains('domoxml-group')) for (const k of c.children) strip(k as HTMLElement)
  return c.outerHTML
}

/** Text a node shows, with its markup: when it changes, the node's text payload is stale. */
const textOf = (el: Element) => [...el.querySelectorAll('.domoxml-text, ul, ol')].filter((t) => !t.parentElement?.closest('.domoxml-text, ul, ol')).map((t) => t.outerHTML).join('')

const slideAttrs = (el: Element) => [...el.attributes].map((a) => `${a.name}=${a.value}`).sort().join('\n')

/** Records how `next` differs from `prev` on an imported slide, and drops payloads its edits made stale. */
export function settleSlide(prev: SlideDoc, next: SlideDoc): SlideDoc {
  if (prev.html === next.html) return next
  const a = parseSlide(prev.html)
  const b = parseSlide(next.html)
  const before = topNodes(a)
  const dirty = new Set(next.irDirty ?? [])
  const moved = new Set(next.irMoved ?? [])
  let htmlChanged = false
  for (const [id, el] of topNodes(b)) {
    const old = before.get(id)
    if (!old) continue // a new object: never in the IR, captured anyway
    if (old.outerHTML === el.outerHTML) continue
    // A group moves as a whole only when its payload moved with it (the editor keeps it in step);
    // children moved some other way are left to the capture, which rebuilds the group.
    const isGroup = el.classList.contains('domoxml-group')
    const groupMoved = !isGroup || old.getAttribute('data-domoxml-group') !== el.getAttribute('data-domoxml-group')
    if (groupMoved && withoutGeometry(old) === withoutGeometry(el)) { if (!dirty.has(id)) moved.add(id) }
    else {
      dirty.add(id)
      moved.delete(id)
      // domOXML's capture trusts a text payload over the visible text: an edited text drops it.
      if (textOf(old) !== textOf(el)) {
        for (const t of [el, ...el.querySelectorAll('[data-domoxml-text-payload]')]) {
          if (t.hasAttribute('data-domoxml-text-payload')) { t.removeAttribute('data-domoxml-text-payload'); htmlChanged = true }
        }
      }
    }
  }
  const out: SlideDoc = { ...next }
  if (htmlChanged) out.html = b.outerHTML
  if (!next.ir) { delete out.irDirty; delete out.irMoved; delete out.irSlide; return out }
  out.irDirty = [...dirty]
  out.irMoved = [...moved]
  if (next.irSlide || slideAttrs(a) !== slideAttrs(b)) out.irSlide = true
  return out
}

/** Settles every slide whose HTML changed between two versions of a deck's slides. */
export function settleSlides(prev: SlideDoc[], next: SlideDoc[]): SlideDoc[] {
  const before = new Map(prev.map((sl) => [sl.id, sl]))
  return next.map((sl) => {
    const old = before.get(sl.id)
    return old && old !== sl && old.html !== sl.html ? settleSlide(old, sl) : sl
  })
}
