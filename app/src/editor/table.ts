// Tables (spec phase 3). domOXML's table shape: <table> absolutely positioned, a <colgroup> of
// widths, rows with heights, cells holding domOXML paragraphs. Export makes it a native PowerPoint
// table. Structure edits drop domOXML's table-geometry payload, which describes the old grid.
import { deckTextStyle, editSlide, find, insertObject, newId, openDeck } from './ops'
import { resizeHooks } from './geometry'

const esc = (t: string) => t.replace(/"/g, '&quot;')
const PAYLOAD = 'data-domoxml-table-geometry'

function cellHtml(run: string, fill: string | null, header: boolean): string {
  const bg = fill ? `background-color:${fill};` : ''
  const weight = header ? 'font-weight:700;' : 'font-weight:400;'
  return `<td style="${bg}padding:6px 10px;border:1px solid rgba(191,191,191,1);vertical-align:top"><div class="domoxml-text" style="white-space:pre-wrap;text-align:left"><span style="${esc(run.replace(/font-weight:[^;]*;?/, '') + ';' + weight)}"><br></span></div></td>`
}

export function insertTable(rows: number, cols: number, at: { x: number; y: number }) {
  const deck = openDeck()
  if (!deck) return
  const { color, font } = deckTextStyle(deck)
  const run = `font-family:${font};font-size:16pt;font-style:normal;color:${color}`
  const headerRun = `font-family:${font};font-size:16pt;font-style:normal;color:rgba(255,255,255,1)`
  const w = Math.min(960, cols * 180), rh = 44, h = rows * rh
  const colW = w / cols
  const body = Array.from({ length: rows }, (_, r) => `<tr style="height:${rh}px">${Array.from({ length: cols }, () => cellHtml(r === 0 ? headerRun : run, r === 0 ? 'rgba(68,114,196,1)' : r % 2 ? 'rgba(255,255,255,1)' : 'rgba(234,239,247,1)', r === 0)).join('')}</tr>`).join('')
  insertObject(
    `<table data-domoxml-node-id="${newId('table')}" style="position:absolute;left:${Math.round(at.x - w / 2)}px;top:${Math.round(at.y - h / 2)}px;width:${w}px;height:${h}px;box-sizing:border-box;border-collapse:collapse;table-layout:fixed">`
    + `<colgroup>${Array.from({ length: cols }, () => `<col style="width:${colW}px"/>`).join('')}</colgroup><tbody>${body}</tbody></table>`,
    'Insert table',
  )
}

/** The cell being edited, or the first cell, as [row, column]. */
export function activeCell(table: HTMLElement, live?: HTMLElement | null): [number, number] {
  const td = live?.closest('td, th')
  const rows = [...table.querySelectorAll('tr')]
  if (td) { const tr = td.parentElement!; return [rows.indexOf(tr as HTMLTableRowElement), [...tr.children].indexOf(td)] }
  return [0, 0]
}

type TableOp = 'row-above' | 'row-below' | 'col-left' | 'col-right' | 'del-row' | 'del-col'
export function tableOp(id: string, op: TableOp, at: [number, number]) {
  const label = { 'row-above': 'Insert row above', 'row-below': 'Insert row below', 'col-left': 'Insert column left', 'col-right': 'Insert column right', 'del-row': 'Delete row', 'del-col': 'Delete column' }[op]
  editSlide(label, (root) => {
    const t = find(root, id)
    if (!t || t.tagName !== 'TABLE') return false
    t.removeAttribute(PAYLOAD)
    const rows = [...t.querySelectorAll('tr')]
    const [r, c] = at
    const cols = [...t.querySelectorAll('col')]
    if (op === 'row-above' || op === 'row-below') {
      const src = rows[Math.min(r, rows.length - 1)]
      // A new row copies the style of a body row (not the header), with empty text.
      const model = rows[Math.min(Math.max(r, 1), rows.length - 1)] ?? src
      const copy = model.cloneNode(true) as HTMLElement
      for (const span of copy.querySelectorAll('span')) span.innerHTML = '<br>'
      if (op === 'row-above') src.before(copy); else src.after(copy)
      t.style.height = `${parseFloat(t.style.height) + (parseFloat(copy.style.height) || 40)}px`
    } else if (op === 'del-row') {
      if (rows.length < 2) return false
      t.style.height = `${Math.max(20, parseFloat(t.style.height) - (parseFloat(rows[r].style.height) || 40))}px`
      rows[r].remove()
    } else if (op === 'col-left' || op === 'col-right') {
      for (const tr of rows) {
        const cell = tr.children[Math.min(c, tr.children.length - 1)] as HTMLElement
        const copy = cell.cloneNode(true) as HTMLElement
        for (const span of copy.querySelectorAll('span')) span.innerHTML = '<br>'
        if (op === 'col-left') cell.before(copy); else cell.after(copy)
      }
      const w = parseFloat(t.style.width), n = cols.length + 1
      const col = cols[Math.min(c, cols.length - 1)]
      const copy = col.cloneNode() as HTMLElement
      if (op === 'col-left') col.before(copy); else col.after(copy)
      for (const k of t.querySelectorAll<HTMLElement>('col')) k.style.width = `${Math.round((w / n) * 100) / 100}px`
    } else if (op === 'del-col') {
      if (cols.length < 2) return false
      for (const tr of rows) tr.children[c]?.remove()
      cols[c]?.remove()
      const w = parseFloat(t.style.width), n = cols.length - 1
      for (const k of t.querySelectorAll<HTMLElement>('col')) k.style.width = `${Math.round((w / n) * 100) / 100}px`
    }
  })
}

/** Fills cells: the active one while editing, else the whole table (or its header row). */
export function fillCells(id: string, color: string | null, which: 'all' | 'header' | [number, number]) {
  editSlide('Cell fill', (root) => {
    const t = find(root, id)
    if (!t) return false
    const rows = [...t.querySelectorAll('tr')]
    const cells = which === 'all' ? [...t.querySelectorAll<HTMLElement>('td, th')] : which === 'header' ? [...(rows[0]?.children ?? [])] as HTMLElement[] : [rows[which[0]]?.children[which[1]] as HTMLElement].filter(Boolean)
    for (const cell of cells) { if (color) cell.style.backgroundColor = color; else cell.style.removeProperty('background-color') }
  })
}

export function borderCells(id: string, color: string | null) {
  editSlide('Table borders', (root) => {
    const t = find(root, id)
    if (!t) return false
    for (const cell of t.querySelectorAll<HTMLElement>('td, th')) {
      for (const side of ['border', 'border-left', 'border-right', 'border-top', 'border-bottom']) cell.style.removeProperty(side)
      if (color) cell.style.border = `1px solid ${color}`
    }
  })
}

/** Scales a table's columns and rows with its box (called by setBox). */
export function scaleTable(t: HTMLElement, w: number, h: number) {
  const ow = parseFloat(t.style.width) || w, oh = parseFloat(t.style.height) || h
  if (ow && Math.abs(ow - w) > 0.01) for (const c of t.querySelectorAll<HTMLElement>('col')) c.style.width = `${Math.round(parseFloat(c.style.width) * (w / ow) * 100) / 100}px`
  if (oh && Math.abs(oh - h) > 0.01) for (const r of t.querySelectorAll<HTMLElement>('tr')) if (r.style.height) r.style.height = `${Math.round(parseFloat(r.style.height) * (h / oh) * 100) / 100}px`
  if (Math.abs(ow - w) > 0.01 || Math.abs(oh - h) > 0.01) t.removeAttribute(PAYLOAD)
}
resizeHooks.push((el, w, h) => { if (el.tagName === 'TABLE') scaleTable(el, w, h) })
