// Choosing what to use from a provider (spec: provider setup). Step 1: its models sorted by what they do, each
// kind on or off. Step 2: the models in the kinds you turned on, each on or off. Shown after connecting a
// provider, and from its "Choose models" button.
import { useMemo, useState } from 'react'
import { CAPABILITIES, classify, type Capability } from '../data/ai/capabilities'
import { getAi, isEnabled, setEnabled } from '../data/ai/settings'
import { providerDef, type AiProviderId } from '../data/ai/providers'
import { Button } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Switch } from '../ui/Field'
import { ChatText, ImageSquare, Microphone, SpeakerHigh, Waveform, VideoCamera, Graph, DotsThree } from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import s from './ModelSetup.module.css'

const ICON: Record<Capability, ReactNode> = {
  text: <ChatText size={18} />, image: <ImageSquare size={18} />, voice: <Waveform size={18} />, speech: <SpeakerHigh size={18} />,
  transcription: <Microphone size={18} />, video: <VideoCamera size={18} />, embedding: <Graph size={18} />, other: <DotsThree size={18} weight="bold" />,
}

/** The choice of kinds and models for one provider, shared by "Choose models" and the connect flow. */
export function useModelChoice(provider: AiProviderId, all: string[]) {
  const ai = getAi()
  const byCap = useMemo(() => {
    const m = new Map<Capability, string[]>()
    for (const id of all) { const c = classify(provider, id); m.set(c, [...(m.get(c) ?? []), id]) }
    return m
  }, [all, provider])
  const [on, setOn] = useState<Set<string>>(() => new Set(all.filter((id) => isEnabled(ai, provider, id))))
  const [caps, setCaps] = useState<Set<Capability>>(() => new Set(CAPABILITIES.map((c) => c.id).filter((c) => (byCap.get(c) ?? []).some((id) => on.has(id)) || (c === 'text' && byCap.has('text')))))
  const toggleCap = (c: Capability, v: boolean) => {
    const next = new Set(caps); if (v) next.add(c); else next.delete(c)
    setCaps(next)
    // A kind turned on starts with all its models on; turned off, they all go.
    const ids = byCap.get(c) ?? []
    const o = new Set(on); for (const id of ids) { if (v) o.add(id); else o.delete(id) }
    setOn(o)
  }
  const chosen = all.filter((id) => on.has(id) && caps.has(classify(provider, id)))
  return { provider, all, byCap, on, setOn, caps, toggleCap, chosen, kinds: CAPABILITIES.filter((c) => byCap.has(c.id)), save: () => setEnabled(provider, chosen) }
}
type Choice = ReturnType<typeof useModelChoice>

export function KindsStep({ c }: { c: Choice }) {
  return (
    <ul className={s.kinds}>
      {c.kinds.map((k) => (
        <li key={k.id} className={s.kind}>
          <span className={s.kindIcon} aria-hidden>{ICON[k.id]}</span>
          <span className={s.kindText}><b>{k.label} <span className={s.count}>{c.byCap.get(k.id)!.length}</span></b><span>{k.description}</span></span>
          <Switch label={k.label} checked={c.caps.has(k.id)} onChange={(v) => c.toggleCap(k.id, v)} />
        </li>
      ))}
    </ul>
  )
}

export function ModelsStep({ c }: { c: Choice }) {
  const [q, setQ] = useState('')
  const unlisted = getAi().unlisted?.[c.provider] ?? []
  return (
    <>
      {c.all.length > 12 && <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a model" aria-label="Find a model" autoFocus />}
      <div className={s.lists}>
        {c.kinds.filter((k) => c.caps.has(k.id)).map((k) => {
          const ids = c.byCap.get(k.id)!.filter((id) => id.toLowerCase().includes(q.toLowerCase()))
          if (!ids.length) return null
          const allOn = ids.every((id) => c.on.has(id))
          return (
            <section key={k.id}>
              <div className={s.groupHead}>
                <h3>{k.label}</h3>
                <button type="button" className={s.link} onClick={() => { const o = new Set(c.on); for (const id of ids) { if (allOn) o.delete(id); else o.add(id) } c.setOn(o) }}>{allOn ? 'None' : 'All'}</button>
              </div>
              <ul className={s.models}>
                {ids.map((id) => (
                  <li key={id}>
                    <label className={s.model}>
                      <input type="checkbox" checked={c.on.has(id)} onChange={(e) => { const o = new Set(c.on); if (e.target.checked) o.add(id); else o.delete(id); c.setOn(o) }} />
                      <span>{id}</span>{unlisted.includes(id) && <span className={s.tag} title="Not in your key’s model list; your account may not have it">not listed</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </>
  )
}

/** "Choose models" on a connected provider: the two steps in a dialog. */
export function ModelSetup({ provider, models: all, onClose }: { provider: AiProviderId; models: string[]; onClose: () => void }) {
  const c = useModelChoice(provider, all)
  const [step, setStep] = useState<1 | 2>(1)
  const name = providerDef(provider).name
  if (!all.length) {
    return <Dialog title={`Models from ${name}`} onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Done</Button>}><p className={s.note}>{name} didn’t list any models. You can type a model name in Settings → AI.</p></Dialog>
  }
  return step === 1 ? (
    <Dialog title={`What should Ream use from ${name}?`} width={520} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={onClose}>Not now</Button>
      <Button variant="primary" disabled={!c.caps.size} onClick={() => setStep(2)}>Next: choose models</Button>
    </>}>
      <p className={s.note}>{name} offers {all.length} models. Turn on the kinds you want; next you can pick individual models.</p>
      <KindsStep c={c} />
    </Dialog>
  ) : (
    <Dialog title={`Choose ${name} models`} width={560} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
      <Button variant="primary" onClick={() => { c.save(); onClose() }}>Use {c.chosen.length} models</Button>
    </>}>
      <ModelsStep c={c} />
    </Dialog>
  )
}
