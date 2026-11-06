// The deck agent: Vercel AI SDK running fully in the browser with the user's own provider key.
// It reads and edits slides as normalized HTML (domOXML's shape). Every tool call carries an
// `activity` (≤4 words) that the panel shows instead of tool names.
import { isStepCount, streamText, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import { getLibrary, updateSlides } from '../library'
import type { Deck, SlideDoc, SlideSize } from '../types'
import { sanitize, slideText, SLIDE_H, SLIDE_W } from '../../slides/SlideView'
import { runBrowserLoop } from './browser'
import { normalizeHost } from '../../editor/text'
import { plainText } from '../../editor/ops'
import { providerDef } from './providers'
import { getActiveModel, getAi, reasoningFor } from './settings'

export type AgentEvent =
  | { type: 'thinking'; on: boolean; summary?: string }
  | { type: 'activity'; label: string }
  | { type: 'text'; delta: string }
  | { type: 'edit'; slides: number[] }
  | { type: 'error'; message: string }
  | { type: 'done'; steps: number }

const activity = z.string().describe('What you are doing, in at most four plain words, e.g. "Rewriting slide 4". Shown to the user.')

/** Trims to four words; a missing activity falls back to a per-tool label, never the tool name. */
export const activityLabel = (a: string | undefined, fallback: string) => {
  const w = (a ?? '').trim().split(/\s+/).filter(Boolean)
  return w.length ? w.slice(0, 4).join(' ') : fallback
}

let auto = 0
const newId = () => `ai-${Date.now().toString(36)}-${(auto++).toString(36)}`

/** Normalises model-written HTML into the slide shape: one 1280x720 .domoxml-slide root whose
 *  top-level elements each carry a node id. Sanitised, so nothing executable survives. */
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

function system(d: Deck, slide: number) {
  const { w, h } = d.size ?? { w: SLIDE_W, h: SLIDE_H }
  return `You are Ream's deck assistant. You edit the user's presentation "${d.name}" (${d.slides.length} slides) directly.
Slides are HTML: a single root <div class="domoxml-slide"> that is exactly ${w}x${h}px, containing absolutely
positioned elements (position:absolute with left/top/width/height in px). Use inline styles only, no <style>, <script>, classes
or external resources. Fonts available: "Instrument Sans" (sans, any weight; PowerPoint gets regular and bold) and "Instrument Serif" (serif).
Keep every existing data-domoxml-node-id attribute on elements you keep; new elements may omit it (one is assigned).
Put each separate piece of text (title, subtitle, a card's label) in its own top-level positioned element, not nested
inside a decorative box, so the user can click it and edit it. Draw a card as a box element with a text element on top.
Prefer edit_element for small changes and replace_slide for redesigns. Read a slide before changing it.
Slide numbers are 1-based. The user is looking at slide ${slide + 1}. Keep text concise and fitting its box.
Every tool call needs an "activity": at most four plain words describing what you're doing.
Talk to the user as you work, like a colleague would: before your first tool call, say in one short sentence what
you're going to do; between steps, add a short update only when it helps (a decision you made, something you
noticed). Don't narrate every tool call. When you finish, say in one or two sentences what you changed.`
}

export async function runAgent(opts: {
  deckId: string
  slide: number
  prompt: string
  history: ModelMessage[]
  signal: AbortSignal
  on: (e: AgentEvent) => void
}): Promise<{ before: SlideDoc[]; after: SlideDoc[] }> {
  const chosen = getActiveModel()
  if (!chosen) throw new Error('Choose a model in Settings → AI.')
  const before = deck(opts.deckId).slides
  const edited = new Set<number>()
  const commit = (slides: SlideDoc[], touched: number[]) => {
    if (opts.signal.aborted) throw new Error('Stopped')
    updateSlides(opts.deckId, slides)
    touched.forEach((n) => edited.add(n))
    opts.on({ type: 'edit', slides: [...edited].sort((a, b) => a - b) })
  }
  const at = (n: number) => {
    const d = deck(opts.deckId)
    if (!Number.isInteger(n) || n < 1 || n > d.slides.length) throw new Error(`There is no slide ${n}; the deck has ${d.slides.length}.`)
    return d
  }

  const tools = {
    list_slides: tool({
      description: 'List every slide with its number, id and visible text.',
      inputSchema: z.object({ activity }),
      execute: async () => deck(opts.deckId).slides.map((s, i) => ({ slide: i + 1, id: s.id, text: slideText(s).slice(0, 300) })),
    }),
    read_slide: tool({
      description: "Get one slide's full HTML.",
      inputSchema: z.object({ slide: z.number().int(), activity }),
      execute: async ({ slide }) => ({ slide, html: at(slide).slides[slide - 1].html }),
    }),
    replace_slide: tool({
      description: "Replace one slide's HTML entirely.",
      inputSchema: z.object({ slide: z.number().int(), html: z.string(), activity }),
      execute: async ({ slide, html }) => {
        const d = at(slide)
        const slides = d.slides.slice()
        slides[slide - 1] = { ...slides[slide - 1], html: normaliseSlide(html, deck(opts.deckId).size) }
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
          tpl.innerHTML = sanitize(outerHtml)
          const next = tpl.content.firstElementChild as HTMLElement | null
          if (next && !next.dataset.domoxmlNodeId) next.dataset.domoxmlNodeId = nodeId
          if (next) el.replaceWith(next)
        }
        if (style) for (const decl of style.split(';')) {
          const [k, ...v] = decl.split(':')
          if (k?.trim() && v.length) el.style.setProperty(k.trim(), v.join(':').trim())
        }
        if (text !== undefined) {
          const span = el.querySelector('span') ?? el
          span.textContent = text
          el.querySelectorAll('span').forEach((s, i) => { if (i > 0 && s.closest('.domoxml-text') === span.closest('.domoxml-text')) s.remove() })
        }
        const slides = d.slides.slice()
        slides[slide - 1] = { ...slides[slide - 1], html: normaliseSlide(doc.body.innerHTML, d.size) }
        commit(slides, [slide])
        return { ok: true }
      },
    }),
    insert_slide: tool({
      description: 'Insert a new slide after the given slide number (0 = at the start).',
      inputSchema: z.object({ after: z.number().int(), html: z.string(), activity }),
      execute: async ({ after, html }) => {
        const d = deck(opts.deckId)
        const pos = Math.max(0, Math.min(after, d.slides.length))
        const slides = d.slides.slice()
        slides.splice(pos, 0, { id: newId(), html: normaliseSlide(html, deck(opts.deckId).size) })
        commit(slides, [pos + 1])
        return { ok: true, slide: pos + 1 }
      },
    }),
    delete_slide: tool({
      description: 'Delete one slide.',
      inputSchema: z.object({ slide: z.number().int(), activity }),
      execute: async ({ slide }) => {
        const d = at(slide)
        if (d.slides.length === 1) return { ok: false, error: 'A deck needs at least one slide.' }
        commit(d.slides.filter((_, i) => i !== slide - 1), [])
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
  }

  const FALLBACK: Record<string, string> = {
    list_slides: 'Looking through the deck', read_slide: 'Reading a slide', replace_slide: 'Redesigning a slide',
    edit_element: 'Editing a slide', insert_slide: 'Adding a slide', delete_slide: 'Removing a slide', move_slide: 'Reordering slides',
  }

  const sys = system(deck(opts.deckId), opts.slide)

  if (chosen.provider === 'browser') {
    const { reply, steps } = await runBrowserLoop({
      system: sys,
      prompt: [...opts.history.map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${String(m.content)}`), opts.prompt].join('\n\n'),
      maxSteps: 16,
      signal: opts.signal,
      onDownload: (f) => opts.on({ type: 'activity', label: `Downloading the model ${Math.round(f * 100)}%` }),
      onTool: (name, input) => opts.on({ type: 'activity', label: activityLabel(input.activity as string | undefined, FALLBACK[name] ?? 'Working on it') }),
      tools: Object.entries(tools).map(([name, t]) => ({
        name,
        description: typeof t.description === 'string' ? t.description : '',
        schema: z.toJSONSchema(t.inputSchema as z.ZodType),
        run: async (input) => (t.execute as (i: unknown, o: unknown) => Promise<unknown>)((t.inputSchema as z.ZodType).parse(input), { toolCallId: name, messages: [] }),
      })),
    })
    if (reply) opts.on({ type: 'text', delta: reply })
    opts.on({ type: 'done', steps })
    return { before, after: deck(opts.deckId).slides }
  }

  const ai = getAi()
  const model = await providerDef(chosen.provider).make(ai.providers[chosen.provider] ?? {}, chosen.id)
  const result = streamText({
    model,
    system: sys,
    messages: [...opts.history, { role: 'user', content: opts.prompt }],
    tools,
    reasoning: reasoningFor(ai, chosen),
    stopWhen: isStepCount(16),
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
  opts.on({ type: 'done', steps })
  return { before, after: deck(opts.deckId).slides }
}

/** Older slide HTML in tool calls and results becomes a placeholder; the last assistant turn and its results stay. */
export function compact(messages: ModelMessage[]): ModelMessage[] {
  const keepFrom = messages.map((m) => m.role).lastIndexOf('assistant')
  const note = (s: string) => `[${s.length} characters of slide HTML, sent earlier. Use read_slide to see the current version.]`
  return messages.map((m, i) => {
    if (i >= keepFrom || typeof m.content === 'string') return m
    if (m.role === 'assistant') {
      return { ...m, content: m.content.map((p) => {
        if (p.type !== 'tool-call' || !p.input || typeof p.input !== 'object') return p
        const input = p.input as Record<string, unknown>
        return typeof input.html === 'string' && input.html.length > 400 ? { ...p, input: { ...input, html: note(input.html) } } : p
      }) }
    }
    if (m.role === 'tool') {
      return { ...m, content: m.content.map((p) => {
        if (p.type !== 'tool-result' || p.output.type !== 'json') return p
        const v = p.output.value as Record<string, unknown> | null
        return v && typeof v === 'object' && !Array.isArray(v) && typeof v.html === 'string' && v.html.length > 400
          ? { ...p, output: { ...p.output, value: { ...v, html: note(v.html) } } } : p
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
