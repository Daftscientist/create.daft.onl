// Voice (spec: live voice). Every kind of voice works the same way, as a conversation that delegates:
// - Live: a speech-to-speech model (OpenAI GPT Live or Realtime over WebRTC, from the browser with the user's key)
//   talks with you and delegates deck work.
// - Built from parts, our own equivalent: speech to text, a quick chat model that holds the conversation and
//   speaks sentence by sentence, and text to speech; it delegates deck work through one tool.
// Delegated work runs hidden (the deck agent, as a sub-agent): the UI shows only its activity and what changed,
// and the voice says the result. Listening is full duplex where the microphone has echo cancellation (you can
// talk over Ream to interrupt), with client-side voice detection that adapts to the room and ends your turn by
// prosody: a falling pitch at a pause ends it quickly, a rising or level one waits for more.
import { experimental_generateSpeech as generateSpeech, experimental_transcribe as transcribe, isStepCount, streamText, tool } from 'ai'
import { z } from 'zod'
import { providerDef, type AiProviderId } from './providers'
import { getAi, modelsFor, setAi, type AiSettings, type ModelRef, type ReasoningLevel } from './settings'
import { recordUsage } from './usage'

export type VoiceAgent =
  | { id: string; name: string; kind: 'live'; model: ModelRef; voice?: string; supervisor: ModelRef | null; reasoning?: ReasoningLevel }
  /** `talker`: the quick model that holds the conversation (default: a fast one you turned on); `llm`: the model that
   *  does delegated deck work (default: Ask's). */
  | { id: string; name: string; kind: 'parts'; stt: ModelRef | 'browser'; talker?: ModelRef | null; llm: ModelRef | null; reasoning?: ReasoningLevel; tts: ModelRef | 'browser'; voice?: string }

type Recognition = { continuous: boolean; interimResults: boolean; lang: string; start: () => void; stop: () => void; abort: () => void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: ((e: { error: string }) => void) | null }
const RecognitionCtor = (): (new () => Recognition) | null => ((window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition) ?? null
export const browserCanListen = () => !!RecognitionCtor()

export const BROWSER_AGENT: VoiceAgent = { id: 'browser', name: 'Browser voice', kind: 'parts', stt: 'browser', llm: null, tts: 'browser' }
/** Every way Ream can talk, best first: the user's own agents, one live agent per live voice model they turned on,
 *  one built from their provider's speech models (when they have speech to text and text to speech), and the
 *  browser's own. Voice and thinking-model tweaks to the ready-made ones are kept per agent. */
/** Speech-to-text models that take a recording (live/realtime transcribers only stream), the reliable ones first. */
export function fileTranscribers(s: AiSettings): ModelRef[] {
  const rank = (id: string) => (/gpt-4o-mini-transcribe/.test(id) ? 0 : /gpt-4o-transcribe/.test(id) ? 1 : /whisper/.test(id) ? 2 : 3)
  return modelsFor(s, 'transcription').filter((m) => !/live|realtime|stream/i.test(m.id)).sort((a, b) => rank(a.id) - rank(b.id))
}
export function voiceAgents(s: AiSettings): VoiceAgent[] {
  const own = s.voiceAgents ?? []
  const live: VoiceAgent[] = modelsFor(s, 'voice').filter((m) => m.provider === 'openai' && !own.some((a) => a.kind === 'live' && a.model.id === m.id))
    .map((m) => ({ id: `live:${m.provider}:${m.id}`, name: m.id.replace(/^gpt-/, 'GPT ').replace(/-/g, ' '), kind: 'live', model: m, supervisor: null }))
  const stt = fileTranscribers(s)[0], tts = modelsFor(s, 'speech')[0]
  const parts: VoiceAgent[] = stt && tts ? [{ id: 'parts:auto', name: `${providerLabel(tts.provider)} voice`, kind: 'parts', stt, llm: null, tts }] : []
  const browser: VoiceAgent[] = browserCanListen() ? [BROWSER_AGENT] : []
  return [...own, ...live, ...parts, ...browser].map((a) => ({ ...a, ...(s.voiceTweaks?.[a.id] ?? {}) }) as VoiceAgent)
}
const providerLabel = (p: string) => ({ openai: 'OpenAI', google: 'Google', xai: 'xAI', mistral: 'Mistral', groq: 'Groq', azure: 'Azure', local: 'Local' } as Record<string, string>)[p] ?? p

/** What each kind of agent is like, in a line, for the chooser. */
export function describeAgent(a: VoiceAgent): string {
  if (a.kind === 'live') return 'Natural back-and-forth, fast replies. Hands deck work to your chat model.'
  if (a.id === 'browser') return 'Your browser’s own voice and listening. Free and private, but sounds robotic.'
  return `Listens with ${a.stt === 'browser' ? 'your browser' : a.stt.id}, speaks with ${a.tts === 'browser' ? 'your browser' : a.tts.id}. Clear voices, a little slower.`
}

/** The chosen agent; without a choice, the first (best). `chosen` is false until the user has picked once. */
export function activeVoiceAgent(s: AiSettings): VoiceAgent | null {
  const all = voiceAgents(s)
  return all.find((a) => a.id === s.activeVoice) ?? all[0] ?? null
}
export const voiceChosen = (s: AiSettings) => !!s.activeVoice && voiceAgents(s).some((a) => a.id === s.activeVoice)

/** Changes the voice or thinking model of any agent (ready-made ones keep the change as a tweak). */
export function tweakVoiceAgent(id: string, change: { voice?: string; llm?: ModelRef | null; supervisor?: ModelRef | null; reasoning?: ReasoningLevel }) {
  const ai = getAi()
  const own = ai.voiceAgents ?? []
  if (own.some((a) => a.id === id)) { setAi({ voiceAgents: own.map((a) => (a.id === id ? { ...a, ...change } as VoiceAgent : a)) }); return }
  setAi({ voiceTweaks: { ...ai.voiceTweaks, [id]: { ...ai.voiceTweaks?.[id], ...change } } })
}
export const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']

export function saveVoiceAgent(a: VoiceAgent) {
  const list = getAi().voiceAgents ?? []
  setAi({ voiceAgents: list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a], activeVoice: a.id })
}
export function deleteVoiceAgent(id: string) {
  const ai = getAi()
  setAi({ voiceAgents: (ai.voiceAgents ?? []).filter((x) => x.id !== id), activeVoice: ai.activeVoice === id ? null : ai.activeVoice })
}

