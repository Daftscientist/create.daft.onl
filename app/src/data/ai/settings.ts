// AI settings live in the library (SQLite meta) and sync with it, so a key added on one device
// works on the others. Without end-to-end encryption the cloud provider can read them; the UI says so.
import { getLibrary, setLibrarySettings, useLibrary } from '../library'
import { BROWSER_MODEL_ID, getBrowserModel, useBrowserModel, type BrowserModel } from './browser'
import { AI_PROVIDERS, type AiProviderId, type ProviderConfig } from './providers'

/** A model's provider: one the user added, or the browser's built-in model. */
export type ModelProvider = AiProviderId | 'browser'
export type ModelRef = { provider: ModelProvider; id: string }

export type AiSettings = {
  providers: Partial<Record<AiProviderId, ProviderConfig>>
  /** Each provider's chat models, as last listed from the provider. */
  models?: Partial<Record<AiProviderId, string[]>>
  model: ModelRef | null
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
  setAi({ models: { ...getAi().models, [id]: list } })
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
