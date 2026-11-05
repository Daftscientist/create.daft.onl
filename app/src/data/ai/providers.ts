// Every AI SDK provider that works from a browser (CORS checked 2026-11-05 against each API).
// Packages load only when that provider is used. Bedrock and Vertex need signed server credentials,
// so they can't run client-side and aren't offered.
import type { LanguageModel } from 'ai'

export type ProviderConfig = { apiKey?: string; baseURL?: string }
type Def = {
  name: string
  needs: ('apiKey' | 'baseURL')[]
  keyHint?: string
  baseHint?: string
  keysUrl?: string
  /** Lists models straight from the provider (no stale hard-coded names). */
  models?: (c: ProviderConfig) => Promise<string[]>
  make: (c: ProviderConfig, model: string) => Promise<LanguageModel>
}

async function list(url: string, headers: Record<string, string>, pick: (j: any) => string[]): Promise<string[]> {
  const res = await fetch(url, { headers })
  if (!res.ok) throw new Error(res.status === 401 ? 'That key wasn’t accepted.' : `The provider answered ${res.status}.`)
  return pick(await res.json()).filter((id) => !NOT_CHAT.test(id)).sort()
}
/** Listing endpoints include embedding, speech and image models; Ask Ream needs chat models. */
const NOT_CHAT = /embed|tts|whisper|dall-e|moderation|transcri|realtime|audio|image|rerank|guard|davinci|babbage|search-preview|computer-use|veo|imagen|lyria/i
const openaiLike = (base: string) => (c: ProviderConfig) =>
  list(`${c.baseURL || base}/models`, c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}, (j) => (j.data ?? []).map((m: { id: string }) => m.id))

export const AI_PROVIDERS = {
  anthropic: {
    name: 'Anthropic', needs: ['apiKey'], keyHint: 'sk-ant-…', keysUrl: 'https://console.anthropic.com/settings/keys',
    models: (c) => list('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': c.apiKey!, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, (j) => j.data.map((m: { id: string }) => m.id)),
    make: async (c, m) => (await import('@ai-sdk/anthropic')).createAnthropic({ apiKey: c.apiKey, headers: { 'anthropic-dangerous-direct-browser-access': 'true' } })(m),
  },
  openai: {
    name: 'OpenAI', needs: ['apiKey'], keyHint: 'sk-…', keysUrl: 'https://platform.openai.com/api-keys', models: openaiLike('https://api.openai.com/v1'),
    make: async (c, m) => (await import('@ai-sdk/openai')).createOpenAI({ apiKey: c.apiKey })(m),
  },
  google: {
    name: 'Google Gemini', needs: ['apiKey'], keysUrl: 'https://aistudio.google.com/apikey',
    models: (c) => list('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': c.apiKey! }, (j) => j.models.filter((m: { supportedGenerationMethods: string[] }) => m.supportedGenerationMethods.includes('generateContent')).map((m: { name: string }) => m.name.replace('models/', ''))),
    make: async (c, m) => (await import('@ai-sdk/google')).createGoogleGenerativeAI({ apiKey: c.apiKey })(m),
  },
  openrouter: {
    name: 'OpenRouter', needs: ['apiKey'], keysUrl: 'https://openrouter.ai/keys', models: openaiLike('https://openrouter.ai/api/v1'),
    make: async (c, m) => (await import('@openrouter/ai-sdk-provider')).createOpenRouter({ apiKey: c.apiKey })(m),
  },
  mistral: {
    name: 'Mistral', needs: ['apiKey'], keysUrl: 'https://console.mistral.ai/api-keys', models: openaiLike('https://api.mistral.ai/v1'),
    make: async (c, m) => (await import('@ai-sdk/mistral')).createMistral({ apiKey: c.apiKey })(m),
  },
  xai: {
    name: 'xAI', needs: ['apiKey'], keysUrl: 'https://console.x.ai', models: openaiLike('https://api.x.ai/v1'),
    make: async (c, m) => (await import('@ai-sdk/xai')).createXai({ apiKey: c.apiKey })(m),
  },
  groq: {
    name: 'Groq', needs: ['apiKey'], keysUrl: 'https://console.groq.com/keys', models: openaiLike('https://api.groq.com/openai/v1'),
    make: async (c, m) => (await import('@ai-sdk/groq')).createGroq({ apiKey: c.apiKey })(m),
  },
  deepseek: {
    name: 'DeepSeek', needs: ['apiKey'], keysUrl: 'https://platform.deepseek.com/api_keys', models: openaiLike('https://api.deepseek.com'),
    make: async (c, m) => (await import('@ai-sdk/deepseek')).createDeepSeek({ apiKey: c.apiKey })(m),
  },
  cerebras: {
    name: 'Cerebras', needs: ['apiKey'], keysUrl: 'https://cloud.cerebras.ai', models: openaiLike('https://api.cerebras.ai/v1'),
    make: async (c, m) => (await import('@ai-sdk/cerebras')).createCerebras({ apiKey: c.apiKey })(m),
  },
  togetherai: {
    name: 'Together AI', needs: ['apiKey'], keysUrl: 'https://api.together.ai/settings/api-keys', models: (c) => list('https://api.together.xyz/v1/models', { Authorization: `Bearer ${c.apiKey}` }, (j) => (Array.isArray(j) ? j : j.data).map((m: { id: string }) => m.id)),
    make: async (c, m) => (await import('@ai-sdk/togetherai')).createTogetherAI({ apiKey: c.apiKey })(m),
  },
  fireworks: {
    name: 'Fireworks', needs: ['apiKey'], keysUrl: 'https://fireworks.ai/account/api-keys', models: openaiLike('https://api.fireworks.ai/inference/v1'),
    make: async (c, m) => (await import('@ai-sdk/fireworks')).createFireworks({ apiKey: c.apiKey })(m),
  },
  perplexity: {
    name: 'Perplexity', needs: ['apiKey'], keysUrl: 'https://www.perplexity.ai/settings/api',
    make: async (c, m) => (await import('@ai-sdk/perplexity')).createPerplexity({ apiKey: c.apiKey })(m),
  },
  cohere: {
    name: 'Cohere', needs: ['apiKey'], keysUrl: 'https://dashboard.cohere.com/api-keys',
    models: (c) => list('https://api.cohere.com/v1/models?endpoint=chat', { Authorization: `Bearer ${c.apiKey}` }, (j) => j.models.map((m: { name: string }) => m.name)),
    make: async (c, m) => (await import('@ai-sdk/cohere')).createCohere({ apiKey: c.apiKey })(m),
  },
  azure: {
    name: 'Azure OpenAI', needs: ['apiKey', 'baseURL'], baseHint: 'https://<resource>.openai.azure.com/openai',
    make: async (c, m) => (await import('@ai-sdk/azure')).createAzure({ apiKey: c.apiKey, baseURL: c.baseURL })(m),
  },
  local: {
    name: 'Local model (Ollama, LM Studio)', needs: ['baseURL'], baseHint: 'http://localhost:11434/v1',
    models: openaiLike('http://localhost:11434/v1'),
    make: async (c, m) => (await import('@ai-sdk/openai-compatible')).createOpenAICompatible({ name: 'local', baseURL: c.baseURL || 'http://localhost:11434/v1', apiKey: c.apiKey })(m),
  },
} satisfies Record<string, Def>

export type AiProviderId = keyof typeof AI_PROVIDERS
export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[]
export const providerDef = (id: AiProviderId): Def => AI_PROVIDERS[id]
