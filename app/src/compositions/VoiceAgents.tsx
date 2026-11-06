// Settings → AI → Voice: the voice agents (spec: live voice). The built-in Browser voice, then the user's own:
// live (a realtime voice model, with a chat model doing the deck work) or built from parts (speech to text, a
// chat model with its reasoning level, text to speech and a voice). One is active; Ask's voice mode uses it.
import { PencilSimple, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import { browserCanListen, fileTranscribers, deleteVoiceAgent, saveVoiceAgent, speaker, type VoiceAgent } from '../data/ai/voice'
import { VoicePicker } from './VoicePicker'
import { modelsFor, REASONING_LEVELS, useAi, type ModelRef, type ReasoningLevel } from '../data/ai/settings'
import { Button, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { SettingGroup, SettingRow } from '../ui/Field'
import s from './VoiceAgents.module.css'

import { OPENAI_VOICES } from '../data/ai/voice'
const key = (m: ModelRef | 'browser' | null | undefined) => (m === 'browser' ? 'browser' : m ? `${m.provider}:${m.id}` : '')
const parse = (v: string): ModelRef | null => { if (!v) return null; const [provider, ...id] = v.split(':'); return { provider: provider as ModelRef['provider'], id: id.join(':') } }

export function VoiceAgentsSettings() {
  const ai = useAi()
  const own = ai.voiceAgents ?? []
  const [editing, setEditing] = useState<VoiceAgent | 'new' | null>(null)
  return (
    <>
      <p className={s.lede}>How Ream talks when you press Talk in Ask. These come from what you’ve connected; the first is usually best.</p>
      <SettingGroup title="How Ream talks">
        <div className={s.pickerWrap}><VoicePicker onBuild={() => setEditing('new')} /></div>
      </SettingGroup>
      {own.length > 0 && (
        <SettingGroup title="Built by you">
          {own.map((a) => (
            <SettingRow key={a.id} label={a.name} description={a.kind === 'live' ? `Live · ${a.model.id}` : `${a.stt === 'browser' ? 'Browser' : a.stt.id} → ${a.llm?.id ?? 'Ask’s model'} → ${a.tts === 'browser' ? 'browser voice' : a.tts.id}`}>
              <IconButton label={`Edit ${a.name}`} size="sm" tone="plain" onClick={() => setEditing(a)}><PencilSimple size={15} /></IconButton>
              <IconButton label={`Delete ${a.name}`} size="sm" tone="plain" onClick={() => deleteVoiceAgent(a.id)}><Trash size={15} /></IconButton>
            </SettingRow>
          ))}
        </SettingGroup>
      )}
      {editing && <AgentDialog agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  )
}

type Step = 'kind' | 'model' | 'listen' | 'think' | 'speak' | 'name'
const LIVE_STEPS: Step[] = ['kind', 'model', 'think', 'name'], PARTS_STEPS: Step[] = ['kind', 'listen', 'think', 'speak', 'name']
const TITLES: Record<Step, string> = { kind: 'What kind of voice?', model: 'Which live model?', listen: 'How should it listen?', think: 'What should do the thinking?', speak: 'How should it sound?', name: 'Name it' }

/** Building a voice, one question at a time (spec: voice). Each answer is a card; the last step names it and shows
 *  what was chosen. Editing an existing one opens at its kind with every answer filled in. */
function AgentDialog({ agent, onClose }: { agent: VoiceAgent | null; onClose: () => void }) {
  const ai = useAi()
  const voiceModels = modelsFor(ai, 'voice'), chat = modelsFor(ai, 'text'), stt = fileTranscribers(ai), tts = modelsFor(ai, 'speech')
  const [kind, setKind] = useState<VoiceAgent['kind']>(agent?.kind ?? (voiceModels.length ? 'live' : 'parts'))
  const [step, setStep] = useState<Step>('kind')
  const [name, setName] = useState(agent?.name ?? '')
  const [model, setModel] = useState(key(agent?.kind === 'live' ? agent.model : voiceModels[0]))
  const [thinker, setThinker] = useState(key(agent?.kind === 'live' ? agent.supervisor : agent?.kind === 'parts' ? agent.llm : null))
  const [reasoning, setReasoning] = useState<ReasoningLevel>(agent?.reasoning ?? 'provider-default')
  const [sttV, setStt] = useState(key(agent?.kind === 'parts' ? agent.stt : browserCanListen() ? 'browser' : stt[0]))
  const [ttsV, setTts] = useState(key(agent?.kind === 'parts' ? agent.tts : tts[0] ?? 'browser'))
  const [voice, setVoice] = useState(agent?.voice ?? '')
  const [trying, setTrying] = useState(false)
  const steps = kind === 'live' ? LIVE_STEPS : PARTS_STEPS
  const at = steps.indexOf(step)
  const label = (v: string, browser: string) => (v === 'browser' ? browser : parse(v)?.id ?? '')
  const autoName = kind === 'live' ? `${label(model, '')} voice` : `${label(ttsV, 'Browser')} voice`
  const draft = (): VoiceAgent => {
    const base = { id: agent?.id ?? `va-${Date.now().toString(36)}`, name: name.trim() || autoName, reasoning: reasoning === 'provider-default' ? undefined : reasoning, voice: voice || undefined }
    return kind === 'live'
      ? { ...base, kind: 'live', model: parse(model)!, supervisor: parse(thinker) }
      : { ...base, kind: 'parts', stt: sttV === 'browser' ? 'browser' : parse(sttV)!, llm: parse(thinker), tts: ttsV === 'browser' ? 'browser' : parse(ttsV)! }
  }
  const canNext = step === 'model' ? !!model : step === 'listen' ? !!sttV : step === 'speak' ? !!ttsV : true
  const next = () => { if (at < steps.length - 1) setStep(steps[at + 1]); else { saveVoiceAgent(draft()); onClose() } }
  const card = (value: string, current: string, set: (v: string) => void, title: string, body: string) => (
    <button key={value || 'none'} type="button" role="radio" aria-checked={current === value} className={s.card} onClick={() => set(value)}>
      <span className={s.dot} aria-hidden />
      <span><b>{title}</b><span>{body}</span></span>
    </button>
  )
  const browserVoices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices().filter((v) => v.lang.startsWith((navigator.language || 'en').slice(0, 2))) : []

  return (
    <Dialog title={TITLES[step]} width={500} onClose={onClose} actions={<>
      {at > 0 ? <Button variant="ghost" onClick={() => setStep(steps[at - 1])}>Back</Button> : <Button variant="ghost" onClick={onClose}>Cancel</Button>}
      <Button variant="primary" disabled={!canNext} onClick={next}>{at === steps.length - 1 ? 'Save and use' : 'Next'}</Button>
    </>}>
      <div className={s.progress} aria-label={`Step ${at + 1} of ${steps.length}`}>{steps.map((x, i) => <i key={x} data-on={i <= at || undefined} />)}</div>
      <div className={s.cards} role="radiogroup" aria-label={TITLES[step]}>
        {step === 'kind' && <>
          {card('live', kind, (v) => setKind(v as VoiceAgent['kind']), 'A live conversation', voiceModels.length ? 'One speech-to-speech model listens and answers in real time, and hands deck work to a chat model. The most natural.' : 'Needs a live voice model: turn one on in Settings → Models (OpenAI’s GPT Live, for example).')}
          {card('parts', kind, (v) => setKind(v as VoiceAgent['kind']), 'Listen, think, speak', 'Three parts you choose: something that listens, a chat model that thinks and edits, and a voice. Works with any provider, or just your browser.')}
        </>}
        {step === 'model' && (voiceModels.length ? voiceModels.map((m) => card(key(m), model, setModel, m.id, m.provider === 'openai' ? 'OpenAI live voice' : 'Live voice')) : <p className={s.note}>Turn on a live voice model in Settings → Models first.</p>)}
        {step === 'listen' && <>
          {browserCanListen() && card('browser', sttV, setStt, 'Your browser', 'Free and private. Fine in a quiet room.')}
          {stt.map((m) => card(key(m), sttV, setStt, m.id, 'More accurate, especially with accents and noise.'))}
        </>}
        {step === 'think' && <>
          {card('', thinker, setThinker, 'Ask’s model', 'Whatever you’ve picked in Ask’s model picker.')}
          {chat.map((m) => card(key(m), thinker, setThinker, m.id, 'Always use this one when talking.'))}
          <label className={s.field}><span>Reasoning</span>
            <select value={reasoning} onChange={(e) => setReasoning(e.target.value as ReasoningLevel)}>{REASONING_LEVELS.map((r) => <option key={r.level} value={r.level}>{r.label}</option>)}</select>
          </label>
        </>}
        {step === 'speak' && <>
          {tts.map((m) => card(key(m), ttsV, setTts, m.id, 'A natural voice.'))}
          {card('browser', ttsV, setTts, 'Your browser’s voice', 'Free, but sounds robotic.')}
          <label className={s.field}><span>Voice</span>
            {ttsV === 'browser'
              ? <select value={voice} onChange={(e) => setVoice(e.target.value)}><option value="">Best available</option>{browserVoices.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}</select>
              : parse(ttsV)?.provider === 'openai'
                ? <select value={voice} onChange={(e) => setVoice(e.target.value)}><option value="">Marin</option>{OPENAI_VOICES.filter((v) => v !== 'marin').map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select>
                : <input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="The provider’s voice name" />}
            <Button variant="ghost" disabled={trying} onClick={async () => { const a = draft(); if (a.kind !== 'parts') return; setTrying(true); try { await speaker(a).say('Hi, I’m Ream. Tell me what to change.') } finally { setTrying(false) } }}>{trying ? 'Speaking…' : 'Try it'}</Button>
          </label>
        </>}
        {step === 'name' && <>
          <label className={s.field}><span>Name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={autoName} /></label>
          <ul className={s.recap}>
            {kind === 'live' ? <li>Talks with <b>{label(model, '')}</b>{voice ? `, voice ${voice}` : ''}</li> : <>
              <li>Listens with <b>{label(sttV, 'your browser')}</b></li>
              <li>Speaks with <b>{label(ttsV, 'your browser')}</b>{voice ? `, voice ${voice}` : ''}</li>
            </>}
            <li>Thinks with <b>{label(thinker, '') || 'Ask’s model'}</b>{reasoning !== 'provider-default' ? `, reasoning ${reasoning}` : ''}</li>
          </ul>
        </>}
      </div>
    </Dialog>
  )
}
