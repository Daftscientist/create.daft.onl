// Settings → AI, as pages (spec: AI settings): Providers (connect, keys, which models to bring in), Models (every
// model from connected providers: on or off, what it can do, the picture model, the model that describes
// slides), Voice, and Usage. Which chat model Ask uses is chosen in Ask's own picker.
import { Check, Eye, ImageSquare, Microphone, Plus, SpeakerHigh, TextT, Waveform } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useBrowserModel } from '../data/ai/browser'
import { CAPABILITIES, classify, type Capability } from '../data/ai/capabilities'
import { AI_PROVIDER_IDS, providerDef, type AiProviderId } from '../data/ai/providers'
import { canSee, getAi, isEnabled, setAi, setCanSee, setEnabled, setModels, setProvider, useAi, type ModelRef } from '../data/ai/settings'
import { PROVIDERS, useSync } from '../data/sync'
import { count } from '../lib/format'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { SettingGroup, SettingRow, Switch, TextField } from '../ui/Field'
import { AiMark } from './AiMark'
import { ModelSetup } from './ModelSetup'
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
    if (refreshing.current || setup || busy) return
    const stale = connected.find((id) => providerDef(id).models && (!ai.enabled?.[id] || !ai.unlisted?.[id]))
    if (!stale) return
    refreshing.current = true
    void load(stale).finally(() => { refreshing.current = false })
  }, [ai.providers, ai.enabled, ai.unlisted, setup, busy]) // eslint-disable-line react-hooks/exhaustive-deps

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
      {adding && <AddProvider id={adding} onClose={() => setAdding(null)} onAdded={(c) => { setAdding(null); void load(adding, c, true) }} />}
      {setup && <ModelSetup provider={setup.id} models={setup.models} onClose={() => {
        // Closed without choosing: keep the default (its chat models), so it isn't offered again.
        if (!getAi().enabled?.[setup.id]) setEnabled(setup.id, setup.models.filter((m) => classify(setup.id, m) === 'text'))
        setSetup(null)
      }} />}
    </>
  )
}

function AddProvider({ id, onClose, onAdded }: { id: AiProviderId; onClose: () => void; onAdded: (c: { apiKey?: string; baseURL?: string }) => void }) {
  const def = providerDef(id)
  const form = useRef<HTMLFormElement>(null)
  const submit = () => {
    const f = new FormData(form.current!)
    const c = { apiKey: String(f.get('apiKey') ?? '') || undefined, baseURL: String(f.get('baseURL') ?? '') || undefined }
    if (def.needs.includes('apiKey') && !c.apiKey) return
    setProvider(id, c)
    const model = String(f.get('model') ?? '').trim()
    if (model) { setModels(id, [model]); setEnabled(id, [model]); onClose() } else onAdded(c)
  }
  return (
    <Dialog title={`Connect ${def.name}`} width={440} onClose={onClose} actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Connect</Button></>}>
      <form ref={form} className={s.form} onSubmit={(e) => { e.preventDefault(); submit() }}>
        {def.needs.includes('baseURL') && <TextField label="Base URL" name="baseURL" placeholder={def.baseHint} autoFocus />}
        {(def.needs.includes('apiKey') || id === 'local') && <TextField label={id === 'local' ? 'API key (optional)' : 'API key'} name="apiKey" type="password" placeholder={def.keyHint ?? ''} autoFocus={!def.needs.includes('baseURL')} />}
        {!def.models && <TextField label={id === 'azure' ? 'Deployment name' : 'Model name'} name="model" />}
        {def.keysUrl && <a href={def.keysUrl} target="_blank" rel="noreferrer" className={s.link}>Get a {def.name} key</a>}
        <button type="submit" hidden />
      </form>
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

