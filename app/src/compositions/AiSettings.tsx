// Settings → AI, as pages (spec: AI settings): Providers (connect, keys, which models to bring in), Models (every
// model from connected providers: on or off, what it can do, the picture model, the model that describes
// slides), Voice, and Usage. Which chat model Ask uses is chosen in Ask's own picker.
import { Check, Eye, ImageSquare, Microphone, Plus, SpeakerHigh, TextT, Waveform } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBrowserModel } from '../data/ai/browser'
import { CAPABILITIES, classify, type Capability } from '../data/ai/capabilities'
import { AI_PROVIDER_IDS, providerDef, type AiProviderId } from '../data/ai/providers'
import { canSee, getAi, isEnabled, modelsFor, setAi, setCanSee, setEnabled, setModels, setProvider, useAi, type ModelRef } from '../data/ai/settings'
import { PROVIDERS, useSync } from '../data/sync'
import { count } from '../lib/format'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { SettingGroup, SettingRow, Switch, TextField } from '../ui/Field'
import { AiMark } from './AiMark'
import { KindsStep, ModelSetup, ModelsStep, useModelChoice } from './ModelSetup'
import s from './AiSettings.module.css'

// ---------- Providers ----------

export function AiProviders() {
  const ai = useAi()
  const sync = useSync()
  const browser = useBrowserModel()
  const [adding, setAdding] = useState<AiProviderId | null>(null)
  const [busy, setBusy] = useState<AiProviderId | null>(null)
  const [error, setError] = useState<{ id: AiProviderId; message: string } | null>(null)
  const [setup, setSetup] = useState<{ id: AiProviderId; models: string[] } | null>(null)
  const connected = AI_PROVIDER_IDS.filter((id) => ai.providers[id])
  const others = AI_PROVIDER_IDS.filter((id) => !ai.providers[id])

  const load = async (id: AiProviderId, config = ai.providers[id] ?? {}, offer = !getAi().enabled?.[id]) => {
    const def = providerDef(id)
    if (!def.models) return
    setBusy(id); setError(null)
    try {
      setModels(id, await def.models(config))
      if (offer) setSetup({ id, models: getAi().models?.[id] ?? [] })
    } catch (e) { setError({ id, message: (e as Error).message }) }
    finally { setBusy(null) }
  }
  // Lists saved before every model was kept (or before known models were added) are listed again, once.
  const refreshing = useRef(false)
  useEffect(() => {
    // Not while a provider is being connected: its own flow does the choosing.
    if (refreshing.current || setup || busy || adding) return
    const stale = connected.find((id) => providerDef(id).models && (!ai.enabled?.[id] || !ai.unlisted?.[id]))
    if (!stale) return
    refreshing.current = true
    void load(stale).finally(() => { refreshing.current = false })
  }, [ai.providers, ai.enabled, ai.unlisted, setup, busy, adding]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <p className={s.lede}>Ream uses your own AI accounts and calls them straight from this browser. Nothing goes through Ream.</p>
      <SettingGroup title="Connected">
        {browser && <SettingRow label={<span className={s.name}><AiMark id="browser" size={22} />{browser.name}</span>} description={`${browser.model} runs on this device: free, private, offline. Small, so best for short edits.`} />}
        {!connected.length && !browser && <SettingRow label="No providers yet" description="Add one below with your API key." />}
        {connected.map((id) => {
          const n = (ai.models?.[id] ?? []).filter((m) => isEnabled(ai, id, m)).length
          return (
            <SettingRow key={id} label={<span className={s.name}><AiMark id={id} size={22} />{providerDef(id).name}</span>}
              description={error?.id === id ? <span className={s.err}>{error.message}</span> : busy === id ? 'Loading models…' : `${count(n, 'model')} on of ${ai.models?.[id]?.length ?? 0}`}>
              <Button variant="secondary" disabled={!ai.models?.[id]?.length} onClick={() => setSetup({ id, models: ai.models?.[id] ?? [] })}>Choose models</Button>
              {providerDef(id).models && <Button variant="ghost" disabled={busy === id} onClick={() => void load(id, undefined, false)}>Refresh</Button>}
              <Button variant="ghost" onClick={() => setProvider(id, null)}>Remove</Button>
            </SettingRow>
          )
        })}
      </SettingGroup>
      <SettingGroup title="Add a provider">
        <div className={s.grid}>
          {others.map((id) => (
            <button key={id} type="button" className={s.tile} onClick={() => { setAdding(id); setError(null) }}>
              <AiMark id={id} size={22} /><span>{providerDef(id).name}</span><Plus size={14} className={s.plus} />
            </button>
          ))}
        </div>
      </SettingGroup>
      <p className={s.note}>{sync.provider
        ? sync.encrypted ? 'Keys sync with your library, end-to-end encrypted.' : `Keys sync with your library, so ${PROVIDERS[sync.provider].name} can read them. Turn on end-to-end encryption in Sync to prevent that.`
        : 'Keys are stored in this browser’s library. If you connect sync, they go with it.'}</p>
      {adding && <ConnectFlow id={adding} onClose={() => setAdding(null)} />}
      {setup && <ModelSetup provider={setup.id} models={setup.models} onClose={() => {
        // Closed without choosing: keep the default (its chat models), so it isn't offered again.
        if (!getAi().enabled?.[setup.id]) setEnabled(setup.id, setup.models.filter((m) => classify(setup.id, m) === 'text'))
        setSetup(null)
      }} />}
    </>
  )
}

