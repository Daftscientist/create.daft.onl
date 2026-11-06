// Text made or edited in Ream, made exact for export. domOXML's capture reads a text box as one native
// shape only when it can: plain paragraphs need the data-domoxml-text-body flag, and lists need a text
// payload (its versioned TextBody JSON), which the capture trusts over the HTML. Both are written here,
// in the capture frame where layout and computed styles are real, so they always describe the text as
// it is (nothing stored can go stale). An invalid payload is ignored by domOXML, so the worst case is
// the plain capture.
import type { TextBody, TextParagraph, TextRun } from './ir.gen'

const PX_PT = 0.75
// The frame's own window computes its styles (the element lives in another document).
const getComputedStyle = (el: Element) => el.ownerDocument.defaultView!.getComputedStyle(el)
const EMU = 9525
const BULLET: Record<string, string> = { disc: '•', circle: '○', square: '▪' }
const SCHEME: Record<string, string> = {
  decimal: 'arabicPeriod', 'lower-alpha': 'alphaLcPeriod', 'upper-alpha': 'alphaUcPeriod', 'lower-latin': 'alphaLcPeriod',
  'upper-latin': 'alphaUcPeriod', 'lower-roman': 'romanLcPeriod', 'upper-roman': 'romanUcPeriod',
}

const rgba = (c: string) => {
  const m = /rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/.exec(c)
  return m ? { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: m[4] === undefined ? 1 : +m[4] } : { r: 0, g: 0, b: 0, a: 1 }
}
const r2 = (v: number) => Math.round(v * 100) / 100

function run(text: string, el: Element): TextRun {
  const cs = getComputedStyle(el)
  const deco = cs.textDecorationLine
  return {
    text,
    font_family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() || 'Calibri',
    size_pt: r2(parseFloat(cs.fontSize) * PX_PT),
    bold: parseInt(cs.fontWeight) >= 600,
    italic: cs.fontStyle === 'italic',
    underline: deco.includes('underline'),
    strike: deco.includes('line-through'),
    color: rgba(cs.color),
    ...(parseFloat(cs.letterSpacing) ? { letter_spacing_pt: r2(parseFloat(cs.letterSpacing) * PX_PT) } : {}),
  }
}

/** One block's runs, stopping at nested lists (they are paragraphs of their own). */
function runsOf(block: Element): TextRun[] {
  const out: TextRun[] = []
  const walk = (n: Node) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) { const t = (c as Text).data; if (t) out.push(run(t, c.parentElement!)) }
      else if (c.nodeType === 1 && !['UL', 'OL'].includes((c as Element).tagName)) walk(c)
    }
  }
  walk(block)
  return out
}

function paragraph(block: HTMLElement, list: HTMLElement | null, level: number, gutterPt: number, ownPt: number): TextParagraph {
  const cs = getComputedStyle(block)
  const align = cs.textAlign.replace('start', 'left').replace('end', 'right') as TextParagraph['align']
  const lh = block.style.lineHeight
  const p: TextParagraph = {
    runs: runsOf(block),
    align: ['left', 'center', 'right', 'justify'].includes(align as string) ? align : 'left',
    space_before_pt: r2(parseFloat(cs.marginTop) * PX_PT) || 0,
    space_after_pt: r2(parseFloat(cs.marginBottom) * PX_PT) || 0,
    level,
  }
  if (lh && /^[\d.]+$/.test(lh)) p.line_spacing = { percent: r2(parseFloat(lh) / 1.2) }
  if (list) {
    const style = getComputedStyle(list).listStyleType
    if (list.tagName === 'OL') {
      const start = list.firstElementChild === block ? parseInt(list.getAttribute('start') ?? '1', 10) : 1
      p.bullet = { kind: 'autoNumber', scheme: SCHEME[style] ?? 'arabicPeriod', ...(start > 1 ? { start_at: start } : {}) }
    } else p.bullet = { kind: 'char', char: BULLET[style] ?? '•' }
    // CSS's outside marker is DrawingML's hanging indent: the list's gutter.
    p.left_margin_pt = r2(gutterPt)
    p.indent_pt = r2(-ownPt)
  }
  return p
}

function body(host: HTMLElement): TextBody | null {
  const paras: TextParagraph[] = []
  const walk = (node: Element, list: HTMLElement | null, level: number, gutter: number, own: number) => {
    for (const c of node.children) {
      const el = c as HTMLElement
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        const pad = parseFloat(getComputedStyle(el).paddingLeft) * PX_PT || 13.5
        walk(el, el, list ? level + 1 : 0, gutter + pad, pad)
      } else if (el.tagName === 'LI') {
        paras.push(paragraph(el, list, level, gutter, own))
        const nested = el.querySelector(':scope > ul, :scope > ol')
        if (nested) walk(el, list, level, gutter, own)
      } else if (el.classList.contains('domoxml-text')) paras.push(paragraph(el, null, 0, 0, 0))
    }
  }
  walk(host, null, 0, 0, 0)
  if (!paras.length) return null
  const cs = getComputedStyle(host)
  const jc = cs.display.includes('flex') ? cs.justifyContent : ''
  return {
    paragraphs: paras,
    anchor: jc === 'center' ? 'middle' : jc === 'flex-end' || jc === 'end' ? 'bottom' : 'top',
    margins: [cs.paddingLeft, cs.paddingTop, cs.paddingRight, cs.paddingBottom].map((v) => Math.round(parseFloat(v) * EMU)) as TextBody['margins'],
  }
}

const b64url = (s: string) => { let out = ''; for (const b of new TextEncoder().encode(s)) out += String.fromCharCode(b); return btoa(out).replace(/\+/g, '-').replace(/\//g, '_') }

/** Marks every Ream text box in a laid-out slide document so it exports as one native shape. */
export function addTextPayloads(doc: Document) {
  const slide = doc.querySelector('.domoxml-slide')
  if (!slide) return
  const objects = [...slide.children].flatMap((c) => (c.classList.contains('domoxml-group') ? [...c.children] : [c])) as HTMLElement[]
  for (const el of objects) {
    if (el.tagName !== 'DIV' || el.hasAttribute('data-domoxml-text-payload') || el.hasAttribute('data-chart')) continue
    const first = el.querySelector(':scope > .domoxml-text, :scope > ul, :scope > ol')
    if (!first) continue // text inside a layer (domOXML's own markup) is left to domOXML
    if (!el.querySelector(':scope > ul, :scope > ol')) { el.setAttribute('data-domoxml-text-body', 'true'); continue }
    const tb = body(el)
    if (tb) { el.setAttribute('data-domoxml-text-payload', b64url(JSON.stringify({ version: 1, text: tb }))); el.removeAttribute('data-domoxml-text-body') }
  }
}
