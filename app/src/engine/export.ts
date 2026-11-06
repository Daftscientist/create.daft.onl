// Export. PowerPoint: slides still holding their imported IR go straight to domOXML's PPTX builder
// (exact); edited slides are captured by the web backend first, then take the same path. HTML: one
// standalone page per deck with every font embedded, so it opens anywhere.
import type { Deck } from '../data/types'
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
    slides.push(sl.ir ? { ir: sl.ir } : { snapshot: await captureSlide(sl.html, css, w, h) })
  }
  const out = await exportPptxPayload({ slides, css, fonts: await appFonts() })
  return { bytes: out.pptx, warnings: out.warnings }
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
