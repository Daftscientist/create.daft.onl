// Ream's component library for interactive answers (spec: generative-ui.md §4). The model writes OpenUI Lang against
// these; every one is ours, drawn with our tokens. Required content comes first in each signature (OpenUI arguments
// are positional), and props are append-only: a new prop goes at the end and is optional, never reordered, so saved
// answers keep meaning the same thing.
import { ArrowSquareOut, ChatCircle, CheckCircle, Copy, DownloadSimple, Info, NotePencil, PresentationChart, Warning, XCircle } from '@phosphor-icons/react'
import { action, defineComponent, reactive, useIsStreaming, useStateField, useTriggerAction, type ActionPlan } from '@openuidev/react-lang'
import { useId, useMemo, useState, type ReactNode } from 'react'
import { z } from 'zod/v4'
import { chartSvg, type ChartSpec } from '../editor/chart'
import { Markdown } from '../compositions/Markdown'
import { DeckThumb } from '../compositions/DeckThumb'
import { getLibrary, useLibrary } from '../data/library'
import type { Deck } from '../data/types'
import { chartProblem, checkPlan, useBlockHost } from './host'
import s from './genui.module.css'

const node = z.any()
const kids = z.array(node)

// ---------- formatting ----------
export type Format = string | undefined
export function formatValue(v: unknown, format?: Format): string {
  if (v === null || v === undefined || v === '') return '–'
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v)
  if (!format || format === 'number') return v.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (format === 'percent') return `${(v * (Math.abs(v) <= 1 ? 100 : 1)).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
  if (format === 'compact') return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v)
  const money = /^money:([A-Z]{3})$/.exec(format)
  if (money) { try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: money[1], maximumFractionDigits: Math.abs(v) >= 100 ? 0 : 2 }).format(v) } catch { /* unknown currency */ } }
  return v.toLocaleString()
}

// ---------- structure ----------
export const Card = defineComponent({
  name: 'Card',
  description: 'The block itself (always the root). actions: Buttons in its footer.',
  props: z.object({ children: kids, title: z.string().optional(), actions: kids.optional() }),
  component: ({ props, renderNode }) => {
    const host = useBlockHost()
    return (
      <section className={s.card} aria-label={props.title ?? 'Interactive answer'}>
        {props.title && <h3 className={s.cardTitle}>{props.title}</h3>}
        <div className={s.cardBody}>{renderNode(props.children)}</div>
        {!!props.actions?.length && <div className={s.cardActions}>{renderNode(props.actions)}</div>}
        {host.footer}
      </section>
    )
  },
})

export const Stack = defineComponent({
  name: 'Stack',
  description: 'Children down (default) or across.',
  props: z.object({ children: kids, direction: z.enum(['down', 'across']).optional(), gap: z.enum(['s', 'm', 'l']).optional() }),
  component: ({ props, renderNode }) => <div className={s.stack} data-dir={props.direction ?? 'down'} data-gap={props.gap ?? 'm'}>{renderNode(props.children)}</div>,
})

export const Columns = defineComponent({
  name: 'Columns',
  description: '2–3 columns side by side, e.g. Stats to compare.',
  props: z.object({ children: kids }),
  component: ({ props, renderNode }) => <div className={s.columns} style={{ ['--cols' as string]: Math.min(3, Math.max(1, props.children.length)) }}>{renderNode(props.children)}</div>,
})

export const Tab = defineComponent({
  name: 'Tab',
  description: 'One tab of Tabs.',
  props: z.object({ label: z.string(), children: kids }),
  component: ({ props, renderNode }) => <div>{renderNode(props.children)}</div>,
})

export const Tabs = defineComponent({
  name: 'Tabs',
  description: '2–5 views of the same thing.',
  props: z.object({ tabs: z.array(Tab.ref) }),
  component: ({ props, renderNode }) => {
    const id = useId()
    const tabs = props.tabs as unknown as { props: { label: string; children: unknown[] } }[]
    const field = useStateField(`tab:${id}`, 0)
    const active = Math.min(Number(field.value ?? 0) || 0, Math.max(0, tabs.length - 1))
    const go = (i: number) => { field.setValue(i); requestAnimationFrame(() => document.getElementById(`${id}-t${i}`)?.focus()) }
    return (
      <div className={s.tabs}>
        <div role="tablist" className={s.tablist} onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); go((active + 1) % tabs.length) }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go((active - 1 + tabs.length) % tabs.length) }
        }}>
          {tabs.map((t, i) => (
            <button key={i} id={`${id}-t${i}`} type="button" role="tab" aria-selected={i === active} aria-controls={`${id}-p${i}`} tabIndex={i === active ? 0 : -1} className={s.tab} onClick={() => go(i)}>{t.props?.label ?? `Tab ${i + 1}`}</button>
          ))}
        </div>
        {tabs.map((t, i) => (
          <div key={i} id={`${id}-p${i}`} role="tabpanel" aria-labelledby={`${id}-t${i}`} hidden={i !== active} className={s.tabpanel}>{renderNode(t.props?.children ?? [])}</div>
        ))}
      </div>
    )
  },
})

// ---------- content ----------
export const Text = defineComponent({
  name: 'Text',
  description: 'Short Markdown text.',
  props: z.object({ markdown: z.string() }),
  component: ({ props }) => <Markdown text={props.markdown} className={s.text} />,
})

const TONE_ICON = { info: Info, ok: CheckCircle, warn: Warning, danger: XCircle } as const
export const Callout = defineComponent({
  name: 'Callout',
  description: 'A highlighted note.',
  props: z.object({ text: z.string(), tone: z.enum(['info', 'ok', 'warn', 'danger']).optional(), title: z.string().optional() }),
  component: ({ props }) => {
    const tone = props.tone ?? 'info'
    const Icon = TONE_ICON[tone]
    return (
      <div className={s.callout} data-tone={tone} role={tone === 'danger' || tone === 'warn' ? 'note' : undefined}>
        <Icon size={17} weight="fill" aria-hidden />
        <div>{props.title && <b>{props.title}</b>}<p>{props.text}</p></div>
      </div>
    )
  },
})

export const KeyValues = defineComponent({
  name: 'KeyValues',
  description: 'Pairs like [["Owner", "Sam"], ["Due", "12 Dec"]].',
  props: z.object({ pairs: z.array(z.tuple([z.string(), z.union([z.string(), z.number()])])) }),
  component: ({ props }) => (
    <dl className={s.kv}>{props.pairs.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{typeof v === 'number' ? formatValue(v) : v}</dd></div>)}</dl>
  ),
})

export const List = defineComponent({
  name: 'List',
  description: 'Items, each [title] or [title, detail].',
  props: z.object({ items: z.array(z.union([z.tuple([z.string()]), z.tuple([z.string(), z.string()])])) }),
  component: ({ props }) => (
    <ul className={s.list}>{props.items.map((it, i) => <li key={i}><b>{it[0]}</b>{it[1] && <span>{it[1]}</span>}</li>)}</ul>
  ),
})

// ---------- data ----------
export const Stat = defineComponent({
  name: 'Stat',
  description: 'A headline number. change: a number (▲/▼); goodWhen: which direction is good; format: "number", "percent", "compact" or "money:GBP" (any currency).',
  props: z.object({ label: z.string(), value: z.union([z.number(), z.string()]), change: z.number().nullable().optional(), note: z.string().nullable().optional(), goodWhen: z.enum(['up', 'down']).nullable().optional(), format: z.string().nullable().optional() }),
  component: ({ props }) => {
    const change = typeof props.change === 'number' ? props.change : undefined
    const good = change === undefined || change === 0 ? undefined : (change > 0) === ((props.goodWhen ?? 'up') === 'up')
    return (
      <div className={s.stat}>
        <span className={s.statLabel}>{props.label}</span>
        <b className={s.statValue}>{formatValue(props.value, props.format ?? undefined)}</b>
        {(change || props.note) && (
          <span className={s.statMeta}>
            {!!change && <span data-good={good}>{change > 0 ? '▲' : '▼'} {formatValue(Math.abs(change), Math.abs(change) < 1 ? 'percent' : props.format ?? undefined)}</span>}
            {props.note && <span>{props.note}</span>}
          </span>
        )}
      </div>
    )
  },
})

const Column = z.object({ label: z.string(), type: z.enum(['text', 'number', 'money', 'percent', 'date']).optional(), unit: z.string().optional() })
export const Table = defineComponent({
  name: 'Table',
  description: 'A table. rows hold raw values (numbers as numbers), one per column; unit is the currency code for money.',
  props: z.object({ columns: z.array(Column), rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))), sortable: z.boolean().optional() }),
  component: ({ props }) => {
    const id = useId()
    const sort = useStateField(`sort:${id}`, null as null | { col: number; dir: 1 | -1 })
    const [all, setAll] = useState(false)
    const cols = props.columns
    const ragged = props.rows.some((r) => r.length !== cols.length)
    const rows = useMemo(() => {
      const s0 = sort.value as null | { col: number; dir: 1 | -1 }
      if (!s0) return props.rows
      return [...props.rows].sort((a, b) => {
        const x = a[s0.col], y = b[s0.col]
        if (typeof x === 'number' && typeof y === 'number') return (x - y) * s0.dir
        return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) * s0.dir
      })
    }, [props.rows, sort.value])
    if (ragged) return <p className={s.partError}>This table’s rows don’t match its columns, so it isn’t shown.</p>
    const shown = all ? rows : rows.slice(0, 8)
    const fmt = (v: unknown, c: z.infer<typeof Column>) => (c.type === 'money' ? formatValue(v, `money:${c.unit ?? 'GBP'}`) : c.type === 'percent' ? formatValue(v, 'percent') : typeof v === 'number' ? formatValue(v) : (v ?? '–') as string)
    const s0 = sort.value as null | { col: number; dir: 1 | -1 }
    return (
      <div className={s.tableWrap} role="region" aria-label="Table" tabIndex={0}>
        <table className={s.table}>
          <thead><tr>{cols.map((c, i) => {
            const num = c.type === 'number' || c.type === 'money' || c.type === 'percent'
            const state = s0?.col === i ? (s0.dir === 1 ? 'ascending' : 'descending') : 'none'
            return (
              <th key={i} data-num={num || undefined} aria-sort={props.sortable ? state : undefined} scope="col">
                {props.sortable ? <button type="button" onClick={() => sort.setValue(s0?.col === i ? (s0.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })}>{c.label}<span aria-hidden>{state === 'ascending' ? ' ↑' : state === 'descending' ? ' ↓' : ''}</span></button> : c.label}
              </th>
            )
          })}</tr></thead>
          <tbody>{shown.map((r, ri) => <tr key={ri}>{r.map((v, ci) => <td key={ci} data-num={(cols[ci].type && cols[ci].type !== 'text' && cols[ci].type !== 'date') || undefined}>{fmt(v, cols[ci])}</td>)}</tr>)}</tbody>
        </table>
        {rows.length > 8 && <button type="button" className={s.more} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length} rows`}</button>}
      </div>
    )
  },
})

