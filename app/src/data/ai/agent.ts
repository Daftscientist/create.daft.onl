// The deck agent: Vercel AI SDK running fully in the browser with the user's own provider key.
// It reads and edits slides as normalized HTML (domOXML's shape), and can do anything the editor's UI can:
// slides, elements, notes, transitions, animations, backgrounds, comments, the deck's styles, and look at
// slides as pictures. Every tool call carries an `activity` (≤4 words) that the panel shows instead of tool names.
//
// Token budget: the first message carries a compact brief (outline, the open slide, the selection, what the
// user did by hand since the last turn, open comments), so most edits need no reading first. Slide HTML is
// sent compact (pictures and other embedded data become `ream-asset:N` references the model can echo back),
// and older slide HTML in the conversation is replaced by a note on each step.
import { generateText, isStepCount, streamText, tool, type ModelMessage, type UserContent } from 'ai'
import { z } from 'zod'
import { getLibrary, rename, updateSlides } from '../library'
import type { Deck, SlideDoc, SlideSize } from '../types'
import { sanitize, slideText, SLIDE_H, SLIDE_W } from '../../slides/SlideView'
import { rasterSlide } from '../../slides/raster'
import { runBrowserLoop } from './browser'
import { normalizeHost } from '../../editor/text'
import { plainText } from '../../editor/ops'
import { chartSvg, type ChartSpec } from '../../editor/chart'
import { parseSlide, topNodes } from '../../editor/irdiff'
import { providerDef, type AiProviderId } from './providers'
import { makePicture, pictureModel } from './images'
import { recordUsage } from './usage'
import { canSee, getActiveModel, getAi, reasoningFor, type ModelRef } from './settings'

export type AgentEvent =
  | { type: 'thinking'; on: boolean; summary?: string }
  /** What it's doing. `live`: only refresh the activity line (a tool call is being written), not a new step. */
  | { type: 'activity'; label: string; live?: boolean }
  | { type: 'text'; delta: string }
  | { type: 'edit'; slides: number[] }
  /** What changed on a slide, as it lands: the editor animates these objects (and follows along). */
  | { type: 'changed'; slideId: string; nodes: string[]; added: boolean }
  /** The model wants to look at slides but can't see pictures and no picture-reading model is set. */
  | { type: 'need-vision'; resolve: (choice: 'retry' | 'continue') => void }
  | { type: 'error'; message: string }
  | { type: 'done'; steps: number }

/** A file the user attached to their message. Text files arrive as text; pictures and PDFs as data URLs. */
export type Attachment = { name: string; mediaType: string; data: string }

/** What the user is doing in the editor right now. */
export type EditorContext = { slide: number; selection: { id: string; name: string }[]; editsSince: { label: string; slides: number[] }[] }

const activity = z.string().describe('What you are doing, in at most four plain words, e.g. "Rewriting slide 4". Shown to the user.')

/** Trims to four words; a missing activity falls back to a per-tool label, never the tool name. */
export const activityLabel = (a: string | undefined, fallback: string) => {
  const w = (a ?? '').trim().split(/\s+/).filter(Boolean)
  return w.length ? w.slice(0, 4).join(' ') : fallback
}

let auto = 0
const newId = () => `ai-${Date.now().toString(36)}-${(auto++).toString(36)}`

// ---------- compact HTML ----------