// ---------- the conversation interface ----------

export type VoiceState = 'connecting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'working'
/** What a conversation reports to the UI, and how it delegates. */
export type Talk = {
  /** What the user has said so far in their current turn (`final` when the turn ends). */
  onHeard: (text: string, final: boolean) => void
  /** What Ream is saying: `fresh` starts a new bubble (a real pause, or a new reply). */
  onSaid: (text: string, fresh: boolean) => void
  onState: (s: VoiceState) => void
  onError: (message: string) => void
  /** Hidden deck work: `progress` gets short activity labels; resolves with what was done. */
  delegate: (request: string, progress: (label: string) => void) => Promise<string>
}
export type Conversation = { stop: () => void; mute: (on: boolean) => void; interrupt: () => void }

export async function startConversation(agent: VoiceAgent, talk: Talk): Promise<Conversation> {
  if (agent.kind === 'live') return startLive(agent, talk)
  return startStitched(agent, talk)
}

const TALK_INSTRUCTIONS = 'You are Ream, a friendly presentation assistant, in a spoken conversation about the deck the user has open. Keep replies short and natural to say aloud: no lists, markdown or HTML. You can’t see or change the deck yourself: for anything about it (reading it, changing slides, text, design, notes, comments), delegate to the deck assistant with a complete, specific request. Say a few words while it works if it helps, then tell the user briefly what was done.'

/** The deck work the voice has handed off: what was asked, what it has done so far, so the voice can answer
 *  "how's it going?" truthfully instead of guessing. One task runs at a time; later ones wait their turn. */