const Series = z.object({ name: z.string(), values: z.array(z.number()) })
export const Chart = defineComponent({
  name: 'Chart',
  description: 'A chart, drawn like a Ream slide chart. One value per category in each series; pie takes one series.',
  props: z.object({ type: z.enum(['column', 'bar', 'line', 'pie']), categories: z.array(z.string()), series: z.array(Series), title: z.string().optional() }),
  component: ({ props }) => {
    const [data, setData] = useState(false)
    const problem = chartProblem(props)
    if (problem) return <p className={s.partError}>{problem}</p>
    const spec: ChartSpec = { type: props.type, categories: props.categories, series: props.series.map((x) => ({ name: x.name, values: x.values })) }
    const summary = `${props.title ? `${props.title}: ` : ''}${props.type} chart of ${props.series.map((x) => x.name).join(', ')} across ${props.categories.length} categories`
    return (
      <figure className={s.chart}>
        {props.title && <figcaption>{props.title}</figcaption>}
        {data ? (
          <table className={s.table}><thead><tr><th scope="col" /> {props.series.map((x, i) => <th key={i} scope="col" data-num>{x.name}</th>)}</tr></thead>
            <tbody>{props.categories.map((c, ci) => <tr key={ci}><th scope="row">{c}</th>{props.series.map((x, i) => <td key={i} data-num>{formatValue(x.values[ci])}</td>)}</tr>)}</tbody></table>
        ) : (
          // Document colours, on a white chip like a slide (both themes). chartSvg escapes text; no colours come from the model.
          <div className={s.chartChip} role="img" aria-label={summary} dangerouslySetInnerHTML={{ __html: chartSvg(spec, 640, 300) }} />
        )}
        <button type="button" className={s.more} onClick={() => setData(!data)}>{data ? 'Show chart' : 'Show data'}</button>
      </figure>
    )
  },
})

