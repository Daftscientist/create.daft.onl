// The host side of interactive answers (spec: generative-ui.md §5, §9): Ream's own actions, and the one gate every
// click goes through. The gate allows one effect per click, checks a button says what it does (an Ask button's label
// is its message; a deck-changing button names its deck), keeps every effect inside this project, and records what
// happened in the chat so it can be undone.
import { defineAction, defineFunction, type ActionPlan } from '@openuidev/react-lang'
import { createContext, useContext, type ReactNode } from 'react'
import { z } from 'zod/v4'
import { chartHtml, type ChartSpec } from '../editor/chart'
import { getLibrary, newDeck, rename, updateSlides } from '../data/library'
import type { Deck, LibraryState, SlideDoc } from '../data/types'

/** Checks chart data the way the slide renderer needs it; returns a reason when it can't be drawn. */
export function chartProblem(c: { type: string; categories: string[]; series: { name: string; values: number[] }[] }): string | null {
  if (!c.categories.length || !c.series.length) return 'This chart has no data.'
  if (c.series.some((x) => x.values.length !== c.categories.length)) return 'This chart’s series don’t match its categories.'
  if (c.type === 'pie' && (c.series.length !== 1 || c.series[0].values.every((v) => v <= 0))) return 'A pie chart needs one series of positive values.'
  if (c.categories.length * c.series.length > 500) return 'This chart has too many points to show.'
  return null
}
// ---------- custom actions (delivered to onAction; OpenUI never runs them) ----------
const SlideContent = z.object({
  title: z.string(),
  chart: z.object({ type: z.enum(['column', 'bar', 'line', 'pie']), categories: z.array(z.string()), series: z.array(z.object({ name: z.string(), values: z.array(z.number()) })) }).optional(),
  table: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))) }).optional(),
  bullets: z.array(z.string()).optional(),
})
export type SlideContent = z.infer<typeof SlideContent>
/** The slide a block hands over, checked here (the prompt only describes it, to keep the prompt short). */
export const parseSlide = (v: unknown): SlideContent | null => { const r = SlideContent.safeParse(v); return r.success ? r.data : null }

export const ACTIONS = [
  defineAction({ name: 'Draft', description: 'Put a request in the message box for the person to edit and send (for changes that need Ream to think: rewriting, restyling, editing existing slides).', params: z.object({ message: z.string() }) }),
  defineAction({ name: 'Copy', description: 'Copy text to the clipboard.', params: z.object({ text: z.string() }) }),
  defineAction({ name: 'DownloadCsv', description: 'Save a table as a .csv file.', params: z.object({ name: z.string(), columns: z.array(z.string()), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))) }) }),
  defineAction({ name: 'OpenDeck', description: 'Open a deck in this project.', params: z.object({ deckId: z.string() }) }),
  defineAction({ name: 'OpenSlide', description: 'Show one slide of a deck in this project, large.', params: z.object({ deckId: z.string(), slideId: z.string() }) }),
  defineAction({ name: 'PutOnSlide', description: 'Adds a slide to the end of a deck in this project. slide: {title, chart?: {type, categories, series} as for Chart, table?: {columns: string[], rows}, bullets?: string[]}. Label must name the deck ("Put on a slide in Q3 review"). Undoable.', params: z.object({ deckId: z.string(), slide: z.record(z.string(), z.any()) }) }),
  defineAction({ name: 'NewDeckFrom', description: 'Makes a new deck in this project from one slide (slide as for @PutOnSlide). Label must include the name. Undoable.', params: z.object({ name: z.string(), slide: z.record(z.string(), z.any()) }) }),
]

