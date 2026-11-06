// Picks one enabled model of a kind (picture generation, picture reading): Settings → AI.
import { CaretDown } from '@phosphor-icons/react'
import { useState } from 'react'
import type { Capability } from '../data/ai/capabilities'
import { modelsFor, providerName, useAi, type ModelRef } from '../data/ai/settings'
import { Menu, type MenuAnchor } from '../ui/Menu'
import { AiMark } from './AiMark'
import s from './ModelPicker.module.css'

export function CapabilityPicker({ cap, value, onChange, label, filter, none }: { cap: Capability; value: ModelRef | null | undefined; onChange: (m: ModelRef | null) => void; label: string; filter?: (m: ModelRef) => boolean; none?: string }) {
  const ai = useAi()
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const options = modelsFor(ai, cap).filter((m) => !filter || filter(m))
  const current = value && options.find((m) => m.provider === value.provider && m.id === value.id)
  return (
    <>
      <button type="button" className={s.field} aria-haspopup="menu" aria-expanded={!!menu} aria-label={label} disabled={!options.length}
        onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.right, y: r.bottom + 6, align: 'end' }) }}>
        {current && <AiMark id={current.provider} size={16} bare />}
        <span className={s.label}>{current ? current.id : options.length ? (none ?? 'Choose') : 'None turned on'}</span>
        {options.length > 0 && <CaretDown size={12} weight="bold" className={s.caret} />}
      </button>
      <Menu open={!!menu} anchor={menu} label={label} onClose={() => setMenu(null)} search={options.length > 10 ? 'Find a model' : undefined}
        items={[
          ...(none ? [{ label: none, selected: !current, run: () => onChange(null) }] : []),
          ...options.map((m) => ({ label: m.id, hint: providerName(m.provider, null), icon: <AiMark id={m.provider} size={16} bare />, selected: !!current && current.id === m.id && current.provider === m.provider, run: () => onChange(m) })),
        ]} />
    </>
  )
}