export const Progress = defineComponent({
  name: 'Progress',
  description: 'Progress: value out of max.',
  props: z.object({ value: z.number(), max: z.number(), label: z.string() }),
  component: ({ props }) => {
    const pct = props.max > 0 ? Math.max(0, Math.min(100, (props.value / props.max) * 100)) : 0
    return (
      <div className={s.progress}>
        <span className={s.progressHead}><span>{props.label}</span><b>{formatValue(props.value)} / {formatValue(props.max)}</b></span>
        <span className={s.progressBar} role="progressbar" aria-label={props.label} aria-valuenow={props.value} aria-valuemin={0} aria-valuemax={props.max}><i style={{ width: `${pct}%` }} /></span>
      </div>
    )
  },
})

// ---------- sources (your work, by stable id) ----------
function useDeck(deckId: string): { deck?: Deck; state: 'ok' | 'trash' | 'missing' | 'remote' } {
  const lib = useLibrary()
  const d = lib.entries[deckId]
  if (!d || d.type !== 'deck') return { state: 'missing' }
  if (d.trashedAt !== null) return { deck: d, state: 'trash' }
  return { deck: d, state: d.remote ? 'remote' : 'ok' }
}

export const SlideRef = defineComponent({
  name: 'SlideRef',
  description: 'A chip of one slide (ids from read_deck).',
  props: z.object({ deckId: z.string(), slideId: z.string() }),
  component: ({ props }) => {
    const host = useBlockHost()
    const { deck, state } = useDeck(props.deckId)
    const index = deck ? deck.slides.findIndex((x) => x.id === props.slideId) : -1
    const why = state === 'missing' ? 'Deck not found' : state === 'trash' ? 'In Trash' : state !== 'remote' && index < 0 ? 'Slide removed' : null
    return (
      <button type="button" className={s.slideRef} disabled={!!why} onClick={() => host.preview(props.deckId, Math.max(0, index))} aria-label={why ? `${deck?.name ?? 'Slide'}: ${why}` : `${deck?.name}, slide ${index + 1}`}>
        <span className={s.slideThumb}>{deck && index >= 0 ? <DeckThumb deck={deck} slide={index} /> : <span className={s.blank} />}</span>
        <span className={s.refText}><b>{deck?.name ?? 'Missing deck'}</b><small>{why ?? (state === 'remote' ? 'In the cloud' : `Slide ${index + 1}`)}</small></span>
      </button>
    )
  },
})