// ---------- connecting, step by step ----------

/** How to get a key, per provider (the generic steps otherwise). */
const KEY_TIPS: Partial<Record<AiProviderId, string[]>> = {
  openai: ['Open OpenAI’s API keys page and press Create new secret key.', 'Keep its permissions on All: a restricted key can hide picture and voice models.', 'Copy the key (it starts with sk-) and paste it below.'],
  anthropic: ['Open the Anthropic Console’s API keys page and press Create Key.', 'Copy the key (it starts with sk-ant-) and paste it below.'],
  google: ['Open Google AI Studio and press Create API key.', 'Copy the key and paste it below.'],
  local: ['Start Ollama or LM Studio on this computer.', 'For Ollama, allow the browser to reach it: set OLLAMA_ORIGINS=* before starting it.', 'Paste its address below (Ollama: http://localhost:11434/v1).'],
}
const NOTES: Partial<Record<AiProviderId, string>> = {
  openai: 'Picture models (gpt-image) also need your organisation verified in OpenAI’s settings.',
}
const STEPS = ['Key', 'What to use', 'Models', 'Done']

function Stepper({ at }: { at: number }) {
  return (
    <ol className={s.stepper} aria-label={`Step ${at + 1} of ${STEPS.length}`}>
      {STEPS.map((x, i) => <li key={x} data-state={i < at ? 'done' : i === at ? 'now' : undefined}><span>{i < at ? <Check size={11} weight="bold" /> : i + 1}</span>{x}</li>)}
    </ol>
  )
}

/** Connecting a provider (spec: AI settings): get a key (with the steps for that provider), Ream checks it by
 *  listing models, then what to use, which models, and a summary of what's now set up. */
function ConnectFlow({ id, onClose }: { id: AiProviderId; onClose: () => void }) {
  const def = providerDef(id)
  const [step, setStep] = useState<'key' | 'choose' | 'done'>('key')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [models, setList] = useState<string[]>([])
  const form = useRef<HTMLFormElement>(null)
  const tips = KEY_TIPS[id] ?? [`Open ${def.name}’s API keys page.`, 'Create a new key.', 'Copy it and paste it below.']

  const check = async () => {
    const f = new FormData(form.current!)
    const c = { apiKey: String(f.get('apiKey') ?? '').trim() || undefined, baseURL: String(f.get('baseURL') ?? '').trim() || undefined }
    if (def.needs.includes('apiKey') && !c.apiKey) { setError('Paste your key first.'); return }
    if (def.needs.includes('baseURL') && !c.baseURL && id !== 'local') { setError('Paste the address first.'); return }
    setChecking(true); setError(null)
    try {
      const model = String(f.get('model') ?? '').trim()
      if (!def.models) {
        if (!model) { setError(`Type the ${id === 'azure' ? 'deployment' : 'model'} name.`); return }
        setProvider(id, c); setModels(id, [model]); setEnabled(id, [model]); setStep('done'); return
      }
      const list = await def.models(c)
      setProvider(id, c); setModels(id, list)
      setList(getAi().models?.[id] ?? list)
      setStep('choose')
    } catch (e) {
      setError(`${(e as Error).message} Check the key and try again.`)
    } finally { setChecking(false) }
  }

  if (step === 'choose') return <ChooseSteps id={id} models={models} onClose={onClose} onDone={() => setStep('done')} />
  if (step === 'done') return <ConnectDone id={id} onClose={onClose} />
  return (
    <Dialog title={`Connect ${def.name}`} width={480} onClose={onClose} actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={checking} onClick={() => void check()}>{checking ? 'Checking the key…' : 'Continue'}</Button></>}>
      <Stepper at={0} />
      <ol className={s.tips}>
        {tips.map((t, i) => <li key={i}>{i === 0 && def.keysUrl ? <><a href={def.keysUrl} target="_blank" rel="noreferrer" className={s.link}>{t.replace(/\.$/, '')} ↗</a></> : t}</li>)}
      </ol>
      <form ref={form} className={s.form} onSubmit={(e) => { e.preventDefault(); void check() }}>
        {def.needs.includes('baseURL') && <TextField label="Address" name="baseURL" placeholder={def.baseHint} autoFocus />}
        {(def.needs.includes('apiKey') || id === 'local') && <TextField label={id === 'local' ? 'API key (optional)' : 'API key'} name="apiKey" type="password" placeholder={def.keyHint ?? ''} autoFocus={!def.needs.includes('baseURL')}
          onPaste={() => setTimeout(() => void check(), 50)} />}
        {!def.models && <TextField label={id === 'azure' ? 'Deployment name' : 'Model name'} name="model" />}
        <button type="submit" hidden />
      </form>
      {error && <p className={s.err} role="alert">{error}</p>}
      <p className={s.fine}>The key stays in this browser’s library; Ream calls {def.name} directly.{NOTES[id] ? ` ${NOTES[id]}` : ''}</p>
    </Dialog>
  )
}