const STATUS_Q = /\b(how'?s it (going|coming)|how is it (going|coming)|update me|any update|status|progress|what'?s happening|what are you doing|are you (done|finished)|done yet|finished yet|still (working|there)|how long)\b/i
function workTracker(t: Talk) {
  const queue: { request: string; steps: string[]; started: boolean }[] = []
  const status = () => {
    const cur = queue[0]
    if (!cur) return ''
    const steps = cur.steps.length ? ` So far: ${cur.steps.join('; ')}.` : ' It has only just started.'
    const waiting = queue.length > 1 ? ` Waiting after it: ${queue.slice(1).map((q) => `“${q.request}”`).join(', ')}.` : ''
    return `Deck work in progress, not finished yet: “${cur.request}”.${steps}${waiting}`
  }
  return {
    status,
    busy: () => queue.length > 0,
    isStatusQuestion: (text: string) => STATUS_Q.test(text),
    run: async (request: string, onStep?: (status: string) => void) => {
      const job = { request, steps: [] as string[], started: false }
      queue.push(job)
      try {
        return await t.delegate(request, (label) => {
          job.started = true
          if (job.steps[job.steps.length - 1] !== label) job.steps.push(label)
          if (job.steps.length > 8) job.steps.splice(0, job.steps.length - 8)
          onStep?.(status())
        })
      } catch (e) { return `It failed: ${(e as Error).message}` }
      finally { queue.splice(queue.indexOf(job), 1) }
    },
    clear: () => { queue.length = 0 },
  }
}

// ---------- listening ----------

type Hear = {
  onPartial: (text: string) => void
  onUtterance: (text: string) => void
  /** Speech started (for interrupting Ream). */
  onSpeech?: () => void
  onError: (message: string) => void
}
export type Listener = { stop: () => void; mute: (on: boolean) => void; /** Ream is talking: be harder to trigger (echo). */ talking: (on: boolean) => void }

/** The browser's speech recognition, continuous; each final phrase (after a short pause) is an utterance. It has no
 *  echo cancellation we can control, so it's muted while Ream speaks and restarted after. */
function browserListener(h: Hear): Listener {
  const Ctor = RecognitionCtor()
  if (!Ctor) throw new Error('This browser can’t recognise speech. Choose a voice with a speech-to-text model.')
  const r = new Ctor()
  r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US'
  let muted = false, stopped = false, said = '', timer = 0, deaf = 0
  r.onresult = (e) => {
    if (muted || Date.now() < deaf) return
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      if (res.isFinal) said += `${res[0].transcript} `
      else interim += res[0].transcript
    }
    if (`${said}${interim}`.trim()) h.onSpeech?.()
    h.onPartial(`${said}${interim}`.trim())
    clearTimeout(timer)
    if (said.trim() && !interim) timer = window.setTimeout(() => { const t = said.trim(); said = ''; if (t) h.onUtterance(t) }, 700)
  }
  r.onerror = (e) => { if (e.error !== 'no-speech' && e.error !== 'aborted') h.onError(e.error === 'not-allowed' ? 'Ream needs the microphone. Allow it in the browser’s address bar.' : `Speech recognition stopped (${e.error}).`) }
  r.onend = () => { if (!stopped) try { r.start() } catch { /* already running */ } }
  r.start()
  const mute = (on: boolean) => {
    muted = on; said = ''; clearTimeout(timer); h.onPartial('')
    if (!on) { deaf = Date.now() + 600; try { r.abort() } catch { /* restarts in onend */ } }
  }
  return { stop: () => { stopped = true; clearTimeout(timer); r.abort() }, mute, talking: mute }
}

/** Pitch (Hz) of a frame by autocorrelation, or 0 when it isn't voiced. */
function pitchOf(buf: Float32Array, rate: number): number {
  let rms = 0
  for (const v of buf) rms += v * v
  if (Math.sqrt(rms / buf.length) < 0.01) return 0
  const minLag = Math.floor(rate / 400), maxLag = Math.floor(rate / 70)
  let best = 0, bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0
    for (let i = 0; i + lag < buf.length; i++) c += buf[i] * buf[i + lag]
    if (c > best) { best = c; bestLag = lag }
  }
  return bestLag ? rate / bestLag : 0
}

/** The microphone with the browser's echo cancellation, cut into utterances by client-side voice detection, each
 *  transcribed by the speech-to-text model. Detection tracks the room's noise floor; the end of a turn is judged by
 *  prosody: falling pitch over the last syllables ends it after a short pause, rising or level pitch waits longer. */
