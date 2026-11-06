// Settings → AI → Voice: the voice agents (spec: live voice). The built-in Browser voice, then the user's own:
// live (a realtime voice model, with a chat model doing the deck work) or built from parts (speech to text, a
// chat model with its reasoning level, text to speech and a voice). One is active; Ask's voice mode uses it.
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import { activeVoiceAgent, browserCanListen, deleteVoiceAgent, saveVoiceAgent, voiceAgents, type VoiceAgent } from '../data/ai/voice'
import { modelsFor, REASONING_LEVELS, setAi, useAi, type ModelRef, type ReasoningLevel } from '../data/ai/settings'
import { Button, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { SettingGroup, SettingRow } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import s from './VoiceAgents.module.css'

const OPENAI_VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']
const key = (m: ModelRef | 'browser' | null | undefined) => (m === 'browser' ? 'browser' : m ? `${m.provider}:${m.id}` : '')
const parse = (v: string): ModelRef | null => { if (!v) return null; const [provider, ...id] = v.split(':'); return { provider: provider as ModelRef['provider'], id: id.join(':') } }

export function VoiceAgentsSettings() {
  const ai = useAi()
  const all = voiceAgents(ai)
  const active = activeVoiceAgent(ai)
  const [editing, setEditing] = useState<VoiceAgent | 'new' | null>(null)
  return (
    <SettingGroup title="Voice">
      {!all.length && <SettingRow label="No voice agents yet" description="This browser can’t recognise speech, so build one from a provider’s models." />}
      {all.map((a) => (
        <SettingRow key={a.id} label={<label className={s.pick}><input type="radio" name="voice-agent" checked={active?.id === a.id} onChange={() => setAi({ activeVoice: a.id })} />{a.name}</label>}
          description={a.id === 'browser' ? 'Your browser’s speech recognition and voices, with Ask’s model. Free; no setup.' : a.kind === 'live' ? `Live · ${a.model.id}${a.supervisor ? ` · works with ${a.supervisor.id}` : ''}` : `From parts · ${a.stt === 'browser' ? 'browser' : a.stt.id} → ${a.llm?.id ?? 'Ask’s model'} → ${a.tts === 'browser' ? 'browser voice' : a.tts.id}`}>
          {a.id !== 'browser' && <>
            <IconButton label={`Edit ${a.name}`} size="sm" tone="plain" onClick={() => setEditing(a)}><PencilSimple size={15} /></IconButton>
            <IconButton label={`Delete ${a.name}`} size="sm" tone="plain" onClick={() => deleteVoiceAgent(a.id)}><Trash size={15} /></IconButton>
          </>}
        </SettingRow>
      ))}
      <SettingRow label="New voice agent" description="Live: a realtime voice model talks and hands deck work to a chat model. From parts: speech to text, a chat model, then a voice.">
        <Button variant="secondary" icon={<Plus size={15} />} onClick={() => setEditing('new')}>New…</Button>
      </SettingRow>
      {editing && <AgentDialog agent={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </SettingGroup>
  )
}

function AgentDialog({ agent, onClose }: { agent: VoiceAgent | null; onClose: () => void }) {
  const ai = useAi()
  const voiceModels = modelsFor(ai, 'voice'), chat = modelsFor(ai, 'text'), stt = modelsFor(ai, 'transcription'), tts = modelsFor(ai, 'speech')
  const [kind, setKind] = useState<VoiceAgent['kind']>(agent?.kind ?? (voiceModels.length ? 'live' : 'parts'))
  const [name, setName] = useState(agent?.name ?? '')
  const [model, setModel] = useState(key(agent?.kind === 'live' ? agent.model : voiceModels[0]))
  const [supervisor, setSupervisor] = useState(key(agent?.kind === 'live' ? agent.supervisor : agent?.kind === 'parts' ? agent.llm : null))
  const [reasoning, setReasoning] = useState<ReasoningLevel>(agent?.reasoning ?? 'provider-default')
  const [sttV, setStt] = useState(key(agent?.kind === 'parts' ? agent.stt : browserCanListen() ? 'browser' : stt[0]))
  const [ttsV, setTts] = useState(key(agent?.kind === 'parts' ? agent.tts : 'browser'))
  const [voice, setVoice] = useState(agent?.voice ?? '')
  const browserVoices = typeof speechSynthesis !== 'undefined' ? speechSynthesis.getVoices() : []
  const ok = kind === 'live' ? !!model : !!sttV && !!ttsV
  const save = () => {
    const id = agent?.id ?? `va-${Date.now().toString(36)}`
    const base = { id, name: name.trim() || (kind === 'live' ? 'Live voice' : 'Voice agent'), reasoning: reasoning === 'provider-default' ? undefined : reasoning, voice: voice || undefined }
    saveVoiceAgent(kind === 'live'
      ? { ...base, kind: 'live', model: parse(model)!, supervisor: parse(supervisor) }
      : { ...base, kind: 'parts', stt: sttV === 'browser' ? 'browser' : parse(sttV)!, llm: parse(supervisor), tts: ttsV === 'browser' ? 'browser' : parse(ttsV)! })
    onClose()
  }
  const select = (label: string, value: string, onChange: (v: string) => void, options: { value: string; label: string }[]) => (
    <label className={s.field}><span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
    </label>
  )
  const models = (list: ModelRef[]) => list.map((m) => ({ value: key(m), label: m.id }))
  return (
    <Dialog title={agent ? `Edit ${agent.name}` : 'New voice agent'} width={480} onClose={onClose} actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={save}>Save and use</Button></>}>
      <div className={s.form}>
        <label className={s.field}><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder={kind === 'live' ? 'Live voice' : 'Voice agent'} /></label>
        <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'live', label: 'Live', title: 'A realtime voice model' }, { value: 'parts', label: 'From parts', title: 'Speech to text, a chat model, a voice' }]} />
        {kind === 'live' ? <>
          {voiceModels.length ? select('Voice model', model, setModel, models(voiceModels)) : <p className={s.note}>Turn on live voice models with Choose models on a provider (OpenAI realtime models work today).</p>}
          {select('Voice', voice, setVoice, [{ value: '', label: 'Default' }, ...OPENAI_VOICES.map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))])}
          {select('Deck work by', supervisor, setSupervisor, [{ value: '', label: 'Ask’s chosen model' }, ...models(chat)])}
        </> : <>
          {select('Speech to text', sttV, setStt, [...(browserCanListen() ? [{ value: 'browser', label: 'This browser' }] : []), ...models(stt)])}
          {select('Thinks with', supervisor, setSupervisor, [{ value: '', label: 'Ask’s chosen model' }, ...models(chat)])}
          {select('Text to speech', ttsV, setTts, [{ value: 'browser', label: 'This browser' }, ...models(tts)])}
          {ttsV === 'browser'
            ? select('Voice', voice, setVoice, [{ value: '', label: 'Default' }, ...browserVoices.map((v) => ({ value: v.name, label: `${v.name} (${v.lang})` }))])
            : <label className={s.field}><span>Voice</span><input value={voice} onChange={(e) => setVoice(e.target.value)} placeholder="The provider’s voice name, e.g. alloy" /></label>}
        </>}
        {select('Reasoning', reasoning, (v) => setReasoning(v as ReasoningLevel), REASONING_LEVELS.map((r) => ({ value: r.level, label: r.label })))}
      </div>
    </Dialog>
  )
}
