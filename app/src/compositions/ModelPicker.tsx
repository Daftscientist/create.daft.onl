// Every model the user can use, grouped by provider with its logo: the browser's built-in model
// first (when it has one), then each connected provider's chat models. One picker for the
// Ask Ream header (`chip`) and Settings → AI (`field`).
import { CaretDown, Gear } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { BROWSER_MODEL_ID, useBrowserModel } from '../data/ai/browser'
import { AI_PROVIDER_IDS, providerDef, type AiProviderId } from '../data/ai/providers'
import { getAi, modelLabel, providerName, setAi, setModels, useActiveModel, useAi } from '../data/ai/settings'
import { navigate } from '../lib/router'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { AiMark } from './AiMark'
import s from './ModelPicker.module.css'

const loading = new Set<AiProviderId>()
/** Lists a provider's models once if this device has none stored for it (e.g. added before lists were kept). */
export async function ensureModels(id: AiProviderId) {
  const def = providerDef(id)
  const config = getAi().providers[id]
  if (!def.models || !config || getAi().models?.[id] || loading.has(id)) return
  loading.add(id)
  try { setModels(id, await def.models(config)) } catch { /* Settings shows the error when asked */ } finally { loading.delete(id) }
}

export function ModelPicker({ variant }: { variant: 'chip' | 'field' }) {
  const ai = useAi()
  const browser = useBrowserModel()
  const active = useActiveModel()
  const trigger = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const connected = AI_PROVIDER_IDS.filter((id) => ai.providers[id])
  useEffect(() => { if (anchor) connected.forEach((id) => void ensureModels(id)) }, [anchor]) // only on open

  const items: MenuItem[] = []
  if (browser) {
    items.push({ kind: 'header', content: <span className={s.group}>{browser.name}</span> })
    items.push({
      label: browser.model, keywords: browser.name, icon: <AiMark id="browser" size={16} bare />,
      hint: browser.status === 'available' ? 'On this device' : 'Downloads on first use',
      selected: active?.provider === 'browser', run: () => setAi({ model: { provider: 'browser', id: BROWSER_MODEL_ID } }),
    })
  }
  for (const id of connected) {
    const list = ai.models?.[id] ?? []
    const name = providerName(id, browser)
    items.push({ kind: 'header', content: <span className={s.group}>{name}</span> })
    if (!list.length) items.push({ kind: 'note', text: providerDef(id).models ? 'Loading models…' : 'Enter a model name in Settings → AI.' })
    for (const m of list) {
      items.push({
        label: m, keywords: name, icon: <AiMark id={id} size={16} bare />,
        selected: active?.provider === id && active.id === m, run: () => setAi({ model: { provider: id, id: m } }),
      })
    }
  }
  if (variant === 'chip') items.push({ kind: 'sep' }, { label: 'Manage providers…', icon: <Gear size={16} />, run: () => navigate({ name: 'settings', section: 'ai' }) })

  const open = () => {
    const r = trigger.current!.getBoundingClientRect()
    setAnchor(variant === 'chip' ? { x: r.left, y: r.bottom + 6 } : { x: r.right, y: r.bottom + 6, align: 'end' })
  }
  const empty = !browser && !connected.length
  const label = active ? modelLabel(active, browser) : empty ? 'Add a provider' : 'Choose a model'
  const title = active ? `${providerName(active.provider, browser)} · ${active.provider === 'browser' ? browser?.model : active.id}` : undefined

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={variant === 'chip' ? s.chip : s.field}
        title={title}
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        onClick={() => (empty ? navigate({ name: 'settings', section: 'ai' }) : anchor ? setAnchor(null) : open())}
      >
        {active && <AiMark id={active.provider} size={variant === 'chip' ? 13 : 16} bare />}
        <span className={s.label}>{label}</span>
        {!empty && <CaretDown size={variant === 'chip' ? 10 : 12} weight="bold" className={s.caret} />}
      </button>
      <Menu open={!!anchor} anchor={anchor} items={items} label="Model" search={items.length > 10 ? 'Find a model' : undefined} onClose={() => setAnchor(null)} />
    </>
  )
}