export const FUNCTIONS = [
  defineFunction({ name: 'Money', description: 'Formats an amount as money, e.g. @Money(1250, "GBP") → "£1,250".', params: z.object({ amount: z.number(), currency: z.string(), places: z.number().optional() }), returns: z.string(),
    fn: ({ amount, currency, places }) => { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: places ?? (Math.abs(amount) >= 100 ? 0 : 2), minimumFractionDigits: 0 }).format(amount) } catch { return amount.toLocaleString() } } }),
  defineFunction({ name: 'Percent', description: 'part as a percentage of total, e.g. @Percent(3, 4) → "75%". A total of 0 gives "–".', params: z.object({ part: z.number(), total: z.number(), places: z.number().optional() }), returns: z.string(),
    fn: ({ part, total, places }) => (total === 0 ? '–' : `${((part / total) * 100).toFixed(places ?? 0)}%`) }),
  defineFunction({ name: 'Compact', description: 'Short form of a big number, e.g. @Compact(4300000) → "4.3M".', params: z.object({ n: z.number() }), returns: z.string(),
    fn: ({ n }) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n) }),
]

// ---------- checking a button before it can be pressed ----------
export type Kind = 'ask' | 'draft' | 'copy' | 'download' | 'open' | 'link' | 'slide' | 'local'
export type Check = { ok: true; kind: Kind } | { ok: false; reason: string }
const norm = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase()
const EFFECTS = new Set(['continue_conversation', 'open_url', 'custom_action', 'run'])

/** What a button would do, or why it can't be pressed. Runs at render, so a bad button is visibly disabled. */
export function checkPlan(plan: ActionPlan | undefined, label: string, lib: LibraryState): Check {
  const steps = plan?.steps ?? []
  if (!steps.length) return { ok: false, reason: 'This button does nothing' }
  const effects = steps.filter((x) => EFFECTS.has(x.type))
  if (effects.length > 1) return { ok: false, reason: 'This button tries to do more than one thing' }
  if (!effects.length) return { ok: true, kind: 'local' }
  const e = effects[0]
  if (e.type === 'run') return { ok: false, reason: 'Not available here' }
  if (e.type === 'continue_conversation') return norm(e.message) === norm(label) ? { ok: true, kind: 'ask' } : { ok: false, reason: 'Its message doesn’t match its label' }
  if (e.type === 'open_url') return /^https?:\/\//i.test(e.url) ? { ok: true, kind: 'link' } : { ok: false, reason: 'Not a web address' }
  if (e.type !== 'custom_action') return { ok: false, reason: 'Not available here' }
  const p = e.params as Record<string, unknown>
  switch (e.name) {
    case 'Draft': return { ok: true, kind: 'draft' }
    case 'Copy': return { ok: true, kind: 'copy' }
    case 'DownloadCsv': return { ok: true, kind: 'download' }
    case 'OpenDeck': case 'OpenSlide': return { ok: true, kind: 'open' }
    case 'PutOnSlide': {
      const d = lib.entries[String(p.deckId)]
      if (!d || d.type !== 'deck' || d.trashedAt !== null) return { ok: false, reason: 'That deck isn’t here' }
      return norm(label).includes(norm(d.name)) ? { ok: true, kind: 'slide' } : { ok: false, reason: `Its label doesn’t name “${d.name}”` }
    }
    case 'NewDeckFrom': return norm(label).includes(norm(String(p.name ?? ''))) && String(p.name ?? '').trim() ? { ok: true, kind: 'slide' } : { ok: false, reason: 'Its label doesn’t name the new deck' }
    default: return { ok: false, reason: 'Not available here' }
  }
}

// ---------- the block's host (context for components) ----------
export type BlockHost = {
  /** Something is already happening (a click being handled, or Ream working): buttons wait. */
  busy: boolean
  /** Takes the click lock synchronously; false when another effect is still going. */
  claim: () => boolean
  /** Finished blocks only: an unfinished or unsupported block can't act. */
  inert: boolean
  footer: ReactNode
  preview: (deckId: string, slide: number) => void
  openDeck: (deckId: string) => void
}
const Ctx = createContext<BlockHost>({ busy: true, claim: () => false, inert: true, footer: null, preview: () => {}, openDeck: () => {} })
export const BlockHostProvider = Ctx.Provider
export const useBlockHost = () => useContext(Ctx)

