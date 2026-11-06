// Ask, by voice (spec: live voice). Replaces the message box while on: the thread above stays the same (what you
// said, what Ream did and said, its tools and edits), and this bar shows who's talking, what it heard so far, the
// voice agent in use, mute and back to typing.
import { Microphone, MicrophoneSlash, Waveform, Keyboard, CaretDown } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { activeVoiceAgent, listen, speaker, startLive, voiceAgents, type Listener, type Live, type Speaker, type VoiceAgent } from '../data/ai/voice'
import { setAi, useAi, type ModelRef, type ReasoningLevel } from '../data/ai/settings'
import { navigate } from '../lib/router'
import { Button, IconButton } from '../ui/Button'
import { Menu, type MenuAnchor } from '../ui/Menu'
import s from './VoiceMode.module.css'

type State = 'starting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'working' | 'error'
const LABEL: Record<State, string> = { starting: 'Starting…', listening: 'Listening', hearing: 'Hearing you', thinking: 'Thinking', speaking: 'Speaking', working: 'Working on the deck', error: 'Voice stopped' }

export function VoiceMode({ onSend, onUser, onAssistant, onExit, onStop }: {
  /** One turn of deck work; resolves with the reply to say. */
  onSend: (text: string, o: { model?: ModelRef | null; reasoning?: ReasoningLevel; voice: true }) => Promise<string>
  /** Live voice: what was said each way, shown in the thread. */
  onUser: (text: string) => void
  onAssistant: (text: string, done: boolean) => void
  onExit: () => void
  onStop: () => void
}) {
  const ai = useAi()
  const agent = activeVoiceAgent(ai)
  const [state, setState] = useState<State>('starting')
  const [heard, setHeard] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [muted, setMuted] = useState(false)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const live = useRef<{ listener?: Listener; speaker?: Speaker; live?: Live } | null>(null)
  const send = useRef(onSend); send.current = onSend
  const user = useRef(onUser); user.current = onUser
  const assistant = useRef(onAssistant); assistant.current = onAssistant

  useEffect(() => {
    if (!agent) return
    let gone = false
    const cur: { listener?: Listener; speaker?: Speaker; live?: Live } = {}
    live.current = cur
    setState('starting'); setError(null)
    const fail = (m: string) => { if (!gone) { setError(m); setState('error') } }
    ;(async () => {
      try {
        if (agent.kind === 'parts') {
          cur.speaker = speaker(agent)
          cur.listener = await listen(agent, {
            onPartial: (t) => { if (!gone) { setHeard(t); if (t) setState('hearing') } },
            onError: fail,
            onUtterance: async (t) => {
              cur.listener?.mute(true); setHeard(''); setState('thinking')
              try {
                const reply = await send.current(t, { model: agent.llm, reasoning: agent.reasoning, voice: true })
                if (gone) return
                if (reply.trim()) { setState('speaking'); await cur.speaker?.say(reply) }
              } finally { if (!gone) { cur.listener?.mute(false); setState('listening') } }
            },
          })
          if (gone) cur.listener.stop(); else setState('listening')
        } else {
          cur.live = await startLive(agent, {
            instructions: 'You are Ream, a friendly presentation assistant, talking with the user about the deck they have open. Keep spoken replies short. For anything that reads or changes the deck (slides, text, design, notes, comments), call work_on_deck with a clear, complete request, then tell the user briefly what was done.',
            tools: [{
              name: 'work_on_deck',
              description: 'Hand a request to Ream’s deck assistant, which can read and change anything in the open deck. Returns what it did.',
              parameters: { type: 'object', properties: { request: { type: 'string', description: 'What to do, in full' } }, required: ['request'] },
              run: async (args) => send.current(String(args.request ?? ''), { model: agent.supervisor, reasoning: agent.reasoning, voice: true }),
            }],
            onUser: (t) => user.current(t),
            onAssistant: (t, done) => assistant.current(t, done),
            onState: (x) => { if (!gone) setState(x === 'connecting' ? 'starting' : x) },
            onError: fail,
          })
          if (gone) cur.live.stop()
        }
      } catch (e) { fail((e as Error).message) }
    })()
    return () => { gone = true; cur.listener?.stop(); cur.speaker?.stop(); cur.live?.stop() }
  }, [agent?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMute = () => { const m = !muted; setMuted(m); live.current?.listener?.mute(m); live.current?.live?.mute(m) }
  const interrupt = () => { live.current?.speaker?.stop(); onStop() }

  if (!agent) {
    return (
      <div className={s.bar}>
        <p className={s.note}>This browser can’t recognise speech. Build a voice agent in Settings → AI → Voice (a speech-to-text model, a chat model and a voice).</p>
        <div className={s.row}><Button variant="secondary" onClick={() => navigate({ name: 'settings', section: 'ai' })}>Open Settings</Button><span className={s.spacer} /><Button variant="ghost" icon={<Keyboard size={15} />} onClick={onExit}>Type instead</Button></div>
      </div>
    )
  }
  return (
    <div className={s.bar} role="group" aria-label="Voice">
      <div className={s.status}>
        <span className={s.orb} data-state={state} aria-hidden><Waveform size={18} weight="bold" /></span>
        <span className={s.what}>
          <b role="status" aria-live="polite">{muted ? 'Muted' : LABEL[state]}</b>
          <span className={s.heard}>{error ?? (heard || (state === 'listening' ? 'Say what you’d like to change' : ''))}</span>
        </span>
      </div>
      <div className={s.row}>
        <button type="button" className={s.agent} aria-haspopup="menu" aria-expanded={!!menu} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.top - 6 }) }}>
          {agent.name}<CaretDown size={10} weight="bold" />
        </button>
        <span className={s.spacer} />
        {(state === 'speaking' || state === 'thinking' || state === 'working') && <Button variant="ghost" onClick={interrupt}>Stop</Button>}
        <IconButton label={muted ? 'Unmute' : 'Mute'} size="sm" tone="fill" aria-pressed={muted} onClick={toggleMute}>{muted ? <MicrophoneSlash size={15} /> : <Microphone size={15} />}</IconButton>
        <IconButton label="Type instead" size="sm" tone="fill" onClick={onExit}><Keyboard size={15} /></IconButton>
      </div>
      <Menu open={!!menu} anchor={menu} label="Voice agent" onClose={() => setMenu(null)} items={[
        ...voiceAgents(ai).map((a: VoiceAgent) => ({ label: a.name, hint: a.kind === 'live' ? 'Live' : 'From parts', selected: a.id === agent.id, run: () => setAi({ activeVoice: a.id }) })),
        { kind: 'sep' as const },
        { label: 'Manage voice agents…', run: () => navigate({ name: 'settings', section: 'ai' }) },
      ]} />
    </div>
  )
}
