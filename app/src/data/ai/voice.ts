// Voice (spec: live voice). Two kinds of voice agent, chosen in Settings → AI → Voice:
// - Live: a speech-to-speech realtime model (OpenAI realtime over WebRTC, straight from the browser with the
//   user's key) that talks with you and hands deck work to a chat model through one tool (the chat-supervisor
//   pattern: quick turn-taking in voice, careful work in text).
// - Built from parts: speech to text (the browser's own, or a transcription model), a chat model with its
//   reasoning level doing the work with every tool, and text to speech (the browser's voices, or a speech model).
// The built-in "Browser voice" agent needs no setup where the browser has speech recognition.
import { experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe } from 'ai'
import { providerDef, type AiProviderId } from './providers'
import { getAi, setAi, type AiSettings, type ModelRef, type ReasoningLevel } from './settings'
import { recordUsage } from './usage'

export type VoiceAgent =
  | { id: string; name: string; kind: 'live'; model: ModelRef; voice?: string; supervisor: ModelRef | null; reasoning?: ReasoningLevel }
  | { id: string; name: string; kind: 'parts'; stt: ModelRef | 'browser'; llm: ModelRef | null; reasoning?: ReasoningLevel; tts: ModelRef | 'browser'; voice?: string }

type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
const RecognitionCtor = (): (new () => Recognition) | null => ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition) ?? null
export const browserCanListen = () => !!RecognitionCtor()

export const BROWSER_AGENT: VoiceAgent = { id: 'browser', name: 'Browser voice', kind: 'parts', stt: 'browser', llm: null, tts: 'browser' }
/** Every voice agent: the browser's own (where it can listen), then the user's. */
export function voiceAgents(s: AiSettings): VoiceAgent[] {
  return [...(browserCanListen() ? [BROWSER_AGENT] : []), ...(s.voiceAgents ?? [])]
}
export function activeVoiceAgent(s: AiSettings): VoiceAgent | null {
  const all = voiceAgents(s)
  return all.find((a) => a.id === s.activeVoice) ?? all[0] ?? null
}
export function saveVoiceAgent(a: VoiceAgent) {
  const list = getAi().voiceAgents ?? []
  setAi({ voiceAgents: list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a], activeVoice: a.id })
}
export function deleteVoiceAgent(id: string) {
  const ai = getAi()
  setAi({ voiceAgents: (ai.voiceAgents ?? []).filter((x) => x.id !== id), activeVoice: ai.activeVoice === id ? null : ai.activeVoice })
}

// ---------- listening ----------

export type Listener = { stop: () => void; mute: (on: boolean) => void }
type Hear = { onPartial: (text: string) => void; onUtterance: (text: string) => void; onLevel?: (v: number) => void; onError: (message: string) => void }

/** The browser's speech recognition, continuous; each final phrase (after a short pause) is an utterance. */
function browserListener(h: Hear): Listener {
  const Ctor = RecognitionCtor()
  if (!Ctor) throw new Error('This browser can’t recognise speech. Choose a voice agent with a speech-to-text model.')
  const r = new Ctor()
  r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US'
  let muted = false, stopped = false, said = '', timer = 0
  r.onresult = (e) => {
    if (muted) return
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) said += `${res[0].transcript} `
      else interim += res[0].transcript
    }
    h.onPartial(`${said}${interim}`.trim())
    clearTimeout(timer)
    if (said.trim() && !interim) timer = window.setTimeout(() => { const t = said.trim(); said = ''; if (t) h.onUtterance(t) }, 700)
  }
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') h.onError(e.error === 'not-allowed' ? 'Ream needs the microphone. Allow it in the browser’s address bar.' : `Speech recognition stopped (${e.error}).`) }
  r.onend = () => { if (!stopped) try { r.start() } catch { /* already running */ } }
  r.start()
  return { stop: () => { stopped = true; clearTimeout(timer); r.abort() }, mute: (on) => { muted = on; if (on) { said = ''; h.onPartial('') } } }
}

