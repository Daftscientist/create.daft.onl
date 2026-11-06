// Charts made in Ream (spec phase 3). A chart is a block with domOXML's data-chart spec
// ({type, categories, series:[{name, values, color?}]}): export turns it into a native PowerPoint
// chart with an embedded workbook (Edit Data works there). On the slide it is drawn as SVG from the
// same data, with domOXML's palette, so it looks the same everywhere and redraws instantly.
import { resizeHooks } from './geometry'
import { editSlide, find, insertObject, newId } from './ops'

export type ChartType = 'column' | 'bar' | 'line' | 'pie'
export type ChartSpec = { type: ChartType; categories: string[]; series: { name: string; values: number[]; color?: string }[] }
export const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: 'column', label: 'Column' }, { type: 'bar', label: 'Bar' }, { type: 'line', label: 'Line' }, { type: 'pie', label: 'Pie' },
]
const PALETTE = ['#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47']
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

export const SAMPLE: ChartSpec = {
  type: 'column',
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [{ name: 'Revenue', values: [4.3, 2.5, 3.5, 4.5] }, { name: 'Costs', values: [2.4, 4.4, 1.8, 2.8] }],
}

export function readSpec(el: Element): ChartSpec | null {
  try { return JSON.parse(el.getAttribute('data-chart') ?? '') as ChartSpec } catch { return null }
}

/** A tidy axis maximum: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v
}

/** The chart as SVG, sized to its box (viewBox in box px, so it stays crisp at any zoom). */
export function chartSvg(spec: ChartSpec, w: number, h: number): string {
  const font = 'font-family="Calibri,Instrument Sans,sans-serif"'
  const color = (i: number) => spec.series[i]?.color ?? PALETTE[i % PALETTE.length]
  const legendH = 28
  const parts: string[] = []
  if (spec.type === 'pie') {
    const s0 = spec.series[0]
    const total = s0.values.reduce((a, b) => a + Math.max(0, b), 0) || 1
    const r = Math.max(10, Math.min(w, h - legendH) / 2 - 12), cx = w / 2, cy = (h - legendH) / 2
    let a0 = -Math.PI / 2
    s0.values.forEach((v, i) => {
      const a1 = a0 + (Math.max(0, v) / total) * Math.PI * 2
      const large = a1 - a0 > Math.PI ? 1 : 0
      const p = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`
      parts.push(`<path d="M${cx},${cy} L${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)} Z" fill="${PALETTE[i % PALETTE.length]}" stroke="#fff" stroke-width="1.5"/>`)
      a0 = a1
    })
    parts.push(legend(spec.categories.map((c, i) => [c, PALETTE[i % PALETTE.length]]), w, h, font))
    return wrap(parts, w, h)
  }
  const pad = { l: 44, r: 16, t: 14, b: 26 + legendH }
  const pw = Math.max(10, w - pad.l - pad.r), ph = Math.max(10, h - pad.t - pad.b)
  // Signed axes: bars grow from zero both ways, as in PowerPoint.
  const vals = spec.series.flatMap((x) => x.values)
  const hi = niceMax(Math.max(0, ...vals)), lo = -niceMax(Math.max(0, ...vals.map((v) => -v))) || 0
  const span = hi - lo || 1
  const ticks = 5
  const at = (v: number) => (v - lo) / span // 0..1 along the value axis
  for (let i = 0; i <= ticks; i++) {
    const v = lo + (span / ticks) * i
    if (spec.type === 'bar') {
      const x = pad.l + (pw * i) / ticks
      parts.push(`<line x1="${x}" y1="${pad.t}" x2="${x}" y2="${pad.t + ph}" stroke="${Math.abs(v) < 1e-9 ? '#8C8C8C' : '#D9D9D9'}" stroke-width="0.75"/><text x="${x}" y="${pad.t + ph + 16}" font-size="11" text-anchor="middle" fill="#595959" ${font}>${+v.toFixed(2)}</text>`)
    } else {
      const y = pad.t + ph - (ph * i) / ticks
      parts.push(`<line x1="${pad.l}" y1="${y}" x2="${pad.l + pw}" y2="${y}" stroke="${Math.abs(v) < 1e-9 ? '#8C8C8C' : '#D9D9D9'}" stroke-width="0.75"/><text x="${pad.l - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="#595959" ${font}>${+v.toFixed(2)}</text>`)
    }
  }
  const n = spec.categories.length, m = spec.series.length
  const slot = (spec.type === 'bar' ? ph : pw) / Math.max(1, n)
  spec.categories.forEach((c, ci) => {
    if (spec.type === 'bar') parts.push(`<text x="${pad.l - 6}" y="${pad.t + slot * (ci + 0.5) + 4}" font-size="11" text-anchor="end" fill="#595959" ${font}>${esc(c)}</text>`)
    else parts.push(`<text x="${pad.l + slot * (ci + 0.5)}" y="${pad.t + ph + 16}" font-size="11" text-anchor="middle" fill="#595959" ${font}>${esc(c)}</text>`)
  })
  if (spec.type === 'line') {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, ci) => `${pad.l + slot * (ci + 0.5)},${pad.t + ph - ph * at(v)}`)
      parts.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${color(si)}" stroke-width="2.25" stroke-linejoin="round"/>`)
    })
  } else {
    const group = slot * 0.7, bw = group / Math.max(1, m)
    spec.series.forEach((s, si) => s.values.forEach((v, ci) => {
      const off = slot * ci + (slot - group) / 2 + bw * si
      if (spec.type === 'bar') {
        const a = pad.l + pw * at(Math.min(0, v)), b = pad.l + pw * at(Math.max(0, v))
        parts.push(`<rect x="${a}" y="${pad.t + off}" width="${b - a}" height="${bw}" fill="${color(si)}"/>`)
      } else {
        const top = pad.t + ph - ph * at(Math.max(0, v)), bottom = pad.t + ph - ph * at(Math.min(0, v))
        parts.push(`<rect x="${pad.l + off}" y="${top}" width="${bw}" height="${bottom - top}" fill="${color(si)}"/>`)
      }
    }))
  }
  parts.push(legend(spec.series.map((s, i) => [s.name, color(i)]), w, h, font))
  return wrap(parts, w, h)
}