async function modelListener(h: Hear, sttIn: ModelRef): Promise<Listener> {
  let stt = sttIn
  const def = providerDef(stt.provider as AiProviderId)
  if (!def.makeTranscription) throw new Error(`${def.name} can’t transcribe from the browser.`)
  let model = await def.makeTranscription(getAi().providers[stt.provider as AiProviderId] ?? {}, stt.id)
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const ctx = new AudioContext()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 2048
  ctx.createMediaStreamSource(stream).connect(analyser)
  const buf = new Float32Array(analyser.fftSize)
  let muted = false, stopped = false, talking = false, rec: MediaRecorder | null = null, chunks: Blob[] = []
  let floor = 0.004, speaking = false, quietSince = 0, loudFor = 0, last = performance.now()
  const pitches: { t: number; hz: number }[] = []
  const startRec = () => { chunks = []; rec = new MediaRecorder(stream); rec.ondataavailable = (e) => chunks.push(e.data); rec.start() }
  const finish = () => {
    const r = rec; rec = null
    if (!r) return
    r.onstop = async () => {
      const blob = new Blob(chunks, { type: r.mimeType })
      if (blob.size < 2500) return
      try {
        h.onPartial('…')
        const audio = new Uint8Array(await blob.arrayBuffer())
        let out
        try { out = await transcribe({ model, audio }) } catch (e) {
          // A model that can't take a recording: use the next one that can, for this and later turns.
          const next = fileTranscribers(getAi()).find((m) => m.id !== stt.id && m.provider === stt.provider)
          if (!next || !/not supported|streaming/i.test((e as Error).message)) throw e
          stt = next; model = await def.makeTranscription!(getAi().providers[stt.provider as AiProviderId] ?? {}, stt.id)
          out = await transcribe({ model, audio })
        }
        recordUsage(stt.provider, stt.id, { requests: 1 })
        h.onPartial('')
        if (out.text.trim()) h.onUtterance(out.text.trim())
      } catch (e) { h.onError((e as Error).message) }
    }
    r.stop()
  }
  /** How long a pause ends the turn, from the pitch of the last 400ms of voice. */
  const endAfter = () => {
    const now = performance.now()
    const recent = pitches.filter((p) => now - p.t < 700 && p.hz > 0)
    if (recent.length < 4) return 800
    const half = Math.floor(recent.length / 2)
    const a = recent.slice(0, half).reduce((x, p) => x + p.hz, 0) / half
    const b = recent.slice(half).reduce((x, p) => x + p.hz, 0) / (recent.length - half)
    const slope = (b - a) / a
    return slope < -0.08 ? 450 : slope > 0.06 ? 1300 : 850
  }
  const loop = () => {
    if (stopped) return
    const now = performance.now(), dt = now - last
    last = now
    analyser.getFloatTimeDomainData(buf)
    let sum = 0
    for (const v of buf) sum += v * v
    const level = Math.sqrt(sum / buf.length)
    // The noise floor follows quiet stretches slowly and never jumps up to speech.
    if (!speaking) floor = level < floor ? floor * 0.9 + level * 0.1 : floor * 0.998 + level * 0.002
    const threshold = Math.max(0.012, floor * (talking ? 6 : 3))
    if (!muted) {
      if (level > threshold) {
        loudFor += dt; quietSince = 0
        if (speaking) pitches.push({ t: now, hz: pitchOf(buf, ctx.sampleRate) })
        // 120ms of voice starts a turn (a click or a cough doesn't).
        if (!speaking && loudFor > 120) { speaking = true; pitches.length = 0; startRec(); h.onSpeech?.(); h.onPartial('Listening…') }
      } else {
        loudFor = 0
        if (speaking) { quietSince ||= now; if (now - quietSince > endAfter()) { speaking = false; finish() } }
      }
    }
    if (pitches.length > 200) pitches.splice(0, 100)
    requestAnimationFrame(loop)
  }
  loop()
  return {
    stop: () => { stopped = true; rec?.stop(); stream.getTracks().forEach((t) => t.stop()); void ctx.close() },
    mute: (on) => { muted = on; if (on && rec) { speaking = false; rec.onstop = null; rec.stop(); rec = null } },
    talking: (on) => { talking = on },
  }
}

export function listen(agent: VoiceAgent & { kind: 'parts' }, h: Hear): Promise<Listener> {
  return agent.stt === 'browser' ? Promise.resolve(browserListener(h)) : modelListener(h, agent.stt)
}

// ---------- speaking ----------