/** The microphone, cut into utterances by silence, each transcribed by the agent's speech-to-text model. */
async function modelListener(h: Hear, stt: ModelRef): Promise<Listener> {
  const def = providerDef(stt.provider as AiProviderId)
  if (!def.makeTranscription) throw new Error(`${def.name} can’t transcribe from the browser.`)
  const model = await def.makeTranscription(getAi().providers[stt.provider as AiProviderId] ?? {}, stt.id)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  let muted = false, stopped = false, rec: MediaRecorder | null = null, chunks: Blob[] = [], quietSince = 0, speaking = false
  const startRec = () => { chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data); rec.start() }
  const finish = () => {
    const r = rec; rec = null
    if (!r) return
    r.onstop = async () => {
      const blob = new Blob(chunks, { type: r.mimeType })
      if (blob.size < 2000) return
      try {
        h.onPartial('…')
        const out = await transcribe({ model, audio: new Uint8Array(await blob.arrayBuffer()) })
        recordUsage(stt.provider, stt.id, { requests: 1 })
        h.onPartial('')
        if (out.text.trim()) h.onUtterance(out.text.trim())
      } catch (e) { h.onError((e as Error).message) }
    }
    r.stop()
  }
  const loop = () => {
    if (stopped) return
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    const level = Math.sqrt(sum / buf.length)
    h.onLevel?.(level)
    if (!muted) {
      if (level > 0.025) { quietSince = 0; if (!speaking) { speaking = true; startRec(); h.onPartial('Listening…') } }
      else if (speaking) { quietSince ||= performance.now(); if (performance.now() - quietSince > 900) { speaking = false; finish() } }
    }
    requestAnimationFrame(loop)
  }
  loop()
  return {
    stop: () => { stopped = true; rec?.stop(); stream.getTracks().forEach((t) => t.stop()); void ctx.close() },
    mute: (on) => { muted = on; if (on && rec) { speaking = false; rec.onstop = null; rec.stop(); rec = null } },
  }
}

export function listen(agent: VoiceAgent & { kind: 'parts' }, h: Hear): Promise<Listener> {
  return agent.stt === 'browser' ? Promise.resolve(browserListener(h)) : modelListener(h, agent.stt)
}

// ---------- speaking ----------

export type Speaker = { say: (text: string) => Promise<void>; stop: () => void }

export function speaker(agent: VoiceAgent & { kind: 'parts' }): Speaker {
  let audio: HTMLAudioElement | null = null
  let chain: Promise<void> = Promise.resolve()
  let gen = 0
  if (agent.tts === 'browser') {
    return {
      say: (text) => new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text)
        const v = speechSynthesis.getVoices().find((x) => x.name === agent.voice)
        if (v) u.voice = v
        u.onend = () => resolve(); u.onerror = () => resolve()
        speechSynthesis.speak(u)
      }),
      stop: () => speechSynthesis.cancel(),
    }
  }
  const tts = agent.tts
  return {
    say: (text) => {
      const my = gen
      chain = chain.then(async () => {
        if (my !== gen) return
        const def = providerDef(tts.provider as AiProviderId)
        if (!def.makeSpeech) throw new Error(`${def.name} can’t speak from the browser.`)
        const model = await def.makeSpeech(getAi().providers[tts.provider as AiProviderId] ?? {}, tts.id)
        const r = await generateSpeech({ model, text, voice: agent.voice })
        recordUsage(tts.provider, tts.id, { requests: 1 })
        if (my !== gen) return
        const url = URL.createObjectURL(new Blob([r.audio.uint8Array.slice()], { type: r.audio.mediaType || 'audio/mpeg' }))
        audio = new Audio(url)
        await new Promise<void>((res) => { audio!.onended = () => res(); audio!.onerror = () => res(); void audio!.play().catch(() => res()) })
        URL.revokeObjectURL(url)
      }).catch(() => undefined)
      return chain
    },
    stop: () => { gen++; audio?.pause(); audio = null },
  }
}

// ---------- live (realtime) ----------

export type LiveTool = { name: string; description: string; parameters: Record<string, unknown>; run: (args: Record<string, unknown>) => Promise<string> }
export type Live = { stop: () => void; mute: (on: boolean) => void }

