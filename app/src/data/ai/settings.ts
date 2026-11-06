// AI settings live in the library (SQLite meta) and sync with it, so a key added on one device
// works on the others. Without end-to-end encryption the cloud provider can read them; the UI says so.
import { getLibrary, setLibrarySettings, useLibrary } from '../library'
import { BROWSER_MODEL_ID, getBrowserModel, useBrowserModel, type BrowserModel } from './browser'
import { AI_PROVIDERS, AI_PROVIDER_IDS, type AiProviderId, type ProviderConfig } from './providers'
import { classify, type Capability } from './capabilities'
import { withKnown } from './catalog'

/** A model's provider: one the user added, or the browser's built-in model. */
export type ModelProvider = AiProviderId | 'browser'
export type ModelRef = { provider: ModelProvider; id: string }

export type AiSettings = {
  providers: Partial<Record<AiProviderId, ProviderConfig>>
  /** Each provider's chat models, as last listed from the provider. */
  models?: Partial<Record<AiProviderId, string[]>>
  /** Known models the provider's own list left out (offered anyway; see data/ai/catalog). */
  unlisted?: Partial<Record<AiProviderId, string[]>>
  model: ModelRef | null
  /** The reasoning level last chosen for each model (`provider:id`); absent = the provider's default. */
  reasoning?: Record<string, ReasoningLevel>
  /** A model that can see pictures, used to describe slides to a chosen model that can't. */
  visionModel?: ModelRef | null
  /** Per model (`provider:id`): whether it can take pictures, when the user has said so. */
  vision?: Record<string, boolean>
  /** Per provider: the models the user chose to use (from the setup flow). Absent: its chat models. */
  enabled?: Partial<Record<AiProviderId, string[]>>
  /** The picture-generation model Ream uses (Picture → Generate, and Ask's tool). */
  imageModel?: ModelRef | null
  /** Voice agents the user built, and the one in use (ids; 'browser' is the built-in one). */
  voiceAgents?: import('./voice').VoiceAgent[]
  activeVoice?: string | null
  /** Voice and thinking-model changes to the ready-made voice agents, by agent id. */
  voiceTweaks?: Record<string, { voice?: string; llm?: ModelRef | null; supervisor?: ModelRef | null; reasoning?: ReasoningLevel }>
}

export type ReasoningLevel = 'provider-default' | 'none' | 'low' | 'medium' | 'high' | 'max'
export const REASONING_LEVELS: { level: ReasoningLevel; label: string }[] = [
  { level: 'provider-default', label: 'Default' }, { level: 'none', label: 'Off' }, { level: 'low', label: 'Low' },
  { level: 'medium', label: 'Medium' }, { level: 'high', label: 'High' }, { level: 'max', label: 'Max' },
]
export const modelKey = (m: ModelRef) => `${m.provider}:${m.id}`
/** Model families known to read pictures. Anything else is treated as text-only unless the user says otherwise. */
const SEES = /gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|gpt-6|o3|o4|chatgpt|claude-(3|sonnet|opus|haiku|4|5|fable)|gemini|gemma-3|grok-(2-vision|4|5|vision)|pixtral|mistral-(medium|small)-(2|3)|llava|llama-4|qwen.*vl|qwen3|vision|minicpm-v|moondream|kimi-k2/i
export function canSee(s: AiSettings, m: ModelRef | null): boolean {
  if (!m || m.provider === 'browser') return false
  const said = s.vision?.[modelKey(m)]
  return said ?? SEES.test(m.id)
}
export function setCanSee(m: ModelRef, value: boolean | null) {
  const v = { ...getAi().vision }
  if (value === null) delete v[modelKey(m)]; else v[modelKey(m)] = value
  setAi({ vision: v })
}
export const reasoningFor = (s: AiSettings, m: ModelRef | null): ReasoningLevel => (m && s.reasoning?.[modelKey(m)]) || 'provider-default'
export function setReasoning(m: ModelRef, level: ReasoningLevel) {
  const r = { ...getAi().reasoning }
  if (level === 'provider-default') delete r[modelKey(m)]; else r[modelKey(m)] = level
  setAi({ reasoning: r })
}
const EMPTY: AiSettings = { providers: {}, model: null }

export const getAi = (): AiSettings => (getLibrary().settings?.ai as AiSettings | undefined) ?? EMPTY
export function useAi(): AiSettings {
  return (useLibrary().settings?.ai as AiSettings | undefined) ?? EMPTY
}
export function setAi(update: Partial<AiSettings>) {
  setLibrarySettings({ ai: { ...getAi(), ...update } })
}
export function setProvider(id: AiProviderId, config: ProviderConfig | null) {
  const providers = { ...getAi().providers }
  const models = { ...getAi().models }
  if (config) providers[id] = config
  else { delete providers[id]; delete models[id] }
  const model = getAi().model
  setAi({ providers, models, model: model && model.provider !== 'browser' && !providers[model.provider] ? null : model })
}
export function setModels(id: AiProviderId, list: string[]) {
  const { all, unlisted } = withKnown(id, list)
  setAi({ models: { ...getAi().models, [id]: all }, unlisted: { ...getAi().unlisted, [id]: unlisted } })
}

/** The chosen model, falling back to the browser's built-in one when nothing is chosen. */
export function activeModel(s: AiSettings, browser: BrowserModel | null): ModelRef | null {
  if (s.model?.provider === 'browser') return browser ? s.model : null
  if (s.model && s.providers[s.model.provider]) return s.model
  return browser ? { provider: 'browser', id: BROWSER_MODEL_ID } : null
}
export const getActiveModel = () => activeModel(getAi(), getBrowserModel())
export function useActiveModel(): ModelRef | null {
  return activeModel(useAi(), useBrowserModel())
}

/** A provider's display name, including the browser's built-in model. */
export function providerName(p: ModelProvider, browser: BrowserModel | null): string {
  return p === 'browser' ? browser?.name ?? 'Built-in model' : AI_PROVIDERS[p].name
}
/** How a model reads in pickers: the built-in one by its real name, others by id without the vendor prefix. */
export function modelLabel(m: ModelRef, browser: BrowserModel | null): string {
  return m.provider === 'browser' ? browser?.model ?? 'Built-in model' : m.id.split('/').pop() ?? m.id
}

/** Is this model one the user turned on? Without a choice for its provider, its chat models are. */
export function isEnabled(s: AiSettings, provider: AiProviderId, id: string): boolean {
  const on = s.enabled?.[provider]
  return on ? on.includes(id) : classify(provider, id) === 'text'
}
/** The enabled models of a kind, across connected providers. */
export function modelsFor(s: AiSettings, cap: Capability): ModelRef[] {
  return AI_PROVIDER_IDS.filter((p) => s.providers[p]).flatMap((p) => (s.models?.[p] ?? []).filter((id) => classify(p, id) === cap && isEnabled(s, p, id)).map((id) => ({ provider: p, id })))
}
export function setEnabled(provider: AiProviderId, ids: string[]) {
  setAi({ enabled: { ...getAi().enabled, [provider]: ids } })
}