export type Speaker = { say: (text: string) => Promise<void>; stop: () => void; idle: () => Promise<void> }

/** The most natural-sounding browser voice in the user's language (neural and online voices first). */
export function bestVoice(): SpeechSynthesisVoice | undefined {
  const lang = (navigator.language || 'en').slice(0, 2)
  const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith(lang))
  const score = (v: SpeechSynthesisVoice) => (/natural|neural|online/i.test(v.name) ? 4 : 0) + (/google/i.test(v.name) ? 2 : 0) + (v.localService ? 0 : 1) + (v.default ? 0.5 : 0)
  return all.sort((a, b) => score(b) - score(a))[0]
}

/** Speaks sentences in order. A speech model starts making each sentence as soon as it's given, while earlier
 *  ones play, so there's little gap between them. */
export function speaker(agent: VoiceAgent & { kind: 'parts' }): Speaker {
  let audio: HTMLAudioElement | null = null
  let chain: Promise<void> = Promise.resolve()
  let gen = 0
  if (agent.tts === 'browser') {
    return {
      say: (text) => (chain = new Promise<void>((resolve) => {
        const u = new SpeechSynthesisUtterance(text)
        const v = speechSynthesis.getVoices().find((x) => x.name === agent.voice) ?? bestVoice()
        if (v) u.voice = v
        u.rate = 1.03
        u.onend = () => resolve(); u.onerror = () => resolve()
        speechSynthesis.speak(u)
      })),
      stop: () => { speechSynthesis.cancel(); chain = Promise.resolve() },
      idle: async () => { while (speechSynthesis.speaking || speechSynthesis.pending) await new Promise((r) => setTimeout(r, 120)) },
    }
  }
  const tts = agent.tts
  const make = async (text: string) => {
    const def = providerDef(tts.provider as AiProviderId)
    if (!def.makeSpeech) throw new Error(`${def.name} can’t speak from the browser.`)
    const model = await def.makeSpeech(getAi().providers[tts.provider as AiProviderId] ?? {}, tts.id)
    const r = await generateSpeech({ model, text, voice: agent.voice })
    recordUsage(tts.provider, tts.id, { requests: 1 })
    return URL.createObjectURL(new Blob([r.audio.uint8Array.slice()], { type: r.audio.mediaType || 'audio/mpeg' }))
  }
  return {
    say: (text) => {
      const my = gen
      const made = make(text).catch(() => null)
      chain = chain.then(async () => {
        const url = await made
        if (!url || my !== gen) return
        audio = new Audio(url)
        await new Promise<void>((res) => { audio!.onended = () => res(); audio!.onerror = () => res(); void audio!.play().catch(() => res()) })
        URL.revokeObjectURL(url)
      })
      return chain
    },
    stop: () => { gen++; audio?.pause(); audio = null; chain = Promise.resolve() },
    idle: () => chain,
  }
}

/** Did the listener just hear Ream's own words back (speakers into the microphone)? */
export function isEcho(heard: string, said: string): boolean {
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter((w) => w.length > 2)
  const h = words(heard), s = new Set(words(said))
  if (!h.length || !s.size) return false
  return h.filter((w) => s.has(w)).length / h.length > 0.6
}

// ---------- built from parts: a quick talker that delegates ----------

/** The quick model for conversation: the agent's own, else a fast one turned on, else Ask's. */
function talkerFor(agent: VoiceAgent & { kind: 'parts' }): ModelRef | null {
  if (agent.talker) return agent.talker
  const chat = modelsFor(getAi(), 'text')
  return chat.find((m) => /mini|flash|haiku|lite|nano|fast|small|instant/i.test(m.id)) ?? getAi().model ?? chat[0] ?? null
}