/** An OpenAI realtime session over WebRTC from the browser: a short-lived key minted with the user's key, then
 *  the call. Audio both ways; transcripts and tool calls over the data channel. */
export async function startLive(agent: VoiceAgent & { kind: 'live' }, o: {
  instructions: string
  tools: LiveTool[]
  onUser: (text: string) => void
  onAssistant: (text: string, done: boolean) => void
  onState: (s: 'connecting' | 'listening' | 'speaking' | 'working') => void
  onError: (message: string) => void
}): Promise<Live> {
  if (agent.model.provider !== 'openai') throw new Error('Live voice works with OpenAI realtime models for now. For other providers, build a voice agent from parts.')
  const key = getAi().providers.openai?.apiKey
  if (!key) throw new Error('Add your OpenAI key in Settings → AI.')
  o.onState('connecting')
  const session = {
    type: 'realtime', model: agent.model.id, instructions: o.instructions,
    audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } }, output: { voice: agent.voice || 'marin' } },
    tools: o.tools.map((t) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })),
  }
  const minted = await fetch('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session }) })
    .catch(() => { throw new Error('Couldn’t reach OpenAI from this browser to start live voice.') })
  if (!minted.ok) throw new Error(`OpenAI didn’t start live voice (${minted.status}). ${minted.status === 404 || minted.status === 400 ? 'Check that the model is a realtime model.' : ''}`.trim())
  const secret = ((await minted.json()) as { value?: string; client_secret?: { value: string } })
  const ephemeral = secret.value ?? secret.client_secret?.value
  if (!ephemeral) throw new Error('OpenAI didn’t return a session key.')

  const pc = new RTCPeerConnection()
  const out = new Audio(); out.autoplay = true
  pc.ontrack = (e) => { out.srcObject = e.streams[0] }
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
  const track = mic.getTracks()[0]
  pc.addTrack(track, mic)
  const dc = pc.createDataChannel('oai-events')
  const send = (ev: Record<string, unknown>) => { if (dc.readyState === 'open') dc.send(JSON.stringify(ev)) }
  let said = ''
  dc.onmessage = async (m) => {
    const ev = JSON.parse(m.data as string) as Record<string, any>
    switch (ev.type) {
      case 'input_audio_buffer.speech_started': o.onState('listening'); break
      case 'conversation.item.input_audio_transcription.completed': if (ev.transcript?.trim()) o.onUser(ev.transcript.trim()); break
      case 'response.output_audio_transcript.delta': case 'response.audio_transcript.delta': said += ev.delta ?? ''; o.onState('speaking'); o.onAssistant(said, false); break
      case 'response.output_audio_transcript.done': case 'response.audio_transcript.done': o.onAssistant(ev.transcript ?? said, true); said = ''; break
      case 'response.done': o.onState('listening'); recordUsage('openai', agent.model.id, { requests: 1, input: ev.response?.usage?.input_tokens, output: ev.response?.usage?.output_tokens }); break
      case 'response.function_call_arguments.done': {
        const tool = o.tools.find((t) => t.name === ev.name)
        o.onState('working')
        let output = 'That tool isn’t available.'
        try { if (tool) output = await tool.run(JSON.parse(ev.arguments || '{}')) } catch (e) { output = `It failed: ${(e as Error).message}` }
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output } })
        send({ type: 'response.create' })
        break
      }
      case 'error': o.onError(ev.error?.message ?? 'Live voice hit an error.'); break
    }
  }
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const answer = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' } })
  if (!answer.ok) { pc.close(); mic.getTracks().forEach((t) => t.stop()); throw new Error(`OpenAI didn’t accept the call (${answer.status}).`) }
  await pc.setRemoteDescription({ type: 'answer', sdp: await answer.text() })
  o.onState('listening')
  return {
    stop: () => { dc.close(); pc.close(); mic.getTracks().forEach((t) => t.stop()); out.srcObject = null },
    mute: (on) => { track.enabled = !on },
  }
}