function ChooseSteps({ id, models, onClose, onDone }: { id: AiProviderId; models: string[]; onClose: () => void; onDone: () => void }) {
  const c = useModelChoice(id, models)
  const [sub, setSub] = useState<'kinds' | 'models'>('kinds')
  const name = providerDef(id).name
  return sub === 'kinds' ? (
    <Dialog title={`What should Ream use from ${name}?`} width={520} onClose={onClose} actions={<Button variant="primary" disabled={!c.caps.size} onClick={() => setSub('models')}>Next</Button>}>
      <Stepper at={1} />
      <p className={s.fine}>Your key works: {name} offers {models.length} models. Turn on what you’d like Ream to use.</p>
      <KindsStep c={c} />
    </Dialog>
  ) : (
    <Dialog title={`Which ${name} models?`} width={560} onClose={onClose} actions={<><Button variant="ghost" onClick={() => setSub('kinds')}>Back</Button><Button variant="primary" onClick={() => { c.save(); onDone() }}>Use {c.chosen.length} models</Button></>}>
      <Stepper at={2} />
      <ModelsStep c={c} />
    </Dialog>
  )
}

/** What's set up now: sensible defaults where there were none (Ask's model, the picture model), and how to use it. */
function ConnectDone({ id, onClose }: { id: AiProviderId; onClose: () => void }) {
  const ai = useAi()
  const name = providerDef(id).name
  const mine = (cap: Capability) => modelsFor(ai, cap).filter((m) => m.provider === id)
  useEffect(() => {
    const a = getAi()
    const chat = modelsFor(a, 'text').filter((m) => m.provider === id)
    const pics = modelsFor(a, 'image').filter((m) => m.provider === id)
    if (!a.model && chat[0]) setAi({ model: chat[0] })
    if (!a.imageModel && pics[0]) setAi({ imageModel: pics[0] })
  }, [id])
  const rows: [ReactNode, string, string][] = []
  if (mine('text').length) rows.push([<TextT size={16} key="t" />, `${mine('text').length} chat models`, ai.model?.provider === id ? `Ask uses ${ai.model.id}; switch any time in Ask’s model picker.` : 'Pick one in Ask’s model picker.'])
  if (mine('image').length) rows.push([<ImageSquare size={16} key="i" />, 'Pictures', `${ai.imageModel?.id ?? mine('image')[0].id} makes pictures: Picture → Generate in the editor.`])
  if (mine('voice').length) rows.push([<Waveform size={16} key="v" />, 'Live voice', `${mine('voice')[0].id}: press Talk in Ask.`])
  if (mine('speech').length || mine('transcription').length) rows.push([<SpeakerHigh size={16} key="s" />, 'Speech', 'A clearer voice for Talk in Ask.'])
  return (
    <Dialog title={`${name} is connected`} width={480} onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <Stepper at={3} />
      <ul className={s.summary}>
        {rows.map(([icon, title, body]) => <li key={title}><span className={s.sumIcon}>{icon}</span><span><b>{title}</b><span>{body}</span></span></li>)}
      </ul>
      <p className={s.fine}>Change any of this later in Settings → Models.</p>
    </Dialog>
  )
}