/** Large embedded values (pictures, kept PowerPoint payloads) swapped for short references, per run. */
class Assets {
  private values: string[] = []
  private texts = new Map<string, string>()
  /** A short reference for `v` (the same value always gets the same one). */
  ref(v: string) { let i = this.values.indexOf(v); if (i < 0) i = this.values.push(v) - 1; return `ream-asset:${i}` }
  /** Slide HTML as the model sees it. */
  compact(html: string): string {
    const doc = parseSlide(html)
    for (const el of doc.querySelectorAll<HTMLElement>('[src^="data:"]')) el.setAttribute('src', this.ref(el.getAttribute('src')!))
    for (const el of doc.querySelectorAll<HTMLElement>('[data-domoxml-preserved-payload]')) el.setAttribute('data-domoxml-preserved-payload', this.ref(el.getAttribute('data-domoxml-preserved-payload')!))
    for (const el of doc.querySelectorAll<HTMLElement>('[data-domoxml-text-payload]')) {
      // Imported text's exact PowerPoint form: kept only while the text it describes is unchanged.
      const r = this.ref(el.getAttribute('data-domoxml-text-payload')!)
      this.texts.set(r, (el.textContent ?? '').trim())
      el.setAttribute('data-domoxml-text-payload', r)
    }
    for (const el of doc.querySelectorAll<HTMLElement>('[style*="url(data:"]')) el.setAttribute('style', el.getAttribute('style')!.replace(/url\((["']?)(data:[^)"']+)\1\)/g, (_, q) => `url(${q}${this.ref(_.slice(4 + q.length, -1 - q.length))}${q})`))
    return doc.outerHTML
  }
  /** The model's HTML with every reference restored. */
  expand(html: string): string {
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    for (const el of doc.querySelectorAll<HTMLElement>('[data-domoxml-text-payload^="ream-asset:"]')) {
      const r = el.getAttribute('data-domoxml-text-payload')!
      if (this.texts.get(r) === (el.textContent ?? '').trim()) el.setAttribute('data-domoxml-text-payload', this.get(r))
      else el.removeAttribute('data-domoxml-text-payload')
    }
    return doc.body.innerHTML.replace(/ream-asset:(\d+)/g, (m, i) => this.values[Number(i)] ?? m)
  }
  private get(r: string) { return this.values[Number(r.split(':')[1])] ?? '' }
}

/** Normalises model-written HTML into the slide shape: one .domoxml-slide root of the deck's size whose
 *  top-level elements each carry a node id; boxes are shapes, plain text becomes paragraphs, charts are drawn.
 *  Sanitised, so nothing executable survives. */
export function normaliseSlide(html: string, size: SlideSize = { w: SLIDE_W, h: SLIDE_H }): string {
  const doc = new DOMParser().parseFromString(`<body>${sanitize(html)}</body>`, 'text/html')
  let root = doc.body.firstElementChild as HTMLElement | null
  if (!root || !root.classList.contains('domoxml-slide') || doc.body.children.length > 1) {
    const wrap = doc.createElement('div')
    wrap.className = 'domoxml-slide'
    while (doc.body.firstChild) wrap.appendChild(doc.body.firstChild)
    doc.body.appendChild(wrap)
    root = wrap
  }
  root.style.position = 'relative'
  root.style.overflow = 'hidden'
  root.style.width = `${size.w}px`
  root.style.height = `${size.h}px`
  for (const el of Array.from(root.children) as HTMLElement[]) {
    if (!el.dataset.domoxmlNodeId) el.dataset.domoxmlNodeId = newId()
    // Boxes are domOXML shapes, so the editor treats them as shapes the user can type into and format.
    if (el.tagName === 'DIV' && !el.className) el.classList.add('domoxml-shape')
    // A chart written as data: draw it (the export makes it a native chart).
    if (el.dataset.chart && !el.querySelector('svg')) {
      try { el.innerHTML = chartSvg(JSON.parse(el.dataset.chart) as ChartSpec, parseFloat(el.style.width) || 640, parseFloat(el.style.height) || 400); el.classList.add('domoxml-shape') } catch { el.removeAttribute('data-chart') }
    }
    // Its text in domOXML's paragraphs and runs, the same as text typed in the editor.
    if (plainText(el)) normalizeHost(el)
  }
  return root.outerHTML
}

function deck(id: string): Deck {
  const d = getLibrary().entries[id]
  if (!d || d.type !== 'deck') throw new Error('The deck is no longer available.')
  return d
}

// ---------- the brief ----------

function brief(d: Deck, ctx: EditorContext, assets: Assets, slim: boolean): string {
  const lines: string[] = []
  lines.push(`Deck outline (${d.slides.length} slides):`)
  d.slides.forEach((s, i) => {
    const root = parseSlide(s.html)
    const n = topNodes(root).size
    const flags = [s.hidden && 'hidden', root.getAttribute('data-notes') && 'has notes', root.getAttribute('data-transition') && `transition ${root.getAttribute('data-transition')}`].filter(Boolean).join(', ')
    lines.push(`${i + 1}. ${JSON.stringify(slideText(s).slice(0, slim ? 60 : 140))} · ${n} objects${flags ? ` · ${flags}` : ''}`)
  })
  const open = d.slides[ctx.slide]
  if (open && !slim) lines.push('', `The user is looking at slide ${ctx.slide + 1}. Its HTML:`, assets.compact(open.html))
  else if (open) lines.push('', `The user is looking at slide ${ctx.slide + 1}.`)
  if (ctx.selection.length) lines.push('', `Selected on that slide: ${ctx.selection.map((x) => `${x.name} (data-domoxml-node-id="${x.id}")`).join('; ')}. "This", "it" or "the selected" means these.`)
  if (ctx.editsSince.length) lines.push('', `Since your last turn the user changed by hand: ${ctx.editsSince.slice(-12).map((e) => `${e.label}${e.slides.length ? ` (slide ${e.slides.join(', ')})` : ''}`).join('; ')}. Keep their changes.`)
  const comments = d.slides.flatMap((s, i) => (s.comments ?? []).filter((c) => !c.resolved).map((c) => `slide ${i + 1}${c.objectIds?.length || c.objectId ? ` on ${[...(c.objectIds ?? []), ...(c.objectId ? [c.objectId] : [])].join(', ')}` : c.pin ? ` at ${Math.round(c.pin.x)},${Math.round(c.pin.y)}` : ''} [${c.id}]: ${JSON.stringify(c.text.slice(0, 200))}`))
  if (comments.length) lines.push('', `Open comments: ${comments.slice(0, 20).join('; ')}`)
  return lines.join('\n')
}

function system(d: Deck, slim: boolean) {
  const { w, h } = d.size ?? { w: SLIDE_W, h: SLIDE_H }
  if (slim) {
    return `You edit the presentation "${d.name}". Slides are HTML: one <div class="domoxml-slide"> ${w}x${h}px of absolutely positioned
elements with inline styles. Read a slide before changing it. Use edit_element for small changes, replace_slide for redesigns,
create_slides for new slides. Each tool call needs an "activity" of at most four words. End with one sentence on what you changed.`
  }
  return `You are Ream's deck assistant. You edit the user's presentation "${d.name}" directly, and you can do anything the
editor can: slides, elements, notes, transitions, animations, backgrounds, comments, the deck's styles.

Slides are HTML: one root <div class="domoxml-slide"> exactly ${w}x${h}px, containing absolutely positioned elements
(position:absolute; left/top/width/height in px). Inline styles only: no <script>, no external resources. Fonts: "Instrument Sans"
(sans), "Instrument Serif" (serif), Inter, Calibri, Arial, Georgia, Cambria, Times New Roman, Courier New.
- Keep every existing data-domoxml-node-id on elements you keep; new elements may omit it (one is assigned).
- Put each separate piece of text (title, subtitle, a card's label) in its own top-level element, not inside a decorative box,
  so the user can click and edit it. Draw a card as a box element with a text element on top.
- Tables: a <table> element. Charts: <div data-chart='{"type":"column|bar|line|pie","categories":[...],"series":[{"name":"...","values":[...]}]}'
  style="position:absolute;...">, which is drawn for you and exports as a native PowerPoint chart. Lines/arrows: an <svg>.
- Values like "ream-asset:3" stand for pictures and other embedded data: copy them exactly to keep that content.

Work well: the brief below has the outline and the open slide's HTML, so you rarely need to read first. Read other slides with
read_slides (several at once), and use view_slides to look at how slides actually render when layout or design matters
(after a redesign, check your work). Prefer edit_element for small changes, replace_slide for redesigns, create_slides for
new slides (several in one call). Slide numbers are 1-based. Keep text concise and fitting its box.

Talk to the user as you work, like a colleague would: before your first tool call, say in one short sentence what you're
going to do; between steps, add a short update only when it helps. Don't narrate every tool call. Every tool call needs an
"activity": at most four plain words. When you finish, say in one or two sentences what you changed.`
}

/** Can this model take pictures as input? The Settings override wins; otherwise what's known about it. */
export { canSee }

export async function runAgent(opts: {
  deckId: string
  context: EditorContext
  prompt: string
  files?: Attachment[]
  history: ModelMessage[]
  signal: AbortSignal
  on: (e: AgentEvent) => void
}): Promise<{ before: SlideDoc[]; after: SlideDoc[] }> {
  const chosen = getActiveModel()
  if (!chosen) throw new Error('Choose a model in Settings → AI.')
  const slim = chosen.provider === 'browser'
  const before = deck(opts.deckId).slides
  const assets = new Assets()
  const edited = new Set<number>()
  const commit = (slides: SlideDoc[], touched: number[], extra?: Partial<Deck>) => {
    if (opts.signal.aborted) throw new Error('Stopped')
    const prev = new Map(deck(opts.deckId).slides.map((s) => [s.id, s.html]))
    const stored = updateSlides(opts.deckId, slides, { extra }) ?? slides
    touched.forEach((n) => edited.add(n))
    opts.on({ type: 'edit', slides: [...edited].sort((a, b) => a - b) })
    // What changed on each slide, object by object, so the editor can show it landing.
    for (const s of stored) {
      const was = prev.get(s.id)
      if (was === s.html) continue
      const old = was ? topNodes(parseSlide(was)) : new Map<string, Element>()
      const now = topNodes(parseSlide(s.html))
      const nodes = [...now].filter(([id, el]) => old.get(id)?.outerHTML !== el.outerHTML).map(([id]) => id)
      opts.on({ type: 'changed', slideId: s.id, nodes, added: !was })
    }
  }
  const at = (n: number) => {
    const d = deck(opts.deckId)
    if (!Number.isInteger(n) || n < 1 || n > d.slides.length) throw new Error(`There is no slide ${n}; the deck has ${d.slides.length}.`)
    return d
  }
  /** Changes one slide's root element (its attributes: notes, transition, background) through the DOM. */
  const withRoot = (n: number, fn: (root: HTMLElement) => void): SlideDoc => {
    const d = at(n)
    const root = parseSlide(d.slides[n - 1].html)
    fn(root)
    return { ...d.slides[n - 1], html: root.outerHTML }
  }

  // ---------- seeing slides ----------
  const ai = getAi()
  const seeing = canSee(ai, chosen)
  const look = async (numbers: number[]): Promise<{ slide: number; image: string }[]> => {
    const d = deck(opts.deckId)
    return Promise.all(numbers.map(async (n) => ({ slide: n, image: await rasterSlide(at(n).slides[n - 1], d.size, d.css ?? '', 1024) })))
  }
  /** For a model that can't see: another model describes the pictures; or the user decides. */
  const describe = async (shots: { slide: number; image: string }[], focus: string): Promise<string> => {
    let vision: ModelRef | null | undefined = getAi().visionModel
    if (!vision) {
      const choice = await new Promise<'retry' | 'continue'>((resolve) => opts.on({ type: 'need-vision', resolve }))
      vision = choice === 'retry' ? getAi().visionModel : null
      if (!vision) return 'You can’t see pictures and the user chose to continue without. Work from the HTML.'
    }
    const v = getAi()
    const model = await providerDef(vision.provider as Exclude<ModelRef['provider'], 'browser'>).make(v.providers[vision.provider as keyof typeof v.providers] ?? {}, vision.id)
    const r = await generateText({
      model, abortSignal: opts.signal,
      messages: [{ role: 'user', content: [
        { type: 'text', text: `Describe each slide precisely for a designer who can't see it: layout and positions, colours, text, pictures, and any problems (overlap, text overflowing, poor contrast, misalignment, crowding). ${focus}` },
        ...shots.flatMap((s) => [{ type: 'text' as const, text: `Slide ${s.slide}:` }, { type: 'image' as const, image: s.image }]),
      ] }],
    })
    recordUsage(vision.provider, vision.id, { requests: 1, input: r.usage.inputTokens, output: r.usage.outputTokens })
    return r.text
  }

  const tools = {
    list_slides: tool({
      description: 'List every slide with its number and visible text (the brief already has this; use it after big changes).',
      inputSchema: z.object({ activity }),
      execute: async () => deck(opts.deckId).slides.map((s, i) => ({ slide: i + 1, hidden: !!s.hidden, text: slideText(s).slice(0, 300) })),
    }),
    read_slides: tool({
      description: "Get slides' full HTML (compact: pictures appear as ream-asset references). Read several at once.",
      inputSchema: z.object({ slides: z.array(z.number().int()).min(1).max(12), activity }),
      execute: async ({ slides }) => slides.map((n) => {
        const s = at(n).slides[n - 1]
        return { slide: n, html: assets.compact(s.html), notes: parseSlide(s.html).getAttribute('data-notes') ?? undefined }
      }),
    }),
    view_slides: tool({
      description: 'Look at slides as they actually render (pictures), to judge layout and design or check your work.',
      inputSchema: z.object({ slides: z.array(z.number().int()).min(1).max(6), focus: z.string().optional().describe('What to look for'), activity }),
      execute: async ({ slides, focus }) => {
        const shots = await look(slides)
        if (seeing) return { kind: 'images' as const, shots }
        return { kind: 'text' as const, description: await describe(shots, focus ?? '') }
      },
      toModelOutput: ({ output }) => output.kind === 'images'
        ? { type: 'content', value: output.shots.flatMap((s) => [{ type: 'text' as const, text: `Slide ${s.slide}:` }, { type: 'image-data' as const, data: s.image.split(',')[1], mediaType: 'image/jpeg' }]) }
        : { type: 'text', value: output.description },
    }),
    create_slides: tool({
      description: 'Create one or more new slides after the given slide number (0 = at the start), in order.',
      inputSchema: z.object({ after: z.number().int(), slides: z.array(z.string().describe('The slide HTML')).min(1).max(12), activity }),
      execute: async ({ after, slides: htmls }) => {
        const d = deck(opts.deckId)
        const pos = Math.max(0, Math.min(after, d.slides.length))
        const added: number[] = []
        // One at a time, so they appear one after another.
        for (const [k, html] of htmls.entries()) {
          const cur = deck(opts.deckId).slides.slice()
          cur.splice(pos + k, 0, { id: newId(), html: normaliseSlide(assets.expand(html), d.size) })
          commit(cur, [pos + k + 1])
          added.push(pos + k + 1)
          if (k < htmls.length - 1) await new Promise((r) => setTimeout(r, 120))
        }
        return { ok: true, slides: added }
      },
    }),
    replace_slide: tool({
      description: "Replace one slide's HTML entirely (keep the root's data-notes / data-transition attributes unless changing them).",
      inputSchema: z.object({ slide: z.number().int(), html: z.string(), activity }),
      execute: async ({ slide, html }) => {
        const d = at(slide)
        const slides = d.slides.slice()
        slides[slide - 1] = { ...slides[slide - 1], html: normaliseSlide(assets.expand(html), d.size) }
        commit(slides, [slide])
        return { ok: true }
      },
    }),
    edit_element: tool({
      description: 'Change one element, found by its data-domoxml-node-id: replace its HTML, merge CSS declarations into its style, or set its text.',
      inputSchema: z.object({
        slide: z.number().int(),
        nodeId: z.string(),
        outerHtml: z.string().optional().describe('New HTML for the whole element'),
        style: z.string().optional().describe('CSS declarations to merge, e.g. "left:200px;color:#111"'),
        text: z.string().optional().describe('New text content (keeps the first text styling)'),
        activity,
      }),
      execute: async ({ slide, nodeId, outerHtml, style, text }) => {
        const d = at(slide)
        const doc = new DOMParser().parseFromString(d.slides[slide - 1].html, 'text/html')
        const el = doc.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(nodeId)}"]`)
        if (!el) return { ok: false, error: `No element with data-domoxml-node-id="${nodeId}" on slide ${slide}.` }
        if (outerHtml) {
          const tpl = doc.createElement('template')
          tpl.innerHTML = sanitize(assets.expand(outerHtml))
          const next = tpl.content.firstElementChild as HTMLElement | null
          if (next && !next.dataset.domoxmlNodeId) next.dataset.domoxmlNodeId = nodeId
          if (next) el.replaceWith(next)
        }
        if (style) for (const decl of style.split(';')) {
          const [k, ...v] = decl.split(':')
          if (k?.trim() && v.length) el.style.setProperty(k.trim(), v.join(':').trim())
        }
        if (text !== undefined) {
          if (plainText(el) && !el.querySelector('.domoxml-text, li')) normalizeHost(el)
          const span = el.querySelector('span') ?? el
          span.textContent = text
          el.querySelectorAll('span').forEach((s, i) => { if (i > 0 && s.closest('.domoxml-text') === span.closest('.domoxml-text')) s.remove() })
          el.removeAttribute('data-domoxml-text-payload')
        }
        const slides = d.slides.slice()
        slides[slide - 1] = { ...slides[slide - 1], html: normaliseSlide(doc.body.innerHTML, d.size) }
        commit(slides, [slide])
        return { ok: true }
      },
    }),
    delete_elements: tool({
      description: 'Delete elements from a slide by their data-domoxml-node-id.',
      inputSchema: z.object({ slide: z.number().int(), nodeIds: z.array(z.string()).min(1), activity }),
      execute: async ({ slide, nodeIds }) => {
        const next = withRoot(slide, (root) => { for (const id of nodeIds) root.querySelector(`[data-domoxml-node-id="${CSS.escape(id)}"]`)?.remove() })
        const slides = deck(opts.deckId).slides.slice()
        slides[slide - 1] = next
        commit(slides, [slide])
        return { ok: true }
      },
    }),
    delete_slides: tool({
      description: 'Delete one or more slides.',
      inputSchema: z.object({ slides: z.array(z.number().int()).min(1), activity }),
      execute: async ({ slides: ns }) => {
        const d = deck(opts.deckId)
        ns.forEach((n) => at(n))
        const drop = new Set(ns.map((n) => n - 1))
        if (drop.size >= d.slides.length) return { ok: false, error: 'A deck needs at least one slide.' }
        commit(d.slides.filter((_, i) => !drop.has(i)), [])
        return { ok: true }
      },
    }),
    move_slide: tool({
      description: 'Move a slide to a new position.',
      inputSchema: z.object({ from: z.number().int(), to: z.number().int(), activity }),
      execute: async ({ from, to }) => {
        const d = at(from)
        at(to)
        const slides = d.slides.slice()
        const [s] = slides.splice(from - 1, 1)
        slides.splice(to - 1, 0, s)
        commit(slides, [to])
        return { ok: true }
      },
    }),
    set_slides: tool({
      description: 'Change slide settings on one or more slides: speaker notes, transition, background, or hide from the show.',
      inputSchema: z.object({
        slides: z.array(z.number().int()).min(1),
        notes: z.string().optional().describe('Speaker notes (plain text; empty removes them)'),
        transition: z.object({
          type: z.enum(['none', 'fade', 'push', 'wipe', 'split', 'cover', 'uncover', 'zoom', 'dissolve', 'morph', 'cut']),
          durationMs: z.number().optional(),
          direction: z.enum(['l', 'r', 'u', 'd']).optional().describe('For push, wipe, cover, uncover: l = from right, r = from left, u = from bottom, d = from top'),
        }).optional(),
        background: z.string().optional().describe('A CSS colour or gradient'),
        hidden: z.boolean().optional(),
        activity,
      }),
      execute: async ({ slides: ns, notes, transition, background, hidden }) => {
        let slides = deck(opts.deckId).slides.slice()
        for (const n of ns) {
          let next = withRoot(n, (root) => {
            if (notes !== undefined) { if (notes.trim()) root.setAttribute('data-notes', notes); else root.removeAttribute('data-notes') }
            if (transition) {
              if (transition.type === 'none') for (const a of ['data-transition', 'data-transition-duration', 'data-transition-direction']) root.removeAttribute(a)
              else {
                root.setAttribute('data-transition', transition.type)
                if (transition.durationMs) root.setAttribute('data-transition-duration', String(Math.round(transition.durationMs)))
                if (transition.direction) root.setAttribute('data-transition-direction', transition.direction)
              }
            }
            if (background) { root.style.removeProperty('background-image'); root.style.background = background }
          })
          if (hidden !== undefined) next = { ...next, hidden }
          slides = deck(opts.deckId).slides.slice()
          slides[n - 1] = next
          commit(slides, [n])
        }
        return { ok: true }
      },
    }),
    set_animation: tool({
      description: 'Animate an element when the slide is shown, or remove its animation.',
      inputSchema: z.object({
        slide: z.number().int(),
        nodeId: z.string(),
        effect: z.enum(['none', 'appear', 'fade', 'grow', 'spin', 'fade-out', 'disappear']),
        start: z.enum(['on-click', 'with-slide']).optional(),
        durationMs: z.number().optional(),
        delayMs: z.number().optional(),
        activity,
      }),
      execute: async ({ slide, nodeId, effect, start, durationMs, delayMs }) => {
        const next = withRoot(slide, (root) => {
          const el = root.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(nodeId)}"]`)
          if (!el) throw new Error(`No element ${nodeId} on slide ${slide}.`)
          for (const a of ['data-animate', 'data-animate-step', 'data-animate-delay', 'data-animate-duration']) el.removeAttribute(a)
          if (effect === 'none') return
          const steps = [...root.querySelectorAll('[data-animate-step]')].map((e) => Number(e.getAttribute('data-animate-step')) || 0)
          el.setAttribute('data-animate', effect)
          el.setAttribute('data-animate-step', String(start === 'with-slide' ? 0 : Math.max(0, ...steps) + 1))
          if (durationMs) el.setAttribute('data-animate-duration', String(Math.round(durationMs)))
          if (delayMs) el.setAttribute('data-animate-delay', String(Math.round(delayMs)))
        })
        const slides = deck(opts.deckId).slides.slice()
        slides[slide - 1] = next
        commit(slides, [slide])
        return { ok: true }
      },
    }),
    comment: tool({
      description: 'Leave a comment for the user on a slide (optionally on specific elements), reply to a comment, or resolve one.',
      inputSchema: z.object({
        slide: z.number().int(),
        text: z.string().optional(),
        nodeIds: z.array(z.string()).optional(),
        replyTo: z.string().optional().describe('A comment id from the brief'),
        resolve: z.string().optional().describe('A comment id to mark resolved'),
        activity,
      }),
      execute: async ({ slide, text, nodeIds, replyTo, resolve }) => {
        const d = at(slide)
        const s = d.slides[slide - 1]
        let comments = s.comments ?? []
        const now = Date.now()
        if (resolve) comments = comments.map((c) => (c.id === resolve ? { ...c, resolved: true } : c))
        if (replyTo && text) comments = comments.map((c) => (c.id === replyTo ? { ...c, replies: [...(c.replies ?? []), { id: newId(), text, at: now, by: 'ai' as const }] } : c))
        else if (text) comments = [...comments, { id: newId(), text, at: now, by: 'ai' as const, objectIds: nodeIds?.length ? nodeIds : undefined }]
        const slides = d.slides.slice()
        slides[slide - 1] = { ...s, comments }
        commit(slides, [slide])
        return { ok: true }
      },
    }),
    generate_picture: tool({
      description: 'Make a picture with the picture model (illustrations, photos, backgrounds, icons). Returns a src to use in <img src="..."> on a slide. Reference pictures (ream-asset values) guide it when given.',
      inputSchema: z.object({
        prompt: z.string().describe('A detailed description of the picture'),
        aspect: z.enum(['16:9', '4:3', '1:1', '3:4', '9:16']).optional(),
        references: z.array(z.string()).max(4).optional().describe('ream-asset values of pictures to base it on'),
        activity,
      }),
      execute: async ({ prompt, aspect, references }) => {
        const refs = (references ?? []).map((r) => assets.expand(r)).filter((u) => u.startsWith('data:'))
        const url = await makePicture({ prompt, aspect, references: refs, signal: opts.signal })
        return { src: assets.ref(url), note: 'Use this src in an <img> on a slide (object-fit:cover to fill a box).' }
      },
    }),
    rename_deck: tool({
      description: 'Give the deck a new name (short, like a file name).',
      inputSchema: z.object({ name: z.string().min(1).max(80), activity }),
      execute: async ({ name }) => { rename(opts.deckId, name, { quiet: true }); return { ok: true } },
    }),
    set_deck_styles: tool({
      description: "Read or replace the deck's shared CSS (applies to every slide, e.g. imported decks' embedded fonts). Omit css to read it.",
      inputSchema: z.object({ css: z.string().optional(), activity }),
      execute: async ({ css }) => {
        const d = deck(opts.deckId)
        if (css === undefined) return { css: d.css ?? '' }
        commit(d.slides.slice(), [], { css: css.replace(/<\/?style[^>]*>/gi, '') })
        return { ok: true }
      },
    }),
  }

  const FALLBACK: Record<string, string> = {
    list_slides: 'Looking through the deck', read_slides: 'Reading slides', view_slides: 'Looking at slides', replace_slide: 'Redesigning a slide',
    edit_element: 'Editing a slide', delete_elements: 'Removing elements', create_slides: 'Adding slides', delete_slides: 'Removing slides',
    move_slide: 'Reordering slides', rename_deck: 'Naming the deck', generate_picture: 'Making a picture', set_slides: 'Changing slide settings', set_animation: 'Adding an animation', comment: 'Leaving a comment', set_deck_styles: 'Changing deck styles',
  }

  const d0 = deck(opts.deckId)
  const sys = system(d0, slim)
  const context = brief(d0, opts.context, assets, slim)

  if (slim) {
    // The browser's built-in model: a small context, so a short prompt and only the core tools.
    const core = ['read_slides', 'replace_slide', 'edit_element', 'create_slides'] as const
    const { reply, steps } = await runBrowserLoop({
      system: sys,
      prompt: [context, ...opts.history.slice(-4).map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${String(m.content).slice(0, 600)}`), `User: ${opts.prompt}`].join('\n\n'),
      maxSteps: 10,
      signal: opts.signal,
      onDownload: (f) => opts.on({ type: 'activity', label: `Downloading the model ${Math.round(f * 100)}%` }),
      onTool: (name, input) => opts.on({ type: 'activity', label: activityLabel(input.activity as string | undefined, FALLBACK[name] ?? 'Working on it') }),
      tools: core.map((name) => {
        const t = tools[name]
        return {
          name,
          description: typeof t.description === 'string' ? t.description : '',
          schema: z.toJSONSchema(t.inputSchema as z.ZodType),
          run: async (input: unknown) => (t.execute as (i: unknown, o: unknown) => Promise<unknown>)((t.inputSchema as z.ZodType).parse(input), { toolCallId: name, messages: [] }),
        }
      }),
    })
    if (reply) opts.on({ type: 'text', delta: reply })
    recordUsage('browser', chosen.id, { requests: steps })
    opts.on({ type: 'done', steps })
    return { before, after: deck(opts.deckId).slides }
  }

  const provider = chosen.provider as AiProviderId
  const model = await providerDef(provider).make(ai.providers[provider] ?? {}, chosen.id)
  // The brief and any attached files go with the user's message.
  const content: UserContent = [{ type: 'text', text: `${context}\n\n---\n\n${opts.prompt}` }]
  for (const f of opts.files ?? []) {
    if (f.mediaType.startsWith('text/') || /json|csv|xml|markdown/.test(f.mediaType)) content.push({ type: 'text', text: `Attached file "${f.name}":\n${f.data.slice(0, 60000)}` })
    else if (f.mediaType.startsWith('image/')) content.push({ type: 'text', text: `Attached picture "${f.name}": to put it on a slide use <img src="${assets.ref(f.data)}" style="position:absolute;...;object-fit:cover">.` }, { type: 'image', image: f.data })
    else content.push({ type: 'file', data: f.data, mediaType: f.mediaType, filename: f.name })
  }
  const result = streamText({
    model,
    system: sys,
    messages: [...opts.history, { role: 'user', content }],
    tools: pictureModel() ? tools : (({ generate_picture: _, ...rest }) => rest)(tools),
    reasoning: reasoningFor(ai, chosen),
    stopWhen: isStepCount(24),
    // Rate limits (tokens per minute) are common on long runs: retry with backoff before giving up.
    maxRetries: 5,
    // Each step re-sends the conversation. Slide HTML the model already wrote or read is replaced by a short
    // note in all but the latest step, so long runs stay small (and fast, and under rate limits).
    prepareStep: ({ messages }) => ({ messages: compact(messages) }),
    abortSignal: opts.signal,
  })

  let steps = 0
  let reasoning = ''
  for await (const part of result.stream as AsyncIterable<Record<string, unknown> & { type: string }>) {
    switch (part.type) {
      case 'reasoning-start': reasoning = ''; opts.on({ type: 'thinking', on: true }); break
      case 'reasoning-delta': reasoning += String(part.text ?? part.delta ?? ''); break
      case 'reasoning-end': opts.on({ type: 'thinking', on: false, summary: reasoning.trim() || undefined }); break
      case 'tool-input-start': opts.on({ type: 'activity', label: FALLBACK[String(part.toolName)] ?? 'Working on it', live: true }); break
      case 'tool-call': {
        const input = (part.input ?? {}) as { activity?: string }
        opts.on({ type: 'activity', label: activityLabel(input.activity, FALLBACK[String(part.toolName)] ?? 'Working on it') })
        break
      }
      case 'text-delta': opts.on({ type: 'text', delta: String(part.text ?? part.delta ?? '') }); break
      case 'finish-step': steps++; break
      case 'tool-error': opts.on({ type: 'activity', label: 'Fixing a problem' }); break
      case 'error': opts.on({ type: 'error', message: errorText(part.error) }); break
    }
  }
  try {
    const u = await result.totalUsage
    recordUsage(chosen.provider, chosen.id, { requests: steps, input: u.inputTokens, output: u.outputTokens, reasoning: u.outputTokenDetails?.reasoningTokens, cached: u.inputTokenDetails?.cacheReadTokens })
  } catch { /* stopped or failed: nothing reported */ }
  opts.on({ type: 'done', steps })
  return { before, after: deck(opts.deckId).slides }
}

/** Older slide HTML and pictures in tool calls and results become a placeholder; the last assistant turn and
 *  its results stay whole. */
export function compact(messages: ModelMessage[]): ModelMessage[] {
  const keepFrom = messages.map((m) => m.role).lastIndexOf('assistant')
  const note = (s: string) => `[${s.length} characters of slide HTML, sent earlier. Use read_slides to see the current version.]`
  const big = (v: unknown) => typeof v === 'string' && v.length > 400
  return messages.map((m, i) => {
    if (i >= keepFrom || typeof m.content === 'string') return m
    if (m.role === 'assistant') {
      return { ...m, content: m.content.map((p) => {
        if (p.type !== 'tool-call' || !p.input || typeof p.input !== 'object') return p
        const input = p.input as Record<string, unknown>
        if (big(input.html)) return { ...p, input: { ...input, html: note(input.html as string) } }
        if (Array.isArray(input.slides) && input.slides.some(big)) return { ...p, input: { ...input, slides: (input.slides as unknown[]).map((x) => (big(x) ? note(x as string) : x)) } }
        return p
      }) }
    }
    if (m.role === 'tool') {
      return { ...m, content: m.content.map((p) => {
        if (p.type !== 'tool-result') return p
        if (p.output.type === 'content') return { ...p, output: { type: 'text' as const, value: '[Pictures of slides shown earlier. Use view_slides to look again.]' } }
        if (p.output.type !== 'json') return p
        const v = p.output.value as unknown
        const shrink = (o: unknown): unknown => (o && typeof o === 'object' && !Array.isArray(o) && big((o as Record<string, unknown>).html) ? { ...(o as Record<string, unknown>), html: note((o as Record<string, string>).html) } : o)
        return { ...p, output: { ...p.output, value: (Array.isArray(v) ? v.map(shrink) : shrink(v)) as typeof p.output.value } }
      }) }
    }
    return m
  })
}

function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? String(e)
  if (/401|invalid.*key|unauthori/i.test(m)) return 'The provider didn’t accept your API key. Check it in Settings → AI.'
  if (/429|rate/i.test(m)) return 'Your provider’s rate limit was reached (too much sent in a short time), even after retrying. What was done so far is kept: wait a minute, then ask it to carry on.'
  if (/fetch|network/i.test(m)) return 'Couldn’t reach the provider. Check your connection.'
  return m
}
