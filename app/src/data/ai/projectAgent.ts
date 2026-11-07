// The project chat's agent (spec: projects). It knows every deck in the project and works on them by handing each
// job to the deck agent (agent.ts), the same one as Ask in the editor, so anything Ask can do to a deck the
// project chat can do too. Same keys, models, reasoning and usage as Ask.
import { isStepCount, streamText, tool, type ModelMessage, type UserContent } from 'ai'
import { z } from 'zod'
import { childrenOf, getLibrary, isLive, move, newDeck, rename } from '../library'
import { ensureContent } from '../sync'
import type { Deck, Folder, SlideDoc } from '../types'
import { slideText } from '../../slides/SlideView'
import { parseSlide } from '../../editor/irdiff'
import { runBrowserLoop } from './browser'
import { activityLabel, runAgent, type AgentEvent, type Attachment } from './agent'
import { providerDef, type AiProviderId } from './providers'
import { recordUsage } from './usage'
import { getActiveModel, getAi, reasoningFor, type ModelRef, type ReasoningLevel } from './settings'

/** A deck a turn worked on: its slides before (null: the turn made it) and after, for Undo and the turn's card. */
export type DeckWork = { deckId: string; name: string; created: boolean; before: SlideDoc[] | null; after: SlideDoc[]; summary?: string }

export type ProjectEvent =
  | Exclude<AgentEvent, { type: 'edit' } | { type: 'changed' }>
  /** A deck changed (or was made); sent again as more of it changes. */
  | { type: 'deck'; work: DeckWork }

const activity = z.string().describe('What you are doing, in at most four plain words, e.g. "Reading the pitch deck". Shown to the user.')

function project(id: string): Folder {
  const f = getLibrary().entries[id]
  if (!f || f.type !== 'folder' || !isLive(f)) throw new Error('The project is no longer available.')
  return f
}
const decksIn = (projectId: string) => childrenOf(getLibrary(), projectId).filter((e): e is Deck => e.type === 'deck').sort((a, b) => b.modifiedAt - a.modifiedAt)
const ago = (t: number) => { const m = Math.round((Date.now() - t) / 60000); return m < 60 ? `${m}m ago` : m < 2880 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago` }
const titleOf = (s: SlideDoc) => slideText(s).split('\n').map((x) => x.trim()).find(Boolean)?.slice(0, 80) ?? '(no text)'

function brief(p: Folder, slim: boolean): string {
  const lines = [`Project "${p.name}".`]
  const here = decksIn(p.id)
  if (!here.length) lines.push('It has no decks yet.')
  else {
    lines.push(`Decks in it (${here.length}), newest first. Refer to a deck by its id:`)
    for (const d of here.slice(0, slim ? 12 : 40)) {
      const titles = d.remote ? ' · slides not on this device yet (read_deck fetches them)' : ` · slides: ${d.slides.slice(0, slim ? 4 : 12).map(titleOf).map((x) => JSON.stringify(x)).join(', ')}${d.slides.length > 12 ? ', …' : ''}`
      lines.push(`- [${d.id}] "${d.name}" · ${d.remote ? '?' : d.slides.length} slides · changed ${ago(d.modifiedAt)}${d.status !== 'ready' ? ` · ${d.status}` : ''}${titles}`)
    }
  }
  const loose = childrenOf(getLibrary(), null).filter((e): e is Deck => e.type === 'deck').sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, slim ? 6 : 20)
  if (loose.length) lines.push('', `Decks in the library that aren't in any project (move_into_project can bring one in): ${loose.map((d) => `[${d.id}] "${d.name}"`).join(', ')}`)
  return lines.join('\n')
}

function system(p: Folder, slim: boolean) {
  if (slim) return `You help with the project "${p.name}", a set of presentations. Use read_deck to read one, edit_deck to change one, create_deck to make one. Each tool call needs an "activity" of at most four words. End with one sentence on what you did.`
  return `You are Ream's project assistant for the project "${p.name}": a set of presentations the user works on together.
You can read every deck in it, make new decks, and change existing ones. You don't edit slide HTML yourself: edit_deck and
create_deck hand a clear request to Ream's deck assistant, which does the slide work (layout, text, charts, pictures, notes,
animations) and reports back. Write those requests like a brief to a skilled designer: what to change or make, the content
(be specific: facts, numbers, wording from the other decks or the user's files), the audience and tone, and how many slides.
Several independent decks can be worked on one after another in a single turn.

Use read_deck before answering questions about a deck's content beyond the titles in the brief. When the user asks for
something across the project (a summary, consistency, what's missing), read the decks it concerns first.

Talk to the user like a colleague: one short sentence before you start, short updates only when useful, and at the end one
or two sentences on what you did and where (deck names). Every tool call needs an "activity": at most four plain words.`
}

