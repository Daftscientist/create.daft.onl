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
import s from './ModelSetup.module.css'

export function ModelSetup({ provider, models: all, onClose }: { provider: AiProviderId; models: string[]; onClose: () => void }) {
  const ai = getAi()
  const byCap = useMemo(() => {
    const m = new Map<Capability, string[]>()
    for (const id of all) { const c = classify(provider, id); m.set(c, [...(m.get(c) ?? []), id]) }
    return m
  }, [all, provider])
  const [step, setStep] = useState<1 | 2>(1)
  const [on, setOn] = useState<Set<string>>(() => new Set(all.filter((id) => isEnabled(ai, provider, id))))
  const [caps, setCaps] = useState<Set<Capability>>(() => new Set(CAPABILITIES.map((c) => c.id).filter((c) => (byCap.get(c) ?? []).some((id) => on.has(id)) || (c === 'text' && byCap.has('text')))))
  const [q, setQ] = useState('')
  const name = providerDef(provider).name
  const toggleCap = (c: Capability, v: boolean) => {
    const next = new Set(caps); if (v) next.add(c); else next.delete(c)
    setCaps(next)
    // A kind turned on starts with all its models on; turned off, they all go.
    const ids = byCap.get(c) ?? []
    const o = new Set(on); for (const id of ids) { if (v) o.add(id); else o.delete(id) }
    setOn(o)
  }
  const save = () => { setEnabled(provider, all.filter((id) => on.has(id) && caps.has(classify(provider, id)))); onClose() }
  const kinds = CAPABILITIES.filter((c) => byCap.has(c.id))

  if (!all.length) {
    return <Dialog title={`Models from ${name}`} onClose={onClose} actions={<Button variant="primary" onClick={onClose}>Done</Button>}><p className={s.note}>{name} didn’t list any models. You can type a model name in Settings → AI.</p></Dialog>
  }
  return step === 1 ? (
    <Dialog title={`What should Ream use from ${name}?`} width={520} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={onClose}>Not now</Button>
      <Button variant="primary" disabled={!caps.size} onClick={() => setStep(2)}>Next: choose models</Button>
    </>}>
      <p className={s.note}>{name} offers {all.length} models. Turn on the kinds you want; next you can pick individual models.</p>
      <ul className={s.kinds}>
        {kinds.map((c) => (
          <li key={c.id} className={s.kind}>
            <span className={s.kindText}><b>{c.label} <span className={s.count}>{byCap.get(c.id)!.length}</span></b><span>{c.description}</span></span>
            <Switch label={c.label} checked={caps.has(c.id)} onChange={(v) => toggleCap(c.id, v)} />
          </li>
        ))}
      </ul>
    </Dialog>
  ) : (
    <Dialog title={`Choose ${name} models`} width={560} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={() => setStep(1)}>Back</Button>
      <Button variant="primary" onClick={save}>Use {[...on].filter((id) => caps.has(classify(provider, id))).length} models</Button>
    </>}>
      {all.length > 12 && <input className={s.search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a model" aria-label="Find a model" autoFocus />}
      <div className={s.lists}>
        {kinds.filter((c) => caps.has(c.id)).map((c) => {
          const ids = byCap.get(c.id)!.filter((id) => id.toLowerCase().includes(q.toLowerCase()))
          if (!ids.length) return null
          const allOn = ids.every((id) => on.has(id))
          return (
            <section key={c.id}>
              <div className={s.groupHead}>
                <h3>{c.label}</h3>
                <button type="button" className={s.link} onClick={() => { const o = new Set(on); for (const id of ids) { if (allOn) o.delete(id); else o.add(id) } setOn(o) }}>{allOn ? 'None' : 'All'}</button>
              </div>
              <ul className={s.models}>
                {ids.map((id) => (
                  <li key={id}>
                    <label className={s.model}>
                      <input type="checkbox" checked={on.has(id)} onChange={(e) => { const o = new Set(on); if (e.target.checked) o.add(id); else o.delete(id); setOn(o) }} />
                      <span>{id}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Dialog>
  )
}
