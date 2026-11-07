// Sample library. Each deck's design lives here as simple specs (the source for
// scripts/gen-sample-slides.py); the slides the app shows are domOXML's normalized HTML generated from
// them (sample-slides.json). Times are relative to first load so "2h ago" stays meaningful.
import samples from './sample-slides.json'
import type { Deck, Entry, Folder, SlideDoc } from './types'

type SlideTheme = { bg: string; fg: string; muted: string; accent: string; surface: string; serif?: boolean }
type SlideSpec =
  | { kind: 'title'; eyebrow?: string; title: string; subtitle?: string }
  | { kind: 'bullets'; title: string; items: string[] }
  | { kind: 'stat'; value: string; label: string; note?: string }
  | { kind: 'chart'; title: string; bars: number[]; labels: string[]; highlight?: number }
  | { kind: 'quote'; text: string; by: string }
  | { kind: 'split'; title: string; body: string; tag?: string }
  | { kind: 'grid'; title: string; cells: { label: string; value: string }[] }
  | { kind: 'section'; index: string; title: string }

const SAMPLE = samples as Record<string, string[]>
export const sampleSlides = (deckId: string): SlideDoc[] =>
  (SAMPLE[deckId] ?? []).map((html, i) => ({ id: `${deckId}-s${i + 1}`, html }))

const H = 3600_000
const D = 24 * H

const themes = {
  paper: { bg: '#ffffff', fg: '#16161b', muted: '#6b6b76', accent: '#e8603c', surface: '#f3f3f5' },
  night: { bg: '#121214', fg: '#f4efe6', muted: '#9d978c', accent: '#f2b84b', surface: '#1e1e21', serif: true },
  navy: { bg: '#0f1d33', fg: '#eef3fb', muted: '#8ea0bb', accent: '#5fd3e6', surface: '#182a46' },
  blue: { bg: '#ffffff', fg: '#0f1420', muted: '#5f6879', accent: '#2f5bea', surface: '#eef2fc' },
  sun: { bg: '#ffd84d', fg: '#141414', muted: '#5b4d12', accent: '#141414', surface: '#ffe68c' },
  sage: { bg: '#eef2ea', fg: '#1d2a1f', muted: '#5f6e60', accent: '#3d7a4f', surface: '#dfe7da' },
  lilac: { bg: '#f1ecfb', fg: '#1d1630', muted: '#6e6487', accent: '#7a4fd8', surface: '#e3daf6' },
  forest: { bg: '#163126', fg: '#eef4ee', muted: '#9bb5a5', accent: '#c6e27a', surface: '#1f3f32' },
  clay: { bg: '#f6efe7', fg: '#2a1d16', muted: '#7d6a5d', accent: '#c4552e', surface: '#ecdfd2', serif: true },
  mono: { bg: '#fafafa', fg: '#111111', muted: '#6f6f6f', accent: '#111111', surface: '#ececec' },
  ocean: { bg: '#e9f3f7', fg: '#0c2430', muted: '#557282', accent: '#0f7ea8', surface: '#d4e7ef' },
  ember: { bg: '#1b1310', fg: '#fbeee6', muted: '#b39484', accent: '#ff7a45', surface: '#2a1d18' },
} satisfies Record<string, SlideTheme>

type Seed = {
  id: string
  name: string
  folder: string | null
  theme: SlideTheme
  slides: SlideSpec[]
  modified: number
  opened: number | null
  starred?: boolean
  size: number
  lastSlide?: number
  simplified?: number
}

