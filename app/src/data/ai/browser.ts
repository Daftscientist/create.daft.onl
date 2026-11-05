// The browser's own on-device model (the Prompt API: Gemini Nano in Chrome, Phi-4-mini in Edge).
// Nothing to set up: if the browser has one it shows up automatically. It runs offline and free,
// but it is small, so it gets a compact tool loop driven by a JSON response constraint (native
// tool calling hasn't shipped everywhere yet).
import { useSyncExternalStore } from 'react'

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available'
type Session = {
  prompt: (input: string, opts?: { signal?: AbortSignal; responseConstraint?: object }) => Promise<string>
  destroy: () => void
}
type LanguageModelStatic = {
  availability: (opts?: object) => Promise<Availability>
  create: (opts?: object) => Promise<Session>
}
const api = (): LanguageModelStatic | undefined => (globalThis as { LanguageModel?: LanguageModelStatic }).LanguageModel

export type BrowserModel = { status: Availability; name: string; model: string }

const isEdge = () => /\bEdg\//.test(navigator.userAgent)
const describe = (): Pick<BrowserModel, 'name' | 'model'> =>
  isEdge() ? { name: 'Built into Edge', model: 'Phi-4-mini' } : { name: 'Built into Chrome', model: 'Gemini Nano' }

const LANGS = { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] }

let current: BrowserModel | null = null
const listeners = new Set<() => void>()
let checked = false
async function check() {
  const lm = api()
  if (!lm) return
  try {
    const status = await lm.availability(LANGS)
    current = status === 'unavailable' ? null : { status, ...describe() }
  } catch { current = null }
  listeners.forEach((l) => l())
}
/** The built-in model, or null when this browser has none. Checked once, on first use. */
export function useBrowserModel(): BrowserModel | null {
  if (!checked) { checked = true; void check() }
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => current)
}
export const getBrowserModel = () => current
export const BROWSER_MODEL_ID = 'built-in'

export type BrowserTool = { name: string; description: string; schema: object; run: (input: Record<string, unknown>) => Promise<unknown> }

/** Runs the agent loop on the built-in model. Each turn the model answers with one JSON action:
 *  a tool call or the final reply. Tool results go back as the next prompt in the same session. */
export async function runBrowserLoop(opts: {
  system: string
  prompt: string
  tools: BrowserTool[]
  maxSteps: number
  signal: AbortSignal
  onDownload: (fraction: number) => void
  onTool: (name: string, input: Record<string, unknown>) => void
}): Promise<{ reply: string; steps: number }> {
  const lm = api()
  if (!lm) throw new Error('This browser no longer offers a built-in model.')
  const toolList = opts.tools.map((t) => `- ${t.name}: ${t.description} Input: ${JSON.stringify(t.schema)}`).join('\n')
  const session = await lm.create({
    ...LANGS,
    signal: opts.signal,
    monitor: (m: EventTarget) => m.addEventListener('downloadprogress', (e) => opts.onDownload((e as ProgressEvent).loaded)),
    initialPrompts: [{
      role: 'system',
      content: `${opts.system}\n\nYou act by answering with JSON only, one action at a time:\n{"action":"<tool name>","input":{...}} to use a tool, or {"action":"reply","reply":"..."} when you are done.\nTools:\n${toolList}`,
    }],
  })
  const constraint = {
    type: 'object',
    properties: {
      action: { type: 'string', enum: [...opts.tools.map((t) => t.name), 'reply'] },
      input: { type: 'object' },
      reply: { type: 'string' },
    },
    required: ['action'],
  }
  try {
    let next = opts.prompt
    for (let step = 1; step <= opts.maxSteps; step++) {
      const raw = await session.prompt(next, { signal: opts.signal, responseConstraint: constraint })
      let act: { action?: string; input?: Record<string, unknown>; reply?: string }
      try { act = JSON.parse(raw) } catch { next = 'That was not valid JSON. Answer with one JSON action.'; continue }
      if (act.action === 'reply' || !act.action) return { reply: act.reply ?? '', steps: step }
      const t = opts.tools.find((x) => x.name === act.action)
      if (!t) { next = `There is no tool "${act.action}".`; continue }
      opts.onTool(t.name, act.input ?? {})
      let result: unknown
      try { result = await t.run(act.input ?? {}) } catch (e) { result = { ok: false, error: (e as Error).message } }
      next = `Result of ${t.name}: ${JSON.stringify(result)}`
    }
    return { reply: 'I stopped after too many steps. Ask again with a smaller change.', steps: opts.maxSteps }
  } catch (e) {
    if ((e as Error).name === 'QuotaExceededError') throw new Error('That was too much for the built-in model. Try a smaller change, or a cloud model in Settings → AI.')
    throw e
  } finally {
    session.destroy()
  }
}
