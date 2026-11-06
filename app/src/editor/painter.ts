// Format painter (spec phase 2; PowerPoint's Copy/Paste Formatting, ⇧⌘C / ⇧⌘V): takes an object's
// look (fill, border, corners, opacity, shadow, and its text's font, size, weight, style, colour,
// alignment and spacing) and applies it to other objects as one change.
import { toast } from '../data/toasts'
import { editSlide, find, parasOf, runsOf } from './ops'
import { getEditor } from './session'
import { liveStage } from './Canvas'

const SHAPE = ['background-color', 'background-image', 'border-style', 'border-width', 'border-color', 'border-radius', 'opacity', 'box-shadow']
const RUN = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-decoration-line', 'letter-spacing']
const PARA = ['text-align', 'line-height', 'margin-top', 'margin-bottom']
type Look = { shape: Record<string, string>; run: Record<string, string> | null; para: Record<string, string> | null }
let look: Look | null = null

const pick = (el: HTMLElement | undefined, props: string[]) => {
  if (!el) return null
  const out: Record<string, string> = {}
  for (const p of props) { const v = el.style.getPropertyValue(p); if (v) out[p] = v }
  return out
}

export function copyFormat() {
  const stage = liveStage()
  const id = getEditor().sel[0]
  const el = stage && id ? find(stage, id) : null
  if (!el) return
  look = { shape: pick(el, SHAPE) ?? {}, run: pick(runsOf(el)[0], RUN), para: pick(parasOf(el)[0], PARA) }
  toast({ message: 'Formatting copied. Select objects and paste it with ⇧⌘V.' })
}

export const hasFormat = () => !!look

export function pasteFormat() {
  const l = look
  if (!l) { toast({ message: 'Copy formatting from an object first (⇧⌘C).' }); return }
  const ids = getEditor().sel
  editSlide('Paste formatting', (root) => {
    for (const id of ids) {
      const el = find(root, id)
      if (!el || el.tagName.toLowerCase() === 'svg') continue
      for (const p of SHAPE) { const v = l.shape[p]; if (v) el.style.setProperty(p, v); else el.style.removeProperty(p) }
      el.removeAttribute('data-domoxml-effects')
      if (l.run) for (const r of runsOf(el)) for (const [p, v] of Object.entries(l.run)) r.style.setProperty(p, v)
      if (l.para) for (const p of parasOf(el)) for (const [k, v] of Object.entries(l.para)) p.style.setProperty(k, v)
    }
  })
}