const seeds: Seed[] = [
  {
    id: 'd-q3', name: 'Q3 review', folder: 'f-finance', theme: themes.paper, modified: 2 * H, opened: 2 * H, starred: true,
    size: 4_800_000, lastSlide: 3,
    slides: [
      { kind: 'title', eyebrow: 'Quarterly review', title: 'Q3 2026: steady growth, sharper focus', subtitle: 'Leadership team · 4 November' },
      { kind: 'stat', value: '+38%', label: 'Net revenue, quarter on quarter', note: 'Ahead of plan by 6 points' },
      { kind: 'chart', title: 'Monthly recurring revenue (£k)', bars: [212, 228, 251, 266, 289, 318], labels: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep'], highlight: 5 },
      { kind: 'bullets', title: 'What moved the number', items: ['Self-serve upgrades doubled after pricing change', 'Churn fell to 1.9% from 2.6%', 'Two enterprise pilots converted early'] },
      { kind: 'grid', title: 'Scorecard', cells: [{ label: 'Customers', value: '1,284' }, { label: 'NRR', value: '118%' }, { label: 'CAC payback', value: '7 mo' }, { label: 'Burn multiple', value: '0.9×' }] },
      { kind: 'bullets', title: 'Q4 priorities', items: ['Ship team workspaces', 'Hire two senior engineers', 'Open the Lisbon office'] },
    ],
  },
  {
    id: 'd-keynote', name: 'Keynote: Shipping slower, on purpose', folder: 'f-talks', theme: themes.night, modified: 26 * H, opened: 5 * H, starred: true,
    size: 18_200_000, lastSlide: 7,
    slides: [
      { kind: 'title', eyebrow: 'Config 2026', title: 'Shipping slower, on purpose', subtitle: 'Leo Johnston' },
      { kind: 'quote', text: 'The fastest teams I know spend the most time deciding what not to build.', by: 'A very tired PM' },
      { kind: 'section', index: '01', title: 'The cost of speed' },
      { kind: 'stat', value: '61%', label: 'of features shipped last year were used by fewer than 5% of people' },
      { kind: 'split', title: 'Slow is a decision, not a delay', body: 'Every week we hold something back, we learn what it actually needs to be.', tag: 'Principle' },
      { kind: 'section', index: '02', title: 'What we changed' },
      { kind: 'bullets', title: 'Three rules', items: ['One bet per quarter', 'Prototype before you plan', 'Delete a feature for every one you add'] },
      { kind: 'title', title: 'Thank you', subtitle: '@leo · daft.onl' },
    ],
  },
  {
    id: 'd-northwind', name: 'Northwind pitch', folder: 'f-northwind', theme: themes.navy, modified: 2 * D, opened: 1 * D,
    size: 9_400_000, lastSlide: 0, simplified: 2,
    slides: [
      { kind: 'title', eyebrow: 'Prepared for Northwind Logistics', title: 'Routing that learns your fleet', subtitle: 'Proposal · November 2026' },
      { kind: 'stat', value: '14%', label: 'fewer empty miles in the 6-week pilot' },
      { kind: 'chart', title: 'Fuel spend per route (indexed)', bars: [100, 97, 93, 90, 88, 86], labels: ['W1', 'W2', 'W3', 'W4', 'W5', 'W6'], highlight: 5 },
      { kind: 'grid', title: 'Commercials', cells: [{ label: 'Seats', value: '240' }, { label: 'Term', value: '24 mo' }, { label: 'Annual', value: '£186k' }, { label: 'Go-live', value: 'Feb 2027' }] },
    ],
  },
  {
    id: 'd-hiring', name: 'Hiring plan 2027', folder: 'f-team', theme: themes.sage, modified: 3 * D, opened: 3 * D,
    size: 2_100_000,
    slides: [
      { kind: 'title', eyebrow: 'People', title: 'Hiring plan 2027', subtitle: 'Draft for leadership review' },
      { kind: 'grid', title: 'Headcount by team', cells: [{ label: 'Engineering', value: '+6' }, { label: 'Design', value: '+2' }, { label: 'Sales', value: '+3' }, { label: 'Support', value: '+1' }] },
      { kind: 'bullets', title: 'Principles', items: ['Hire seniors first in each new area', 'Every role has a 90-day plan before we post it', 'Remote-first, Lisbon and London hubs'] },
    ],
  },
  {
    id: 'd-board', name: 'Board update, November', folder: 'f-finance', theme: themes.blue, modified: 4 * D, opened: 4 * D,
    size: 3_600_000,
    slides: [
      { kind: 'title', eyebrow: 'Board of directors', title: 'November update', subtitle: 'Confidential' },
      { kind: 'chart', title: 'Cash runway (months)', bars: [31, 30, 30, 29, 30, 32], labels: ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov'], highlight: 5 },
      { kind: 'bullets', title: 'Asks of the board', items: ['Approve the Lisbon lease', 'Intro to two logistics CFOs', 'Feedback on the 2027 plan'] },
    ],
  },
  {
    id: 'd-retro', name: 'Launch retro', folder: 'f-team', theme: themes.sun, modified: 6 * D, opened: 6 * D,
    size: 1_400_000,
    slides: [
      { kind: 'title', eyebrow: 'Retro', title: 'Workspaces launch: what we learned', subtitle: 'Product team' },
      { kind: 'split', title: 'Went well', body: 'Beta cohort gave us 40 bugs before launch day instead of after.', tag: 'Keep' },
      { kind: 'split', title: 'Went badly', body: 'Docs shipped two days late and support took the hit.', tag: 'Fix' },
    ],
  },
  {
    id: 'd-brand', name: 'Brand refresh: direction B', folder: null, theme: themes.lilac, modified: 8 * D, opened: 7 * D, starred: true,
    size: 22_700_000,
    slides: [
      { kind: 'title', eyebrow: 'Brand', title: 'Direction B: quieter, warmer', subtitle: 'For discussion' },
      { kind: 'grid', title: 'Palette', cells: [{ label: 'Ink', value: '#1D1630' }, { label: 'Lilac', value: '#7A4FD8' }, { label: 'Mist', value: '#F1ECFB' }, { label: 'Signal', value: '#FF7A45' }] },
      { kind: 'quote', text: 'It should feel like a good notebook, not a dashboard.', by: 'Brief, page 1' },
    ],
  },
  {
    id: 'd-offsite', name: 'Team offsite agenda', folder: 'f-team', theme: themes.forest, modified: 10 * D, opened: 9 * D,
    size: 6_300_000,
    slides: [
      { kind: 'title', eyebrow: 'Sintra · 12–14 Nov', title: 'Team offsite', subtitle: 'Agenda and logistics' },
      { kind: 'bullets', title: 'Day one', items: ['09:30 Arrive and coffee', '10:30 Year in review', '14:00 Bets for 2027', '19:30 Dinner in town'] },
    ],
  },
  {
    id: 'd-pricing', name: 'Pricing model v3', folder: 'f-finance', theme: themes.mono, modified: 12 * D, opened: 11 * D,
    size: 900_000,
    slides: [
      { kind: 'title', eyebrow: 'Pricing', title: 'Model v3: seats plus usage', subtitle: 'Working draft' },
      { kind: 'chart', title: 'Revenue per account by tier (£)', bars: [24, 96, 410, 1380], labels: ['Free', 'Plus', 'Team', 'Business'], highlight: 2 },
      { kind: 'grid', title: 'Tiers', cells: [{ label: 'Free', value: '£0' }, { label: 'Plus', value: '£8' }, { label: 'Team', value: '£14/seat' }, { label: 'Business', value: 'Custom' }] },
    ],
  },
  {
    id: 'd-research', name: 'Customer research synthesis', folder: null, theme: themes.clay, modified: 15 * D, opened: 14 * D,
    size: 5_200_000,
    slides: [
      { kind: 'title', eyebrow: 'Research', title: 'What 24 customers told us', subtitle: 'Synthesis, October interviews' },
      { kind: 'quote', text: 'I don’t want another tool. I want the one I have to stop fighting me.', by: 'Ops lead, logistics' },
      { kind: 'bullets', title: 'Themes', items: ['Setup takes too long', 'Exports are the real workflow', 'Mobile is for checking, not doing'] },
    ],
  },
  {
    id: 'd-onboarding', name: 'New starter onboarding', folder: 'f-team', theme: themes.ocean, modified: 20 * D, opened: 18 * D,
    size: 7_800_000,
    slides: [
      { kind: 'title', eyebrow: 'Welcome', title: 'Your first two weeks', subtitle: 'People team' },
      { kind: 'grid', title: 'Week one', cells: [{ label: 'Mon', value: 'Laptop + accounts' }, { label: 'Tue', value: 'Product tour' }, { label: 'Wed', value: 'Shadow support' }, { label: 'Thu', value: 'First PR' }] },
    ],
  },
  {
    id: 'd-lisbon', name: 'Lisbon talk: Small software', folder: 'f-talks', theme: themes.ember, modified: 34 * D, opened: 30 * D,
    size: 15_100_000,
    slides: [
      { kind: 'title', eyebrow: 'Web Summit side stage', title: 'Small software, big feelings', subtitle: 'Leo Johnston' },
      { kind: 'stat', value: '3', label: 'people built the app you used this morning' },
    ],
  },
  {
    id: 'd-investor', name: 'Investor update Q3', folder: 'f-finance', theme: themes.forest, modified: 40 * D, opened: 38 * D,
    size: 2_900_000,
    slides: [
      { kind: 'title', eyebrow: 'Investors', title: 'Q3 update', subtitle: 'Shared 14 October' },
      { kind: 'stat', value: '£1.2m', label: 'ARR, up from £0.86m' },
    ],
  },
  {
    id: 'd-2025', name: 'Year in review 2025', folder: 'f-archive', theme: themes.paper, modified: 300 * D, opened: 290 * D,
    size: 11_000_000,
    slides: [
      { kind: 'title', eyebrow: 'Annual', title: '2025 in review', subtitle: 'All hands' },
      { kind: 'chart', title: 'Customers', bars: [180, 310, 560, 890], labels: ['Q1', 'Q2', 'Q3', 'Q4'], highlight: 3 },
    ],
  },
]

const folderSeeds: { id: string; name: string; parent: string | null; modified: number }[] = [
  { id: 'f-finance', name: 'Finance', parent: null, modified: 2 * H },
  { id: 'f-talks', name: 'Talks', parent: null, modified: 26 * H },
  { id: 'f-northwind', name: 'Northwind', parent: null, modified: 2 * D },
  { id: 'f-team', name: 'Team', parent: null, modified: 3 * D },
  { id: 'f-archive', name: 'Archive', parent: null, modified: 300 * D },
]

/** Design specs for scripts/dump-fixtures.ts (regenerating sample-slides.json). */
/** Ids of the demo entries earlier builds seeded into every new library. */
export const SAMPLE_IDS = new Set([...seeds.map((s) => s.id), ...folderSeeds.map((f) => f.id)])

export const sampleSpecs = () => seeds.map((s) => ({ id: s.id, theme: s.theme, slides: s.slides }))

export function sampleLibrary(now = Date.now()): Record<string, Entry> {
  const out: Record<string, Entry> = {}
  for (const f of folderSeeds) {
    const folder: Folder = {
      type: 'folder', id: f.id, name: f.name, parentId: f.parent,
      createdAt: now - f.modified - 60 * D, modifiedAt: now - f.modified, starred: false, trashedAt: null,
    }
    out[f.id] = folder
  }
  for (const s of seeds) {
    const deck: Deck = {
      type: 'deck', id: s.id, name: s.name, parentId: s.folder,
      createdAt: now - s.modified - 20 * D, modifiedAt: now - s.modified,
      openedAt: s.opened === null ? null : now - s.opened,
      starred: s.starred ?? false, trashedAt: null, sizeBytes: s.size,
      slides: sampleSlides(s.id), lastSlide: s.lastSlide ?? 0, status: 'ready', simplified: s.simplified,
    }
    out[s.id] = deck
  }
  return out
}

/** A blank slide in the same normalized shape domOXML emits. */
export function blankSlide(id: string, title: string): SlideDoc {
  const esc = title.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)
  return {
    id,
    html: `<div class="domoxml-slide" style="position:relative;overflow:hidden;box-sizing:border-box;width:1280px;height:720px;background-color:rgba(255,255,255,1)">`
      + `<div class="domoxml-shape" data-domoxml-node-id="title" style="position:absolute;box-sizing:border-box;left:102px;top:290px;width:1076px;height:90px">`
      + `<div class="domoxml-text"><span style="font-family:Instrument Sans,sans-serif;font-size:48pt;font-weight:650;color:rgba(22,22,27,1);letter-spacing:-1.5pt">${esc}</span></div></div></div>`,
  }
}
