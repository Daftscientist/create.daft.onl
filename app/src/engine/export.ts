// Export. PowerPoint: an imported slide ships its IR (exact). When it was edited, the objects that
// changed are captured by the web backend and every other object keeps its IR (editor/irdiff.ts);
// slides made in Ream are captured whole. HTML: one
// standalone page per deck with every font embedded, so it opens anywhere.
import type { Deck, SlideDoc } from '../data/types'
import { boxOf, isGroup } from '../editor/geometry'
import { parseSlide, topNodes } from '../editor/irdiff'
import { appFonts, captureSlide } from './capture'
import { withFamilyNames } from '../slides/fonts'
import { exportPptxPayload } from './index'

const W = 1280
const H = 720

export async function deckToPptx(deck: Deck, onSlide?: (i: number) => void): Promise<{ bytes: Uint8Array<ArrayBuffer>; warnings: string[] }> {
  const { w, h } = deck.size ?? { w: W, h: H }
  const css = deck.css ?? ''
  const slides: object[] = []
  for (const [i, sl] of deck.slides.entries()) {
    onSlide?.(i)
    slides.push(await slidePayload(sl, css, w, h))
  }
  const out = await exportPptxPayload({ slides, css, fonts: await appFonts() })
  return { bytes: out.pptx, warnings: out.warnings }
}

/** Ids of the IR's top-level nodes (cheap: no need to validate the whole IR here). */
function irIds(ir: string): Set<string> {
  const out = new Set<string>()
  for (const n of (JSON.parse(ir) as { contents: { node_id?: string }[] }).contents) if (n.node_id) out.add(n.node_id)
  return out
}

async function slidePayload(sl: SlideDoc, css: string, w: number, h: number): Promise<object> {
  if (!sl.ir) return { snapshot: await captureSlide(sl.html, css, w, h) }
  if (!sl.irDirty?.length && !sl.irMoved?.length && !sl.irSlide) return { ir: sl.ir }
  const slide = parseSlide(sl.html)
  const nodes = topNodes(slide)
  const order = [...nodes.keys()]
  const moved: Record<string, object> = {}
  for (const id of sl.irMoved ?? []) {
    const el = nodes.get(id) as HTMLElement | undefined
    if (!el) continue
    const b = boxOf(el)
    moved[id] = { x: b.x, y: b.y, w: b.w, h: b.h, rotation: isGroup(el) ? undefined : b.rot }
  }
  const known = irIds(sl.ir)
  const dirty = sl.irDirty ?? []
  // Only what the IR can't supply needs the browser: edited and new objects, or a changed background.
  const needsCapture = sl.irSlide || dirty.some((id) => nodes.has(id)) || order.some((id) => !known.has(id)) || nodes.size < slide.children.length
  return { ir: sl.ir, order, moved, dirty, slideChanged: !!sl.irSlide, ...(needsCapture ? { snapshot: await captureSlide(sl.html, css, w, h) } : {}) }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export async function deckToHtml(deck: Deck): Promise<string> {
  const { w, h } = deck.size ?? { w: W, h: H }
  const [sans, bold, serif] = await appFonts()
  const fonts = `@font-face{font-family:'Instrument Sans';src:url(data:font/woff2;base64,${sans}) format('woff2');font-weight:400}`
    + `@font-face{font-family:'Instrument Sans';src:url(data:font/woff2;base64,${bold}) format('woff2');font-weight:700}`
    + `@font-face{font-family:'Instrument Serif';src:url(data:font/woff2;base64,${serif}) format('woff2');font-weight:400}`
  const page = `body{margin:0;background:#e9e9ec;display:flex;flex-direction:column;align-items:center;gap:32px;padding:32px 0}`
    + `.ream-slide{width:${w}px;height:${h}px;box-shadow:0 2px 12px rgba(0,0,0,.12);background:#fff;overflow:hidden;flex:none}`
    + `@media print{body{background:none;padding:0;gap:0}.ream-slide{box-shadow:none;break-after:page}}`
  const body = deck.slides.map((sl) => `<section class="ream-slide">${withFamilyNames(sl.html)}</section>`).join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${esc(deck.name)}</title><style>${fonts}${deck.css ?? ''}${page}</style></head><body>\n${body}\n</body></html>`
}

export function save(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
