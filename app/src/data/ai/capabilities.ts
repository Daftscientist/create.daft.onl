// What a provider's models do, so connecting a provider can ask which kinds to use (spec: provider setup):
// chat models (which may also see pictures), picture generation, live voice, speech, transcription, video.
// Providers mostly list bare ids, so this reads the id; the user confirms every choice in the setup flow.
import type { AiProviderId } from './providers'

export type Capability = 'text' | 'image' | 'voice' | 'speech' | 'transcription' | 'video' | 'embedding' | 'other'

export const CAPABILITIES: { id: Capability; label: string; description: string }[] = [
  { id: 'text', label: 'Chat models', description: 'Ask, Home and voice agents think with these. Many can also see pictures.' },
  { id: 'image', label: 'Picture generation', description: 'Make pictures for slides: in Picture → Generate, and as a tool Ask can use.' },
  { id: 'voice', label: 'Live voice', description: 'Speech-to-speech models for talking to Ream in real time.' },
  { id: 'speech', label: 'Text to speech', description: 'Voices for voice agents you build from parts.' },
  { id: 'transcription', label: 'Speech to text', description: 'Transcription for voice agents you build from parts.' },
  { id: 'video', label: 'Video generation', description: 'Not used by Ream yet.' },
  { id: 'embedding', label: 'Embeddings', description: 'Not used by Ream yet.' },
  { id: 'other', label: 'Other', description: 'Moderation, search and other special-purpose models. Not used by Ream.' },
]

export function classify(_provider: AiProviderId, id: string): Capability {
  const m = id.toLowerCase()
  if (/realtime|[-_]live\b|live-|native-audio|voice-|grok-voice|gpt-live|audio-preview|s2s/.test(m)) return 'voice'
  if (/transcri|whisper|\bstt\b|scribe|nova-[23]|speech-to-text|asr/.test(m)) return 'transcription'
  if (/\btts\b|-tts|tts-|text-to-speech|aura|sonic|eleven|playai|speech/.test(m)) return 'speech'
  if (/sora|veo|video|kling|wan-|hunyuan-video|ray-/.test(m)) return 'video'
  if (/embed|embedding|rerank/.test(m)) return 'embedding'
  if (/gpt-image|dall-e|imagen|image-gen|flux|stable-diffusion|sdxl|sd3|recraft|ideogram|seedream|playground-v|grok-2-image|grok-imagine|-image(-preview)?$|image-\d|aurora/.test(m)) return 'image'
  if (/moderation|guard|search|computer-use|codex-mini|babbage|davinci|ada-|curie/.test(m)) return 'other'
  return 'text'
}
