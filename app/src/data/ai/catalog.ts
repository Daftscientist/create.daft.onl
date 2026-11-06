// Models the AI SDK knows for each provider that the provider's model list often leaves out (a key's list can
// omit picture, speech and transcription models). Offered alongside the listed ones, marked as not listed, so
// you can turn them on and the provider's own answer says whether your account can use them.
// From the SDK's model id types (@ai-sdk/openai, google, xai), November 2026.
import type { AiProviderId } from './providers'

export const KNOWN: Partial<Record<AiProviderId, string[]>> = {
  openai: [
    'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini', 'chatgpt-image-latest', 'dall-e-3', 'dall-e-2',
    'gpt-4o-mini-tts', 'tts-1', 'tts-1-hd',
    'gpt-transcribe', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1',
    'gpt-live-1', 'gpt-realtime',
  ],
  google: ['gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview', 'gemini-2.5-flash-image', 'gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts', 'gemini-3.5-transcribe'],
  xai: ['grok-imagine-image', 'grok-imagine-image-pro', 'grok-voice-transcribe-2.0'],
}

/** The provider's list plus the known models it left out; `unlisted` says which those are. */
export function withKnown(provider: AiProviderId, listed: string[]): { all: string[]; unlisted: string[] } {
  const unlisted = (KNOWN[provider] ?? []).filter((id) => !listed.includes(id))
  return { all: [...listed, ...unlisted], unlisted }
}
