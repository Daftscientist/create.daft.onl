// Ask, by voice (spec: live voice). Replaces the message box while on. The conversation shows in the thread as
// bubbles (yours as you speak, Ream's split at its pauses) with its deck work as quiet rows; this bar shows the
// state, the voice in use, mute, stop and back to typing.
import { Microphone, MicrophoneSlash, Waveform, Keyboard, CaretDown } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { activeVoiceAgent, startConversation, voiceChosen, type Conversation, type VoiceState } from '../data/ai/voice'
import { Popover } from '../ui/Popover'
import { VoicePicker } from './VoicePicker'
import { setAi, useAi, type ModelRef, type ReasoningLevel } from '../data/ai/settings'
import { navigate } from '../lib/router'
import { Button, IconButton } from '../ui/Button'
import s from './VoiceMode.module.css'

type State = VoiceState | 'error'
const LABEL: Record<State, string> = { connecting: 'Starting…', listening: 'Listening', hearing: 'Hearing you', thinking: 'Thinking', speaking: 'Speaking', working: 'Working on the deck', error: 'Voice stopped' }

export function VoiceMode({ onStart, onHeard, onSaid, delegate, onStop, onExit }: {
  /** A voice is starting (or switched): which model does its deck work. */
  onStart: (thinker: { model?: ModelRef | null; reasoning?: ReasoningLevel }) => void
  onHeard: (text: string, final: boolean) => void
  onSaid: (text: string, fresh: boolean) => void
  delegate: (request: string, progress: (label: string) => void) => Promise<string>
  /** Stop: cancel the deck work as well as the speech. */
  onStop: () => void
  onExit: () => void
}) {
  const ai = useAi()
  // The first time, choose how Ream talks before anything starts listening.
  const [ready, setReady] = useState(() => voiceChosen(ai))
  const agent = ready ? activeVoiceAgent(ai) : null
  const [chooser, setChooser] = useState<HTMLElement | null>(null)
  const [state, setState] = useState<State>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const convo = useRef<Conversation | null>(null)
  const cb = useRef({ onStart, onHeard, onSaid, delegate, onStop })
  cb.current = { onStart, onHeard, onSaid, delegate, onStop }

  useEffect(() => {
    if (!agent) return
    let gone = false
    setState('connecting'); setError(null)
    cb.current.onStart(agent.kind === 'live' ? { model: agent.supervisor, reasoning: agent.reasoning } : { model: agent.llm, reasoning: agent.reasoning })
    void startConversation(agent, {
      // A session that outlived its effect (StrictMode's double run, or a switch while connecting) must never
      // reach the thread: that was every exchange showing twice.
      onHeard: (t, f) => { if (!gone) cb.current.onHeard(t, f) },
      onSaid: (t, f) => { if (!gone) cb.current.onSaid(t, f) },
      onState: (x) => { if (!gone) { setState(x); if (x === 'listening') setError(null) } },
      onError: (m) => { if (!gone) { setError(m); setState('error') } },
      delegate: (r, p) => (gone ? Promise.resolve('That voice session ended.') : cb.current.delegate(r, p)),
    }).then((c) => { if (gone) c.stop(); else convo.current = c }).catch((e) => { if (!gone) { setError((e as Error).message); setState('error') } })
    return () => { gone = true; convo.current?.stop(); convo.current = null; cb.current.onStop() }
  }, [agent?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => { const m = !muted; setMuted(m); convo.current?.mute(m) }
  const interrupt = () => { convo.current?.interrupt(); onStop() }

  if (!ready) {
    return (
      <div className={s.bar} role="group" aria-label="Voice">
        <b className={s.title}>How should Ream talk?</b>
        <VoicePicker />
        <div className={s.row}>
          <Button variant="ghost" icon={<Keyboard size={15} />} onClick={onExit}>Type instead</Button>
          <span className={s.spacer} />
          <Button variant="primary" icon={<Microphone size={15} />} disabled={!activeVoiceAgent(ai)} onClick={() => { const a = activeVoiceAgent(ai); if (a) { setAi({ activeVoice: a.id }); setReady(true) } }}>Start talking</Button>
        </div>
      </div>
    )
  }
  if (!agent) {
    return (
      <div className={s.bar}>
        <p className={s.note}>This browser can’t recognise speech. Build a voice agent in Settings → AI → Voice (a speech-to-text model, a chat model and a voice).</p>
        <div className={s.row}><Button variant="secondary" onClick={() => navigate({ name: 'settings', section: 'ai' })}>Connect a provider</Button><span className={s.spacer} /><Button variant="ghost" icon={<Keyboard size={15} />} onClick={onExit}>Type instead</Button></div>
      </div>
    )
  }
  return (
    <div className={s.bar} role="group" aria-label="Voice">
      <div className={s.status}>
        <span className={s.orb} data-state={state} aria-hidden><Waveform size={18} weight="bold" /></span>
        <span className={s.what}>
          <b role="status" aria-live="polite">{muted ? 'Muted' : error && state !== 'listening' ? 'Something went wrong' : LABEL[state]}</b>
          <span className={s.heard}>{error ?? (state === 'listening' ? 'Talk any time; you can interrupt Ream' : state === 'working' ? 'Doing it now; Ream will tell you' : '')}</span>
        </span>
      </div>
      <div className={s.row}>
        <button type="button" className={s.agent} aria-haspopup="dialog" aria-expanded={!!chooser} onClick={(e) => setChooser(chooser ? null : e.currentTarget)}>
          {agent.name}<CaretDown size={10} weight="bold" />
        </button>
        <span className={s.spacer} />
        {(state === 'speaking' || state === 'thinking' || state === 'working') && <Button variant="ghost" onClick={interrupt}>Stop</Button>}
        <IconButton label={muted ? 'Unmute' : 'Mute'} size="sm" tone="fill" aria-pressed={muted} onClick={toggleMute}>{muted ? <MicrophoneSlash size={15} /> : <Microphone size={15} />}</IconButton>
        <IconButton label="Type instead" size="sm" tone="fill" onClick={onExit}><Keyboard size={15} /></IconButton>
      </div>
      {chooser && <Popover anchor={chooser} label="How Ream talks" width={340} onClose={() => setChooser(null)}><VoicePicker onBuild={() => navigate({ name: 'settings', section: 'voice' })} /></Popover>}
    </div>
  )
}
