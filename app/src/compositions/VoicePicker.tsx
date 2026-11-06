// Choosing how Ream talks (spec: voice): every way it can with what's connected, best first, as cards. The chosen
// one shows its voice (with Try it) and the model that does the thinking. Used in the voice bar (first time, and
// from its chip) and in Settings → Voice. "Build your own" is there for anyone who wants every part chosen.
import { Check, Play, Plus } from '@phosphor-icons/react'
import { useState } from 'react'
import { activeVoiceAgent, bestVoice, describeAgent, OPENAI_VOICES, speaker, tweakVoiceAgent, voiceAgents } from '../data/ai/voice'
import { modelsFor, setAi, useAi, type ModelRef } from '../data/ai/settings'
import { Button } from '../ui/Button'
import s from './VoicePicker.module.css'

const key = (m: ModelRef | null | undefined) => (m ? `${m.provider}:${m.id}` : '')
const parse = (v: string): ModelRef | null => { if (!v) return null; const [provider, ...id] = v.split(':'); return { provider: provider as ModelRef['provider'], id: id.join(':') } }

export function VoicePicker({ onBuild }: { onBuild?: () => void }) {
  const ai = useAi()
  const all = voiceAgents(ai)
  const active = activeVoiceAgent(ai)
  const chat = modelsFor(ai, 'text')
  const [trying, setTrying] = useState(false)
  if (!all.length) return <p className={s.note}>This browser can’t listen. Connect OpenAI (or another provider with speech models) in Settings → AI to talk to Ream.</p>

  const browserTts = active?.kind === 'parts' && active.tts === 'browser'
  const voices = browserTts ? (typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []).filter((v) => v.lang.startsWith((navigator.language || 'en').slice(0, 2))) : []
  const thinker = active?.kind === 'live' ? active.supervisor : active?.kind === 'parts' ? active.llm : null
  const tryIt = async () => {
    if (!active || active.kind !== 'parts') return
    setTrying(true)
    try { await speaker(active).say('Hi, I’m Ream. Tell me what to change in your deck.') } finally { setTrying(false) }
  }

  return (
    <div className={s.picker}>
      <ul className={s.options} role="radiogroup" aria-label="How Ream talks">
        {all.map((a, i) => (
          <li key={a.id}>
            <button type="button" role="radio" aria-checked={active?.id === a.id} className={s.option} onClick={() => setAi({ activeVoice: a.id })}>
              <span className={s.radio} aria-hidden>{active?.id === a.id && <Check size={12} weight="bold" />}</span>
              <span className={s.text}>
                <b>{a.name}{i === 0 && <span className={s.tag}>Recommended</span>}</b>
                <span>{describeAgent(a)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {active && (
        <div className={s.settings}>
          <label className={s.field}><span>Voice</span>
            {active.kind === 'live' || (active.kind === 'parts' && active.tts !== 'browser' && active.tts.provider === 'openai')
              ? <select value={active.voice ?? ''} onChange={(e) => tweakVoiceAgent(active.id, { voice: e.target.value || undefined })}>
                  <option value="">Marin (default)</option>
                  {OPENAI_VOICES.filter((v) => v !== 'marin').map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}
                </select>
              : browserTts
                ? <select value={active.voice ?? ''} onChange={(e) => tweakVoiceAgent(active.id, { voice: e.target.value || undefined })}>
                    <option value="">{bestVoice()?.name ? `${bestVoice()!.name} (best here)` : 'Default'}</option>
                    {voices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                  </select>
                : <input value={active.voice ?? ''} placeholder="The provider’s voice name" onChange={(e) => tweakVoiceAgent(active.id, { voice: e.target.value || undefined })} />}
            {active.kind === 'parts' && <Button variant="ghost" icon={<Play size={13} weight="fill" />} disabled={trying} onClick={() => void tryIt()}>{trying ? 'Speaking…' : 'Try it'}</Button>}
          </label>
          <label className={s.field}><span>Thinks with</span>
            <select value={key(thinker)} onChange={(e) => tweakVoiceAgent(active.id, active.kind === 'live' ? { supervisor: parse(e.target.value) } : { llm: parse(e.target.value) })}>
              <option value="">Ask’s model</option>
              {chat.map((m) => <option key={key(m)} value={key(m)}>{m.id}</option>)}
            </select>
          </label>
        </div>
      )}
      {onBuild && <button type="button" className={s.build} onClick={onBuild}><Plus size={13} /> Build your own (choose every part)</button>}
    </div>
  )
}