export async function runProjectAgent(opts: {
  projectId: string
  model?: ModelRef | null
  reasoning?: ReasoningLevel
  prompt: string
  files?: Attachment[]
  history: ModelMessage[]
  signal: AbortSignal
  /** A turn started from a button in an interactive block: it may read, never change (spec: generative-ui.md §5.2). */
  readOnly?: boolean
  on: (e: ProjectEvent) => void
}): Promise<void> {
  const chosen = opts.model ?? getActiveModel()
  if (!chosen) throw new Error('Choose a model in Settings → AI.')
  const slim = chosen.provider === 'browser'
  const works = new Map<string, DeckWork>()
  const deck = (id: string): Deck => {
    const d = getLibrary().entries[id]
    if (!d || d.type !== 'deck' || !isLive(d)) throw new Error(`There is no deck "${id}". Use an id from the brief.`)
    return d
  }
  const inProject = (id: string) => {
    const d = deck(id)
    if (d.parentId !== opts.projectId) throw new Error(`"${d.name}" isn't in this project. Bring it in with move_into_project first.`)
    return d
  }
  const loaded = async (d: Deck): Promise<Deck> => {
    if (!d.remote) return d
    if (!(await ensureContent(d.id))) throw new Error(`"${d.name}" is stored in the cloud and couldn't be fetched (offline or signed out).`)
    return deck(d.id)
  }

  /** One job for the deck agent: its activity shows prefixed with the deck name; its words come back as the result. */
  const delegate = async (d: Deck, request: string, created: boolean) => {
    const before = created ? null : d.slides
    let said = ''
    const short = d.name.length > 22 ? `${d.name.slice(0, 21)}…` : d.name
    const report = () => {
      const now = deck(d.id)
      const w: DeckWork = { deckId: d.id, name: now.name, created, before: works.get(d.id)?.before ?? before, after: now.slides, summary: said.trim() || undefined }
      if (works.has(d.id) && works.get(d.id)!.created) w.created = true
      works.set(d.id, w)
      opts.on({ type: 'deck', work: w })
    }
    await runAgent({
      deckId: d.id, prompt: request, files: opts.files, history: [], signal: opts.signal, model: opts.model, reasoning: opts.reasoning,
      context: { slide: 0, selection: [], editsSince: [] },
      on: (ev) => {
        if (ev.type === 'activity') opts.on({ type: 'activity', label: `${short}: ${ev.label}`, live: true })
        else if (ev.type === 'text') said += ev.delta
        else if (ev.type === 'edit') report()
        else if (ev.type === 'need-vision') opts.on(ev)
        else if (ev.type === 'error') said += `\n(Problem: ${ev.message})`
      },
    })
    report()
    const now = deck(d.id)
    return { deck: now.id, name: now.name, slides: now.slides.length, reply: said.trim().slice(0, 1500) || 'Done.' }
  }

  const tools = {
    read_deck: tool({
      description: "Read a deck: every slide's text and speaker notes.",
      inputSchema: z.object({ deck: z.string().describe('The deck id from the brief'), activity }),
      execute: async ({ deck: id }) => {
        const d = await loaded(deck(id))
        const cap = slim ? 12 : 80
        return { deck: d.id, name: d.name, total: d.slides.length, note: d.slides.length > cap ? `Only the first ${cap} slides are shown.` : undefined, slides: d.slides.slice(0, cap).map((s, i) => ({ slide: i + 1, slideId: s.id, hidden: s.hidden || undefined, text: slideText(s).slice(0, slim ? 300 : 1500), notes: parseSlide(s.html).getAttribute('data-notes')?.slice(0, 800) || undefined })) }
      },
    }),
    edit_deck: tool({
      description: "Change a deck in this project: the deck assistant carries out your request on it (any change to slides, text, design, notes, order) and reports what it did.",
      inputSchema: z.object({ deck: z.string(), request: z.string().describe('A clear, specific brief for the deck assistant'), activity }),
      execute: async ({ deck: id, request }) => delegate(await loaded(inProject(id)), request, false),
    }),
    create_deck: tool({
      description: 'Make a new deck in this project: the deck assistant builds it from your request.',
      inputSchema: z.object({ name: z.string().min(1).max(80).describe('A short file name'), request: z.string().describe('What the deck is for, its content, audience, tone, and roughly how many slides'), activity }),
      execute: async ({ name, request }) => {
        const id = newDeck(opts.projectId)
        rename(id, name, { quiet: true })
        works.set(id, { deckId: id, name, created: true, before: null, after: deck(id).slides })
        opts.on({ type: 'deck', work: works.get(id)! })
        return delegate(deck(id), `Make a new presentation: ${request}\n\n(This deck is new: replace its placeholder first slide with your title slide and create the rest with create_slides. Its name is already set.)`, true)
      },
    }),
    rename_deck: tool({
      description: 'Rename a deck in this project.',
      inputSchema: z.object({ deck: z.string(), name: z.string().min(1).max(80), activity }),
      execute: async ({ deck: id, name }) => { inProject(id); rename(id, name, { quiet: true }); return { ok: true } },
    }),
    move_into_project: tool({
      description: "Bring a deck that isn't in any project into this one.",
      inputSchema: z.object({ deck: z.string(), activity }),
      execute: async ({ deck: id }) => {
        const d = deck(id)
        if (d.parentId === opts.projectId) return { ok: true, note: 'Already here.' }
        if (d.parentId !== null) throw new Error(`"${d.name}" is in another project; the user can move it themselves.`)
        move([id], opts.projectId)
        return { ok: true }
      },
    }),
    rename_project: tool({
      description: 'Rename this project.',
      inputSchema: z.object({ name: z.string().min(1).max(60), activity }),
      execute: async ({ name }) => { rename(opts.projectId, name, { quiet: true }); return { ok: true } },
    }),
  }
  const FALLBACK: Record<string, string> = { read_deck: 'Reading a deck', edit_deck: 'Changing a deck', create_deck: 'Making a deck', rename_deck: 'Renaming a deck', move_into_project: 'Bringing a deck in', rename_project: 'Renaming the project' }

  const p0 = project(opts.projectId)
  // Interactive blocks (spec: generative-ui.md): taught to capable models; the library loads only when needed.
  const blocks = slim ? '' : `\n\n${(await import('../../genui/library')).blockPrompt()}`
  const sys = system(p0, slim) + blocks + (opts.readOnly ? '\n\nThis message came from a button the person pressed in one of your blocks. You may read decks and answer (with a block if useful), but you cannot change anything in this turn; if a change is wanted, offer a @Draft or @PutOnSlide button instead.' : '')
  const context = brief(p0, slim)

  if (slim) {
    const core = ['read_deck', 'edit_deck', 'create_deck'] as const
    const { reply, steps } = await runBrowserLoop({
      system: sys,
      prompt: [context, ...opts.history.slice(-4).map((m) => `${m.role === 'user' ? 'User' : 'You'}: ${String(m.content).slice(0, 600)}`), `User: ${opts.prompt}`].join('\n\n'),
      maxSteps: 8, signal: opts.signal,
      onDownload: (f) => opts.on({ type: 'activity', label: `Downloading the model ${Math.round(f * 100)}%` }),
      onTool: (name, input) => opts.on({ type: 'activity', label: activityLabel(input.activity as string | undefined, FALLBACK[name] ?? 'Working on it') }),
      tools: core.map((name) => {
        const t = tools[name]
        return {
          name, description: typeof t.description === 'string' ? t.description : '',
          schema: z.toJSONSchema(t.inputSchema as z.ZodType),
          run: async (input: unknown) => (t.execute as (i: unknown, o: unknown) => Promise<unknown>)((t.inputSchema as z.ZodType).parse(input), { toolCallId: name, messages: [] }),
        }
      }),
    })
    if (reply) opts.on({ type: 'text', delta: reply })
    recordUsage('browser', chosen.id, { requests: steps })
    opts.on({ type: 'done', steps })
    return
  }

  const ai = getAi()
  const provider = chosen.provider as AiProviderId
  const model = await providerDef(provider).make(ai.providers[provider] ?? {}, chosen.id)
  const content: UserContent = [{ type: 'text', text: `${context}\n\n---\n\n${opts.prompt}` }]
  for (const f of opts.files ?? []) {
    if (f.mediaType.startsWith('text/') || /json|csv|xml|markdown/.test(f.mediaType)) content.push({ type: 'text', text: `Attached file "${f.name}":\n${f.data.slice(0, 60000)}` })
    else if (f.mediaType.startsWith('image/')) content.push({ type: 'text', text: `Attached picture "${f.name}" (the deck assistant gets it too when you edit or create a deck).` }, { type: 'image', image: f.data })
    else content.push({ type: 'file', data: f.data, mediaType: f.mediaType, filename: f.name })
  }
  const result = streamText({
    model, system: sys,
    messages: [...opts.history, { role: 'user', content }],
    tools: opts.readOnly ? { read_deck: tools.read_deck } : tools,
    reasoning: opts.reasoning ?? reasoningFor(ai, chosen),
    stopWhen: isStepCount(16),
    maxRetries: 5,
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
      case 'tool-call': opts.on({ type: 'activity', label: activityLabel((part.input as { activity?: string } | undefined)?.activity, FALLBACK[String(part.toolName)] ?? 'Working on it') }); break
      case 'text-delta': opts.on({ type: 'text', delta: String(part.text ?? part.delta ?? '') }); break
      case 'finish-step': steps++; break
      case 'tool-error': opts.on({ type: 'activity', label: 'Fixing a problem' }); break
      case 'error': { const m = (part.error as { message?: string })?.message ?? String(part.error); opts.on({ type: 'error', message: /401|invalid.*key/i.test(m) ? 'The provider didn’t accept your API key. Check it in Settings → AI.' : /429|rate/i.test(m) ? 'Your provider’s rate limit was reached, even after retrying. Wait a minute, then ask it to carry on.' : m }); break }
    }
  }
  try {
    const u = await result.totalUsage
    recordUsage(chosen.provider, chosen.id, { requests: steps, input: u.inputTokens, output: u.outputTokens, reasoning: u.outputTokenDetails?.reasoningTokens, cached: u.inputTokenDetails?.cacheReadTokens })
  } catch { /* stopped or failed */ }
  opts.on({ type: 'done', steps })
}