export const DeckRef = defineComponent({
  name: 'DeckRef',
  description: 'A chip for a deck in this project.',
  props: z.object({ deckId: z.string() }),
  component: ({ props }) => {
    const host = useBlockHost()
    const { deck, state } = useDeck(props.deckId)
    const why = state === 'missing' ? 'Deck not found' : state === 'trash' ? 'In Trash' : null
    return (
      <button type="button" className={s.slideRef} disabled={!!why} onClick={() => host.openDeck(props.deckId)} aria-label={why ? `Deck: ${why}` : `Open ${deck?.name}`}>
        <span className={s.slideThumb}>{deck && !deck.remote ? <DeckThumb deck={deck} /> : <span className={s.blank} />}</span>
        <span className={s.refText}><b>{deck?.name ?? 'Missing deck'}</b><small>{why ?? (state === 'remote' ? 'In the cloud' : `${deck!.slides.length} slides`)}</small></span>
      </button>
    )
  },
})

export const Sources = defineComponent({
  name: 'Sources',
  description: 'Where something came from: put it under the claim, number or chart it backs up.',
  props: z.object({ refs: z.array(z.union([SlideRef.ref, DeckRef.ref])) }),
  component: ({ props, renderNode }) => <div className={s.sources}><span className={s.sourcesLabel}>From</span><div className={s.sourcesRow}>{renderNode(props.refs)}</div></div>,
})

