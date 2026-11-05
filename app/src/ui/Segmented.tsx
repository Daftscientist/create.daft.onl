import { motion } from 'motion/react'
import { useId, type ReactNode } from 'react'
import { snappy } from '../lib/motion'
import s from './Segmented.module.css'

export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: {
  value: T
  options: { value: T; label: ReactNode; title: string }[]
  onChange: (v: T) => void
  label: string
  size?: 'md' | 'lg'
}) {
  const id = useId()
  return (
    <div className={s.track} role="radiogroup" aria-label={label} data-size={size}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.title}
          title={o.title}
          className={s.seg}
          onClick={() => onChange(o.value)}
        >
          {o.value === value && <motion.span layoutId={id} className={s.thumb} transition={snappy} />}
          <span className={s.label}>{o.label}</span>
        </button>
      ))}
    </div>
  )
}
