// Clipboard (spec: Clipboard). Copy writes text/html holding a versioned fragment marked
// data-ream-clip="1" (the objects' HTML and the source slide), plus a text/plain fallback. Paste gives
// pasted objects new ids: on the same slide they shift by 12px, on another they keep their place.
// External pictures paste as pictures, plain text as a text box.
import { toast } from '../data/toasts'
import { boxOf, setBox } from './geometry'
import { parseSlide } from './irdiff'
import { cleanForStore, currentSlide, editSlide, find, removeObjects, reId } from './ops'
import { insertPicture, insertText } from './insert'
import { getEditor, setEditor } from './session'
import { editingLive } from './textctl'

const VERSION = '1'

export function clipFor(ids: string[]): { html: string; text: string } | null {
  const cur = currentSlide()
  if (!cur || !ids.length) return null
  const root = parseSlide(cur.slide.html)
  const els = ids.map((id) => find(root, id)).filter((e): e is HTMLElement => !!e)
  if (!els.length) return null
  for (const el of els) cleanForStore(el)
  const { w, h } = cur.deck.size ?? { w: 1280, h: 720 }
  const html = `<div data-ream-clip="${VERSION}" data-ream-slide="${cur.slide.id}" data-ream-w="${w}" data-ream-h="${h}">${els.map((e) => e.outerHTML).join('')}</div>`
  const text = els.map((e) => (e.textContent ?? '').trim()).filter(Boolean).join('\n')
  return { html, text }
}

export function pasteHtml(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const clip = doc.querySelector('[data-ream-clip]')
  if (!clip) return false
  const cur = currentSlide()
  if (!cur) return false
  const same = clip.getAttribute('data-ream-slide') === cur.slide.id
  const sx = (cur.deck.size?.w ?? 1280) / (Number(clip.getAttribute('data-ream-w')) || 1280)
  const sy = (cur.deck.size?.h ?? 720) / (Number(clip.getAttribute('data-ream-h')) || 720)
  const ids: string[] = []
  editSlide('Paste', (root) => {
    for (const el of [...clip.children] as HTMLElement[]) {
      const copy = root.ownerDocument.importNode(el, true) as HTMLElement
      reId(copy)
      const b = boxOf(copy)
      setBox(copy, { x: b.x * sx + (same ? 12 : 0), y: b.y * sy + (same ? 12 : 0), w: b.w * sx, h: b.h * sy, rot: b.rot })
      root.appendChild(copy)
      ids.push(copy.getAttribute('data-domoxml-node-id')!)
    }
  }, { sel: ids })
  setEditor({ sel: ids, scope: null })
  return true
}

/** The native copy/cut/paste events, while the stage has focus and no text is being edited. */
export function onClipboardEvent(e: ClipboardEvent, place: () => { x: number; y: number }, slide: { w: number; h: number }) {
  if (editingLive() || !e.clipboardData) return
  const { sel } = getEditor()
  if (e.type === 'copy' || e.type === 'cut') {
    const clip = clipFor(sel)
    if (!clip) return
    e.preventDefault()
    e.clipboardData.setData('text/html', clip.html)
    e.clipboardData.setData('text/plain', clip.text)
    if (e.type === 'cut') removeObjects(sel, 'Cut')
    return
  }
  e.preventDefault()
  const html = e.clipboardData.getData('text/html')
  if (html && pasteHtml(html)) return
  const file = [...e.clipboardData.files].find((f) => f.type.startsWith('image/'))
  if (file) { void insertPicture(file, place(), slide); return }
  const text = e.clipboardData.getData('text/plain')
  if (text.trim()) pasteText(text, place())
}

function pasteText(text: string, at: { x: number; y: number }) {
  insertText(at)
  // The new box is being edited: put the text in through the editor, so it takes the box's style.
  requestAnimationFrame(() => { if (editingLive()) document.execCommand('insertText', false, text) })
}

/** Menu and button routes, through the async clipboard API (which the browser may refuse). */
export async function copySelection(cut = false) {
  const clip = clipFor(getEditor().sel)
  if (!clip) return
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([clip.html], { type: 'text/html' }), 'text/plain': new Blob([clip.text], { type: 'text/plain' }) })])
    if (cut) removeObjects(getEditor().sel, 'Cut')
  } catch { refused() }
}
export async function pasteFromMenu(place: () => { x: number; y: number }, slide: { w: number; h: number }) {
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html') && pasteHtml(await (await item.getType('text/html')).text())) return
      const pic = item.types.find((t) => t.startsWith('image/'))
      if (pic) { const b = await item.getType(pic); void insertPicture(new File([b], 'pasted', { type: pic }), place(), slide); return }
      if (item.types.includes('text/plain')) { const t = await (await item.getType('text/plain')).text(); if (t.trim()) pasteText(t, place()); return }
    }
  } catch { refused() }
}
const refused = () => toast({ message: 'Ream can’t use the clipboard here. Use ⌘C / ⌘V.' })