async function startStitched(agent: VoiceAgent & { kind: 'parts' }, t: Talk): Promise<Conversation> {
  const ref = talkerFor(agent)
  if (!ref || ref.provider === 'browser') throw new Error('Talking needs a chat model from a provider. Connect one in Settings → AI.')
  const model = await providerDef(ref.provider as AiProviderId).make(getAi().providers[ref.provider as AiProviderId] ?? {}, ref.id)
  const voice = speaker(agent)
  const history: { role: 'user' | 'assistant'; content: string }[] = []
  let replying: AbortController | null = null
  let lastSaid = '', listener: Listener | null = null, gone = false
  const work = workTracker(t)

  const reply = async (heard: string) => {
    replying?.abort()
    const ac = new AbortController(); replying = ac
    history.push({ role: 'user', content: heard })
    t.onState('thinking')
    let bubble = '', pending = '', fresh = true, all = ''
    const flushSentence = (force = false) => {
      // Speak whole sentences as they arrive (a comma-long fragment waits for more).
      const m = force ? pending : /^[\s\S]*?[.!?…](\s|$)/.exec(pending)?.[0]
      if (!m || !m.trim()) return
      pending = pending.slice(m.length)
      t.onState('speaking'); listener?.talking(true)
      void voice.say(m.trim())
    }
    try {
      const result = streamText({
        model, system: TALK_INSTRUCTIONS + (work.busy() ? `\n\n${work.status()} Answer questions about it from this; don't hand it off again unless the user asks for something new.` : ''), messages: history, abortSignal: ac.signal, stopWhen: isStepCount(4),
        tools: {
          ask_deck_assistant: tool({
            description: 'Hand a request to the deck assistant, which can read and change anything in the open deck. Returns what it found or did.',
            inputSchema: z.object({ request: z.string().describe('What to find out or change, in full') }),
            execute: async ({ request }) => {
              flushSentence(true)
              t.onState('working')
              const out = await work.run(request)
              if (!gone) t.onState('thinking')
              return out || 'Done.'
            },
          }),
        },
      })
      for await (const part of result.fullStream as AsyncIterable<{ type: string; text?: string }>) {
        if (part.type === 'text-delta' && part.text) {
          bubble += part.text; pending += part.text; all += part.text
          t.onSaid(bubble.trim(), fresh); fresh = false
          // A paragraph break is a pause: the next words start a new bubble.
          if (/\n\s*\n/.test(bubble)) { bubble = ''; fresh = true }
          flushSentence()
        } else if (part.type === 'tool-call') { bubble = ''; fresh = true }
      }
      flushSentence(true)
      if (all.trim()) history.push({ role: 'assistant', content: all.trim() })
      lastSaid = all
      await voice.idle()
    } catch (e) {
      if (!ac.signal.aborted) t.onError((e as Error).message)
    } finally {
      if (replying === ac) replying = null
      listener?.talking(false)
      if (!gone) t.onState('listening')
    }
  }

  listener = await listen(agent, {
    onPartial: (text) => { if (text && text !== 'Listening…' && text !== '…') t.onHeard(text, false) },
    onSpeech: () => {
      // Talking over Ream interrupts it (the microphone has echo cancellation; the browser's recognition is muted).
      if (agent.stt !== 'browser' && (replying || lastSaid)) { voice.stop(); replying?.abort(); replying = null; listener?.talking(false) }
      t.onState('hearing')
    },
    onUtterance: (text) => {
      if (isEcho(text, lastSaid)) return
      t.onHeard(text, true)
      if (agent.stt === 'browser') listener?.mute(true)
      void reply(text).finally(() => { if (agent.stt === 'browser') listener?.mute(false) })
    },
    onError: t.onError,
  })
  t.onState('listening')
  return {
    stop: () => { gone = true; work.clear(); replying?.abort(); voice.stop(); listener?.stop() },
    mute: (on) => listener?.mute(on),
    interrupt: () => { voice.stop(); replying?.abort(); replying = null; listener?.talking(false); t.onState('listening') },
  }
}

// ---------- live ----------

/** A live voice model over WebRTC. GPT Live: one /live/sessions request, continuous speech both ways, and client
 *  delegation. GPT Realtime: a short-lived key, then the call, with one delegating tool. */