function legend(items: [string, string][], w: number, h: number, font: string): string {
  const widths = items.map(([t]) => 18 + t.length * 6.5 + 14)
  let x = (w - widths.reduce((a, b) => a + b, 0)) / 2
  return items.map(([t, c], i) => {
    const out = `<rect x="${x}" y="${h - 18}" width="10" height="10" fill="${c}"/><text x="${x + 14}" y="${h - 9}" font-size="11" fill="#595959" ${font}>${esc(t)}</text>`
    x += widths[i]
    return out
  }).join('')
}
const wrap = (parts: string[], w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.round(w)} ${Math.round(h)}" width="100%" height="100%" preserveAspectRatio="none" style="display:block">${parts.join('')}</svg>`

export function chartHtml(spec: ChartSpec, x: number, y: number, w: number, h: number, id = newId('chart')): string {
  return `<div class="domoxml-shape" data-domoxml-node-id="${id}" data-chart="${esc(JSON.stringify(spec))}" style="position:absolute;box-sizing:border-box;left:${Math.round(x)}px;top:${Math.round(y)}px;width:${Math.round(w)}px;height:${Math.round(h)}px;background-color:rgba(255,255,255,1)">${chartSvg(spec, w, h)}</div>`
}

export function insertChart(type: ChartType, at: { x: number; y: number }) {
  const spec: ChartSpec = type === 'pie' ? { type, categories: SAMPLE.categories, series: [SAMPLE.series[0]] } : { ...SAMPLE, type }
  const w = 640, h = 400
  insertObject(chartHtml(spec, at.x - w / 2, at.y - h / 2, w, h), 'Insert chart')
}

/** Rewrites a chart's data (and its drawing). */
export function setChart(id: string, spec: ChartSpec) {
  editSlide('Edit chart', (root) => {
    const el = find(root, id)
    if (!el) return false
    el.setAttribute('data-chart', JSON.stringify(spec))
    const w = parseFloat(el.style.width) || 640, h = parseFloat(el.style.height) || 400
    el.innerHTML = chartSvg(spec, w, h)
  })
}

// After a resize a chart redraws for its new box, so its labels keep their size.
resizeHooks.push((el, w, h) => {
  if (!el.hasAttribute('data-chart')) return
  const spec = readSpec(el)
  if (spec && (Math.abs((parseFloat(el.style.width) || 0) - w) > 0.5 || Math.abs((parseFloat(el.style.height) || 0) - h) > 0.5)) el.innerHTML = chartSvg(spec, w, h)
})
