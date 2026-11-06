// Slide rasters (ENGINE.md D3): the browser paints the slide itself, through SVG foreignObject → canvas, with
// the slide's fonts and pictures inlined (an image made from SVG can't fetch anything). Used where a picture of
// a slide is needed rather than a live view: the model looking at slides. Results are cached by slide content,
// and work starts when the browser is idle, one slide at a time, so it never competes with editing.
import type { SlideDoc, SlideSize } from '../data/types'
import { SLIDE_FONT_CSS, withFamilyNames } from './fonts'
import { sanitize, SLIDE_H, SLIDE_W } from './SlideView'

const RESET = (w: number, h: number) => `.stage{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:#fff;
font:400 16px/normal Inter,sans-serif;color:#0b0b0c;letter-spacing:normal;word-spacing:normal;text-align:left;text-transform:none;white-space:normal}
.stage *{margin:0;padding:0;box-sizing:border-box}`

const dataUrls = new Map<string, Promise<string>>()
/** A URL's bytes as a data: URL (same-origin assets, blobs, and anything that allows CORS). */
function inline(url: string): Promise<string> {
  if (url.startsWith('data:')) return Promise.resolve(url)
  let p = dataUrls.get(url)
  if (!p) {
    p = fetch(url).then((r) => r.blob()).then((b) => new Promise<string>((res, rej) => { const f = new FileReader(); f.onload = () => res(String(f.result)); f.onerror = rej; f.readAsDataURL(b) }))
    p.catch(() => dataUrls.delete(url))
    dataUrls.set(url, p)
  }
  return p
}

/** The @font-face rules the slide uses, with their files inlined. */
async function fontCss(html: string, deckCss: string): Promise<string> {
  const rules = `${SLIDE_FONT_CSS}${deckCss}`.match(/@font-face\s*\{[^}]*\}/g) ?? []
  const used = rules.filter((r) => { const fam = /font-family:\s*['"]?([^;'"]+)/.exec(r)?.[1]; return !!fam && html.includes(fam) })
  const out = await Promise.all(used.map(async (r) => {
    let rule = r
    for (const m of r.matchAll(/url\(([^)]+)\)/g)) {
      const u = m[1].replace(/['"]/g, '')
      try { rule = rule.replace(m[0], `url(${await inline(u)})`) } catch { /* that face falls back */ }
    }
    return rule
  }))
  return out.join('')
}

/** XHTML for the slide (foreignObject needs well-formed markup), with every picture inlined. */
async function xhtml(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(`<body>${sanitize(withFamilyNames(html))}</body>`, 'text/html')
  await Promise.all([...doc.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src')
    if (src && !src.startsWith('data:')) { try { img.setAttribute('src', await inline(src)) } catch { img.removeAttribute('src') } }
  }))
  return [...doc.body.childNodes].map((n) => new XMLSerializer().serializeToString(n)).join('')
}

async function paint(slide: SlideDoc, size: SlideSize, css: string, width: number): Promise<string> {
  const { w, h } = size
  const [fonts, body] = await Promise.all([fontCss(slide.html, css), xhtml(slide.html)])
  const style = `${fonts}${RESET(w, h)}${css.replace(/@font-face\s*\{[^}]*\}/g, '')}`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject x="0" y="0" width="${w}" height="${h}">`
    + `<div xmlns="http://www.w3.org/1999/xhtml" class="stage"><style>${style.replace(/</g, '\\3c ')}</style>${body}</div></foreignObject></svg>`
  const img = new Image()
  img.decoding = 'async'
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const scale = width / w
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.86)
}

// ---------- cache and queue ----------

const hash = (s: string) => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return (x >>> 0).toString(36) }
const cache = new Map<string, Promise<string>>()
let chain: Promise<unknown> = Promise.resolve()
const idle = () => new Promise<void>((r) => ('requestIdleCallback' in window ? requestIdleCallback(() => r(), { timeout: 400 }) : setTimeout(r, 0)))

/** A JPEG data URL of the slide, `width` px wide. Cached by content; queued behind other rasters. */
export function rasterSlide(slide: SlideDoc, size: SlideSize = { w: SLIDE_W, h: SLIDE_H }, css = '', width = 1024): Promise<string> {
  const key = `${hash(slide.html)}:${hash(css)}:${size.w}x${size.h}:${width}`
  let p = cache.get(key)
  if (!p) {
    p = chain.then(idle).then(() => paint(slide, size, css, width))
    chain = p.catch(() => undefined)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
    if (cache.size > 80) cache.delete(cache.keys().next().value!)
  }
  return p
}
