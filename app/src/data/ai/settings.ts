// AI settings live in the library (SQLite meta) and sync with it, so a key added on one device
// works on the others. Without end-to-end encryption the cloud provider can read them; the UI says so.
import { getLibrary, setLibrarySettings, useLibrary } from '../library'
import type { AiProviderId, ProviderConfig } from './providers'

export type AiSettings = {
  providers: Partial<Record<AiProviderId, ProviderConfig>>
  model: { provider: AiProviderId; id: string } | null
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
  if (config) providers[id] = config
  else delete providers[id]
  const model = getAi().model
  setAi({ providers, model: model && !providers[model.provider] ? null : model })
}
export const aiReady = (s: AiSettings) => !!s.model && !!s.providers[s.model.provider]
