// Accessibility checker (spec phase 6; PowerPoint's Check Accessibility). Reads the live slides
// the way the export will: pictures and charts without alt text, slides without a title, text too
// small to read or too low in contrast against what's behind it.
import type { Deck } from '../data/types'
import { boxOf } from './geometry'
import { parseSlide, topNodes } from './irdiff'

export type Issue = { slideId: string; slideIndex: number; objectId?: string; kind: 'alt' | 'title' | 'contrast' | 'small'; message: string }

const rgb = (c: string): [number, number, number, number] | null => {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(c)
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]]
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c.trim())
  return h ? [parseInt(h[1], 16), parseInt(h[2], 16), parseInt(h[3], 16), 1] : null
}
const lum = ([r, g, b]: number[]) => {
  const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export const contrast = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }

/** The colour behind an object: the nearest filled object under its centre, else the slide. */
function behind(root: HTMLElement, el: HTMLElement): number[] {
  const b = boxOf(el)
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const nodes = [...topNodes(root).values()] as HTMLElement[]
  const own = rgb(el.style.backgroundColor)
  if (own && own[3] > 0.5) return own
  for (let i = nodes.indexOf(el) - 1; i >= 0; i--) {
    const n = nodes[i], nb = boxOf(n), c = rgb(n.style.backgroundColor)
    if (c && c[3] > 0.5 && cx >= nb.x && cx <= nb.x + nb.w && cy >= nb.y && cy <= nb.y + nb.h) return c
  }
  return rgb(root.style.backgroundColor) ?? [255, 255, 255, 1]
}

export function checkDeck(deck: Deck): Issue[] {
  const out: Issue[] = []
  deck.slides.forEach((sl, slideIndex) => {
    const root = parseSlide(sl.html)
    const nodes = [...topNodes(root)] as [string, HTMLElement][]
    const at = (objectId: string | undefined, kind: Issue['kind'], message: string) => out.push({ slideId: sl.id, slideIndex, objectId, kind, message })
    let biggest = 0
    for (const [id, el] of nodes) {
      const visual = el.tagName === 'IMG' || el.classList.contains('domoxml-preserved') || el.hasAttribute('data-chart')
      const label = el.getAttribute('alt') || el.getAttribute('aria-label')
      if (visual && !label?.trim() && !el.hasAttribute('data-ream-decorative')) at(id, 'alt', el.hasAttribute('data-chart') || el.classList.contains('domoxml-preserved') ? 'Chart has no alt text' : 'Picture has no alt text')
      const runs = [...el.querySelectorAll<HTMLElement>('span')].filter((r) => (r.textContent ?? '').trim())
      let flaggedSmall = false, flaggedContrast = false
      for (const r of runs) {
        const pt = parseFloat(r.style.fontSize) || 0
        biggest = Math.max(biggest, pt)
        if (pt && pt < 10 && !flaggedSmall) { at(id, 'small', `Text is ${pt}pt; 10pt or more is easier to read`); flaggedSmall = true }
        const fg = rgb(r.style.color)
        if (fg && !flaggedContrast) {
          const ratio = contrast(fg, behind(root, el))
          const large = pt >= 18 || (pt >= 14 && (parseInt(r.style.fontWeight) || 400) >= 700)
          if (ratio < (large ? 3 : 4.5)) { at(id, 'contrast', `Text contrast is ${ratio.toFixed(1)}:1; ${large ? '3' : '4.5'}:1 is needed to read it`); flaggedContrast = true }
        }
      }
    }
    if (nodes.length && biggest < 20 && !nodes.some(([, el]) => el.hasAttribute('data-ream-placeholder'))) at(undefined, 'title', 'Slide has no title')
  })
  return out
}
