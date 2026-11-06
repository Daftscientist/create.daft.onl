// The web backend's layout capture: domOXML's own recorder + snapshot scripts, run against a slide
// in a hidden same-origin iframe instead of headless Chromium. The result is the same snapshot shape
// Python extracts into IR, so edited slides take domOXML's normal path.
// Isolated rasters (HTML-in-Canvas, else Takumi) aren't captured yet: nodes that need one are
// reported in the export's warnings.
import { EMBED_FONT_URLS, SLIDE_FONT_CSS, withFamilyNames } from '../slides/fonts'
import { RECORDER_JS, SNAPSHOT_JS } from './capture.gen'
import { composePage } from './index'
import { addTextPayloads } from './textPayload'

export type Snapshot = { width: number; height: number; nodes: unknown[]; resources: Record<string, string> }

const b64 = (buf: ArrayBuffer) => {
  let s = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export async function captureSlide(html: string, css: string, width: number, height: number): Promise<Snapshot> {
  const page = await composePage(withFamilyNames(html), `${SLIDE_FONT_CSS}${css}`, width, height)
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.style.cssText = `position:fixed;left:-${width + 100}px;top:0;width:${width}px;height:${height}px;border:0;pointer-events:none`
  // The recorder must run before any slide content, as Chromium's init script does.
  frame.srcdoc = page.replace(/<head(\s[^>]*)?>/i, (m) => `${m}<script>${RECORDER_JS}</script>`)
  const loaded = new Promise<void>((resolve) => frame.addEventListener('load', () => resolve(), { once: true }))
  document.body.appendChild(frame)
  try {
    await loaded
    const win = frame.contentWindow as (Window & { eval: (s: string) => unknown }) | null
    if (!win) throw new Error('The slide couldn’t be laid out.')
    await win.document.fonts.ready
    addTextPayloads(win.document)
    const nodes = await (win.eval(`(${SNAPSHOT_JS})`) as () => unknown[] | Promise<unknown[]>)()
    // Data URIs are decoded by domOXML itself; anything else the slide loaded is fetched once here.
    const resources: Record<string, string> = {}
    const urls = new Set<string>()
    for (const el of win.document.querySelectorAll<HTMLImageElement>('img[src]')) if (!el.src.startsWith('data:')) urls.add(el.src)
    await Promise.all([...urls].map(async (u) => { try { resources[u] = b64(await (await fetch(u)).arrayBuffer()) } catch { /* reported as missing */ } }))
    return { width, height, nodes, resources }
  } finally {
    frame.remove()
  }
}

/** Ream's font files, so exported decks embed them. */
export async function appFonts(): Promise<string[]> {
  return Promise.all(EMBED_FONT_URLS.map(async (u) => b64(await (await fetch(u)).arrayBuffer())))
}
export { b64 }