// ---------- inputs (view state: kept on this device) ----------
function Field({ label, help, error, children, htmlFor }: { label: string; help?: string; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className={s.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {error ? <small className={s.fieldError}>{error}</small> : help ? <small>{help}</small> : null}
    </div>
  )
}

export const Slider = defineComponent({
  name: 'Slider',
  description: 'A slider (with a number box). format as for Stat.',
  props: z.object({ label: z.string(), value: reactive(z.number()), min: z.number(), max: z.number(), step: z.number().optional(), format: z.string().optional() }),
  component: ({ props }) => {
    const id = useId()
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    const v = Number(f.value ?? props.min)
    const [draft, setDraft] = useState<string | null>(null)
    const bad = draft !== null && (draft.trim() === '' || Number.isNaN(Number(draft)) || Number(draft) < props.min || Number(draft) > props.max)
    return (
      <Field label={props.label} htmlFor={id} error={bad ? `Between ${formatValue(props.min, props.format)} and ${formatValue(props.max, props.format)}` : undefined}>
        <div className={s.sliderRow}>
          <input id={id} type="range" min={props.min} max={props.max} step={props.step ?? 1} value={v} disabled={streaming}
            aria-valuetext={formatValue(v, props.format)} onChange={(e) => f.setValue(Number(e.target.value))} />
          <input className={s.numberBox} type="number" inputMode="decimal" aria-label={`${props.label} (number)`} min={props.min} max={props.max} step={props.step ?? 1} disabled={streaming}
            value={draft ?? String(v)} onChange={(e) => { setDraft(e.target.value); const n = Number(e.target.value); if (e.target.value.trim() && !Number.isNaN(n) && n >= props.min && n <= props.max) f.setValue(n) }}
            onBlur={() => setDraft(null)} />
        </div>
      </Field>
    )
  },
})

export const NumberField = defineComponent({
  name: 'NumberField',
  description: 'A number input.',
  props: z.object({ label: z.string(), value: reactive(z.number()), min: z.number().optional(), max: z.number().optional(), step: z.number().optional(), format: z.string().optional() }),
  component: ({ props }) => {
    const id = useId()
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    const [draft, setDraft] = useState<string | null>(null)
    const n = Number(draft)
    const bad = draft !== null && (draft.trim() === '' || Number.isNaN(n) || (props.min !== undefined && n < props.min) || (props.max !== undefined && n > props.max))
    return (
      <Field label={props.label} htmlFor={id} error={bad ? 'Enter a number in range' : undefined} help={props.format ? formatValue(Number(f.value), props.format) : undefined}>
        <input id={id} className={s.input} type="number" inputMode="decimal" disabled={streaming} min={props.min} max={props.max} step={props.step}
          value={draft ?? String(f.value ?? '')} onChange={(e) => { setDraft(e.target.value); const x = Number(e.target.value); if (e.target.value.trim() && !Number.isNaN(x) && (props.min === undefined || x >= props.min) && (props.max === undefined || x <= props.max)) f.setValue(x) }} onBlur={() => setDraft(null)} />
      </Field>
    )
  },
})

const Option = z.object({ id: z.string(), label: z.string(), detail: z.string().optional() })
export const Choice = defineComponent({
  name: 'Choice',
  description: 'Options to pick from, with explanations (chosen id, or ids with multi).',
  props: z.object({ label: z.string(), value: reactive(z.union([z.string(), z.array(z.string()), z.null()])), options: z.array(Option), multi: z.boolean().optional() }),
  component: ({ props }) => {
    const name = useId()
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    const picked = Array.isArray(f.value) ? (f.value as string[]) : f.value ? [String(f.value)] : []
    return (
      <fieldset className={s.choice} disabled={streaming}>
        <legend>{props.label}</legend>
        {props.options.map((o) => (
          <label key={o.id} className={s.option} data-on={picked.includes(o.id) || undefined}>
            <input type={props.multi ? 'checkbox' : 'radio'} name={name} checked={picked.includes(o.id)}
              onChange={(e) => f.setValue(props.multi ? (e.target.checked ? [...picked, o.id] : picked.filter((x) => x !== o.id)) : o.id)} />
            <span><b>{o.label}</b>{o.detail && <small>{o.detail}</small>}</span>
          </label>
        ))}
      </fieldset>
    )
  },
})

const Simple = z.object({ id: z.string(), label: z.string() })
export const Select = defineComponent({
  name: 'Select',
  description: 'A dropdown (chosen id). Prefer Choice when options need explaining.',
  props: z.object({ label: z.string(), value: reactive(z.union([z.string(), z.null()])), options: z.array(Simple) }),
  component: ({ props }) => {
    const id = useId()
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    return (
      <Field label={props.label} htmlFor={id}>
        <select id={id} className={s.input} disabled={streaming} value={String(f.value ?? '')} onChange={(e) => f.setValue(e.target.value)}>
          {(f.value == null || f.value === '') && <option value="" disabled>Choose…</option>}
          {props.options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </Field>
    )
  },
})

export const Segmented = defineComponent({
  name: 'Segmented',
  description: '2–4 short options side by side (chosen id).',
  props: z.object({ label: z.string(), value: reactive(z.union([z.string(), z.null()])), options: z.array(Simple) }),
  component: ({ props }) => {
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    return (
      <div className={s.field}>
        <span className={s.fieldLabel} id={useId()}>{props.label}</span>
        <div role="radiogroup" aria-label={props.label} className={s.segmented}>
          {props.options.slice(0, 4).map((o) => (
            <button key={o.id} type="button" role="radio" aria-checked={f.value === o.id} disabled={streaming} onClick={() => f.setValue(o.id)}>{o.label}</button>
          ))}
        </div>
      </div>
    )
  },
})

export const Toggle = defineComponent({
  name: 'Toggle',
  description: 'An on/off switch.',
  props: z.object({ label: z.string(), value: reactive(z.boolean()) }),
  component: ({ props }) => {
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    return (
      <label className={s.toggle}>
        <span>{props.label}</span>
        <input type="checkbox" role="switch" checked={!!f.value} disabled={streaming} onChange={(e) => f.setValue(e.target.checked)} />
      </label>
    )
  },
})

export const TextField = defineComponent({
  name: 'TextField',
  description: 'A text box.',
  props: z.object({ label: z.string(), value: reactive(z.string()), placeholder: z.string().optional(), multiline: z.boolean().optional() }),
  component: ({ props }) => {
    const id = useId()
    const streaming = useIsStreaming()
    const f = useStateField(props.label, props.value)
    const common = { id, className: s.input, disabled: streaming, placeholder: props.placeholder, value: String(f.value ?? '') }
    return (
      <Field label={props.label} htmlFor={id}>
        {props.multiline
          ? <textarea {...common} rows={3} onChange={(e) => f.setValue(e.target.value.slice(0, 2000))} />
          : <input {...common} type="text" onChange={(e) => f.setValue(e.target.value.slice(0, 500))} />}
      </Field>
    )
  },
})

// ---------- actions ----------
const KIND = {
  ask: { icon: ChatCircle, verb: 'Ask Ream' },
  draft: { icon: NotePencil, verb: 'Draft request' },
  copy: { icon: Copy, verb: 'Copy' },
  download: { icon: DownloadSimple, verb: 'Download' },
  open: { icon: ArrowSquareOut, verb: 'Open' },
  link: { icon: ArrowSquareOut, verb: 'Open link' },
  slide: { icon: PresentationChart, verb: 'Change your decks' },
  local: { icon: null, verb: 'Change this view' },
} as const

export const Button = defineComponent({
  name: 'Button',
  description: 'A button; label says what it does. One effect per button (plus any @Set/@Reset).',
  props: z.object({ label: z.string(), action: action() }),
  component: ({ props }) => {
    const host = useBlockHost()
    const streaming = useIsStreaming()
    const trigger = useTriggerAction()
    const plan = props.action as unknown as ActionPlan | undefined
    const check = checkPlan(plan, props.label, getLibrary())
    const kind = check.ok ? check.kind : 'ask'
    const Icon = KIND[kind].icon as typeof ChatCircle | null
    const busy = host.busy
    return (
      <button type="button" className={s.button} data-kind={kind} disabled={streaming || busy || !check.ok || host.inert}
        title={check.ok ? KIND[kind].verb : check.reason} aria-label={`${props.label} (${check.ok ? KIND[kind].verb : check.reason})`}
        onClick={() => { if (check.ok && host.claim()) void trigger(props.label, undefined, plan) }}>
        {Icon && <Icon size={15} aria-hidden />}{props.label}
      </button>
    )
  },
})

export const COMPONENTS = [Card, Stack, Columns, Tabs, Tab, Text, Callout, KeyValues, List, Stat, Table, Chart, Progress, SlideRef, DeckRef, Sources, Slider, NumberField, Choice, Select, Segmented, Toggle, TextField, Button]