async function startLive(agent: VoiceAgent & { kind: 'live' }, t: Talk): Promise<Conversation> {
  if (agent.model.provider !== 'openai') throw new Error('Live voice works with OpenAI live models for now. Other providers work as a voice built from parts.')
  const key = getAi().providers.openai?.apiKey
  if (!key) throw new Error('Add your OpenAI key in Settings → AI.')
  t.onState('connecting')
  const isLive = /live/i.test(agent.model.id) && !/realtime/i.test(agent.model.id)
  const pc = new RTCPeerConnection()
  const out = new Audio(); out.autoplay = true
  pc.ontrack = (e) => { out.srcObject = e.streams[0] }
  const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  const track = mic.getTracks()[0]
  pc.addTrack(track, mic)
  const dc = pc.createDataChannel('oai-events')
  let n = 0
  const send = (ev: Record<string, unknown>) => { if (dc.readyState === 'open') dc.send(JSON.stringify({ event_id: `ream-${Date.now().toString(36)}-${n++}`, ...ev })) }
  const offer = await pc.createOffer()
  await pc.setLocalDescription(offer)
  const close = () => { pc.close(); mic.getTracks().forEach((x) => x.stop()) }
  const fail = async (res: Response) => { close(); const d = await res.text().catch(() => ''); return new Error(`OpenAI didn’t start live voice (${res.status}). ${/"message":\s*"([^"]+)/.exec(d)?.[1] ?? ''}`.trim()) }

  if (isLive) {
    const res = await fetch('https://api.openai.com/v1/live/sessions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: {
          model: agent.model.id, instructions: TALK_INSTRUCTIONS,
          audio: { output: { voice: agent.voice || 'marin' } },
          delegation: { type: 'client', acknowledgement_delay_ms: 800 },
          client: { data_channel: { allowed_client_events: 'all', allowed_server_events: 'all' } },
        },
        transport: { type: 'webrtc', sdp: offer.sdp },
      }),
    }).catch(() => { close(); throw new Error('Couldn’t reach OpenAI from this browser to start live voice.') })
    if (!res.ok) throw await fail(res)
    const body = (await res.json()) as { transport?: { sdp?: string } }
    if (!body.transport?.sdp) { close(); throw new Error('OpenAI didn’t answer the call.') }
    await pc.setRemoteDescription({ type: 'answer', sdp: body.transport.sdp })
  } else {
    const session = {
      type: 'realtime', model: agent.model.id, instructions: TALK_INSTRUCTIONS,
      audio: { input: { transcription: { model: 'gpt-4o-mini-transcribe' }, turn_detection: { type: 'server_vad' } }, output: { voice: agent.voice || 'marin' } },
      tools: [{ type: 'function', name: 'ask_deck_assistant', description: 'Hand a request to the deck assistant, which can read and change anything in the open deck. Returns what it found or did.', parameters: { type: 'object', properties: { request: { type: 'string' } }, required: ['request'] } }],
    }
    const minted = await fetch('https://api.openai.com/v1/realtime/client_secrets', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ session }) })
      .catch(() => { close(); throw new Error('Couldn’t reach OpenAI from this browser to start live voice.') })
    if (!minted.ok) throw await fail(minted)
    const sec = (await minted.json()) as { value?: string; client_secret?: { value: string } }
    const ephemeral = sec.value ?? sec.client_secret?.value
    if (!ephemeral) { close(); throw new Error('OpenAI didn’t return a session key.') }
    const ans = await fetch('https://api.openai.com/v1/realtime/calls', { method: 'POST', body: offer.sdp, headers: { Authorization: `Bearer ${ephemeral}`, 'Content-Type': 'application/sdp' } })
    if (!ans.ok) throw await fail(ans)
    await pc.setRemoteDescription({ type: 'answer', sdp: await ans.text() })
  }

  // Transcripts both ways, as bubbles. A gap of more than 450ms between pieces of Ream's speech (GPT Live's timings,
  // or arrival time for Realtime) starts a new bubble. GPT Live listens while it speaks, so the state goes back to
  // listening as soon as its speech stops.
  const tasks = workTracker(t)
  let closed = false
  let heard = '', said = '', lastAsk = '', lastEnd = -1, lastAt = 0, quiet = 0
  const used = { input: 0, output: 0 }
  const endHeard = () => { if (heard.trim()) { lastAsk = heard.trim(); t.onHeard(lastAsk, true) } heard = '' }
  const speech = (delta: string, start?: number, end?: number) => {
    endHeard()
    const gap = start !== undefined && lastEnd >= 0 ? start - lastEnd : Date.now() - lastAt
    // A pause after a finished sentence starts a new bubble; a pause mid-sentence (or before stray punctuation) doesn't.
    const fresh = !said || (/[\p{L}\p{N}]/u.test(delta) && ((gap > 450 && /[.!?…]["”’)]?\s*$/.test(said)) || gap > 1500))
    if (fresh) said = ''
    said += delta
    t.onSaid(said.trim(), fresh)
    lastEnd = end ?? lastEnd; lastAt = Date.now()
    t.onState('speaking')
    clearTimeout(quiet)
    quiet = window.setTimeout(() => t.onState(tasks.busy() ? 'working' : 'listening'), 700)
  }
  const work = async (request: string, report: (status: string) => void) => {
    t.onState('working')
    const out = await tasks.run(request || 'Help with the deck', report)
    if (!closed && !tasks.busy()) t.onState('listening')
    return out
  }
  dc.onmessage = async (m) => {
    const ev = JSON.parse(m.data as string) as Record<string, any>
    switch (ev.type) {
      // GPT Live
      case 'session.input_transcript.delta': heard += ev.delta ?? ''; t.onHeard(heard.trim(), false); t.onState('hearing'); break
      case 'session.output_transcript.delta': speech(ev.delta ?? '', ev.start_ms, ev.end_ms); break
      case 'session.delegation.created': {
        endHeard()
        const id = ev.delegation?.id ?? null
        // "How's it going?" while work runs: answer from what it has actually done, don't start the work again.
        if (tasks.busy() && tasks.isStatusQuestion(lastAsk)) {
          send({ type: 'session.commentary.append', delegation_id: id, content: tasks.status() })
          break
        }
        if (tasks.busy()) send({ type: 'session.thinking.append', delegation_id: id, content: `Queued: this starts once the current deck work finishes. ${tasks.status()}` })
        // Every step goes to the model quietly (thinking), so it always knows where the work is.
        const result = await work(lastAsk, (status) => send({ type: 'session.thinking.append', delegation_id: id, content: status }))
        if (closed) break
        // Between tasks, it should know nothing is running (general context, not tied to a task).
        if (!tasks.busy()) send({ type: 'session.thinking.append', delegation_id: null, content: 'No deck work is running now.' })
        // The result, for it to say (appends are capped near 500 tokens).
        send({ type: 'session.commentary.append', delegation_id: id, content: result.slice(0, 1800) || 'Done.' })
        break
      }
      case 'session.usage.updated': {
        const i = ev.usage?.input_tokens ?? used.input, o = ev.usage?.output_tokens ?? used.output
        recordUsage('openai', agent.model.id, { input: i - used.input, output: o - used.output })
        used.input = i; used.output = o
        break
      }
      // GPT Realtime
      case 'input_audio_buffer.speech_started': t.onState('hearing'); break
      case 'conversation.item.input_audio_transcription.delta': heard += ev.delta ?? ''; t.onHeard(heard.trim(), false); break
      case 'conversation.item.input_audio_transcription.completed': heard = ev.transcript ?? heard; endHeard(); break
      case 'response.output_audio_transcript.delta': case 'response.audio_transcript.delta': speech(ev.delta ?? ''); break
      case 'response.done': recordUsage('openai', agent.model.id, { requests: 1, input: ev.response?.usage?.input_tokens, output: ev.response?.usage?.output_tokens }); break
      case 'response.function_call_arguments.done': {
        let args: { request?: string } = {}
        try { args = JSON.parse(ev.arguments || '{}') } catch { /* empty */ }
        const result = tasks.busy() && tasks.isStatusQuestion(args.request ?? lastAsk) ? tasks.status() : await work(args.request ?? lastAsk, () => {})
        if (closed) break
        send({ type: 'conversation.item.create', item: { type: 'function_call_output', call_id: ev.call_id, output: result } })
        send({ type: 'response.create' })
        break
      }
      case 'error': t.onError(ev.error?.message ?? 'Live voice hit an error.'); break
    }
  }
  t.onState('listening')
  return {
    stop: () => { closed = true; tasks.clear(); if (isLive) send({ type: 'session.close' }); clearTimeout(quiet); dc.close(); close(); out.srcObject = null },
    mute: (on) => { track.enabled = !on; if (isLive) send({ type: on ? 'session.input_audio.mute' : 'session.input_audio.unmute' }) },
    interrupt: () => { if (!isLive) send({ type: 'response.cancel' }); out.muted = true; setTimeout(() => { out.muted = false }, 400) },
  }
}