// ---------- effects ----------
const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const sid = () => `s-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** A slide made from a block: a title, then a chart, a table or bullets. Plain Ream slide HTML (edits and exports normally). */
export function slideFrom(c: SlideContent): SlideDoc {
  const title = `<div class="domoxml-shape" data-domoxml-node-id="${sid()}-t" style="position:absolute;box-sizing:border-box;left:80px;top:48px;width:1120px;height:80px"><div class="domoxml-text"><span style="font-family:Instrument Sans,sans-serif;font-size:32pt;font-weight:650;color:rgba(22,22,27,1);letter-spacing:-0.5pt">${esc(c.title)}</span></div></div>`
  let body = ''
  if (c.chart && !chartProblem(c.chart)) body = chartHtml(c.chart as ChartSpec, 80, 150, 1120, 520)
  else if (c.table) {
    const head = c.table.columns.map((h) => `<th style="text-align:left;padding:10px 14px;border-bottom:2px solid #16161b;font:600 18px Instrument Sans,sans-serif">${esc(h)}</th>`).join('')
    const rows = c.table.rows.slice(0, 12).map((r) => `<tr>${r.map((v) => `<td style="padding:10px 14px;border-bottom:1px solid #ddd;font:400 18px Instrument Sans,sans-serif${typeof v === 'number' ? ';text-align:right' : ''}">${esc(v === null ? '–' : String(v))}</td>`).join('')}</tr>`).join('')
    body = `<div class="domoxml-shape" data-domoxml-node-id="${sid()}-b" style="position:absolute;box-sizing:border-box;left:80px;top:150px;width:1120px;height:520px"><table style="width:100%;border-collapse:collapse"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
  } else if (c.bullets?.length) {
    body = `<div class="domoxml-shape" data-domoxml-node-id="${sid()}-b" style="position:absolute;box-sizing:border-box;left:80px;top:160px;width:1120px;height:500px"><div class="domoxml-text">${c.bullets.slice(0, 8).map((b) => `<p style="margin:0 0 16px"><span style="font-family:Instrument Sans,sans-serif;font-size:22pt;color:rgba(40,40,46,1)">• ${esc(b)}</span></p>`).join('')}</div></div>`
  }
  return { id: sid(), html: `<div class="domoxml-slide" style="position:relative;overflow:hidden;box-sizing:border-box;width:1280px;height:720px;background-color:rgba(255,255,255,1)">${title}${body}</div>` }
}

/** Adds the slide at the end of a deck in the project. Returns before/after for the chat's Undo card. */
export function putOnSlide(projectId: string, deckId: string, c: SlideContent): { deck: Deck; before: SlideDoc[]; after: SlideDoc[] } | null {
  const d = getLibrary().entries[deckId]
  if (!d || d.type !== 'deck' || d.trashedAt !== null || d.parentId !== projectId || d.remote) return null
  const before = d.slides
  const after = updateSlides(deckId, [...before, slideFrom(c)]) ?? before
  return { deck: getLibrary().entries[deckId] as Deck, before, after }
}

export function newDeckFrom(projectId: string, name: string, c: SlideContent): Deck {
  const id = newDeck(projectId)
  rename(id, name.slice(0, 80), { quiet: true })
  updateSlides(id, [slideFrom(c)])
  return getLibrary().entries[id] as Deck
}

/** CSV the safe way: numbers stay numbers; text that a spreadsheet would run as a formula is neutralised. */
export function toCsv(columns: string[], rows: (string | number | null)[][]): string {
  const cell = (v: string | number | null) => {
    if (v === null) return ''
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
    let t = v
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  return [columns, ...rows].map((r) => r.map(cell).join(',')).join('\r\n')
}
export const csvName = (name: string) => `${(name.replace(/[^\w .-]/g, '').trim().slice(0, 60) || 'table')}.csv`