// ---------- Models ----------

const KIND_ICON: Record<Capability, ReactNode> = {
  text: <TextT size={13} />, image: <ImageSquare size={13} />, voice: <Waveform size={13} />, speech: <SpeakerHigh size={13} />,
  transcription: <Microphone size={13} />, video: null, embedding: null, other: null,
}
const USED: Capability[] = ['text', 'image', 'voice', 'speech', 'transcription']

export function AiModels() {
  const ai = useAi()
  const [q, setQ] = useState('')
  const [only, setOnly] = useState(false)
  const rows = useMemo(() => AI_PROVIDER_IDS.filter((p) => ai.providers[p]).flatMap((p) => (ai.models?.[p] ?? []).map((id) => ({ provider: p, id, kind: classify(p, id) }))), [ai.providers, ai.models])
  const shown = rows.filter((r) => USED.includes(r.kind) && (!only || isEnabled(ai, r.provider, r.id)) && `${r.id} ${providerDef(r.provider).name}`.toLowerCase().includes(q.toLowerCase()))
  const toggle = (p: AiProviderId, id: string, on: boolean) => {
    const cur = (ai.models?.[p] ?? []).filter((m) => isEnabled(ai, p, m))
    setEnabled(p, on ? [...cur, id] : cur.filter((m) => m !== id))
  }
  const same = (a: ModelRef | null | undefined, p: AiProviderId, id: string) => !!a && a.provider === p && a.id === id
  if (!rows.length) return <p className={s.lede}>Connect a provider first; its models show up here.</p>
  return (
    <>
      <p className={s.lede}>Every model from your providers. Turn on the ones Ream should offer; pick the one that makes pictures and the one that describes slides to models that can’t see.</p>
      <div className={s.filters}>
        <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a model" aria-label="Find a model" />
        <label className={s.onlyOn}><Switch label="Only models that are on" checked={only} onChange={setOnly} /> Only on</label>
      </div>
      {CAPABILITIES.filter((c) => USED.includes(c.id)).map((c) => {
        const list = shown.filter((r) => r.kind === c.id)
        if (!list.length) return null
        return (
          <SettingGroup key={c.id} title={`${c.label} · ${list.filter((r) => isEnabled(ai, r.provider, r.id)).length} on`}>
            <ul className={s.models}>
              {list.map((r) => {
                const on = isEnabled(ai, r.provider, r.id)
                const sees = r.kind === 'text' && canSee(ai, r)
                const unlisted = ai.unlisted?.[r.provider]?.includes(r.id)
                return (
                  <li key={`${r.provider}:${r.id}`} className={s.model} data-off={!on || undefined}>
                    <Switch label={`Use ${r.id}`} checked={on} onChange={(v) => toggle(r.provider, r.id, v)} />
                    <AiMark id={r.provider} size={18} bare />
                    <span className={s.modelName}>
                      <b>{r.id}</b>
                      <span className={s.badges}>
                        <span className={s.badge}>{KIND_ICON[r.kind]}{c.label.replace(/ models$/, '')}</span>
                        {r.kind === 'text' && <button type="button" className={s.badge} data-on={sees || undefined} aria-pressed={sees} title={sees ? 'Sees pictures (click if it can’t)' : 'Can’t see pictures (click if it can)'} onClick={() => setCanSee(r, !sees)}><Eye size={13} />{sees ? 'Sees pictures' : 'Text only'}</button>}
                        {unlisted && <span className={s.badge} title="Not in this key’s model list; it may not be available to your account">Not listed</span>}
                      </span>
                    </span>
                    {on && r.kind === 'image' && (
                      <button type="button" className={s.pick} aria-pressed={same(ai.imageModel, r.provider, r.id)} onClick={() => setAi({ imageModel: same(ai.imageModel, r.provider, r.id) ? null : r })}>
                        {same(ai.imageModel, r.provider, r.id) ? <><Check size={13} weight="bold" />Makes pictures</> : 'Use for pictures'}
                      </button>
                    )}
                    {on && sees && (
                      <button type="button" className={s.pick} aria-pressed={same(ai.visionModel, r.provider, r.id)} onClick={() => setAi({ visionModel: same(ai.visionModel, r.provider, r.id) ? null : r })}>
                        {same(ai.visionModel, r.provider, r.id) ? <><Check size={13} weight="bold" />Describes slides</> : 'Describe slides'}
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          </SettingGroup>
        )
      })}
      {!shown.length && <p className={s.note}>No models match.</p>}
    </>
  )
}

