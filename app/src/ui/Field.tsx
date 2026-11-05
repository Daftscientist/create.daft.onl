// Form controls: Switch, TextField, and SettingRow/SettingGroup (the one settings layout).
import { motion } from 'motion/react'
import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { snappy } from '../lib/motion'
import s from './Field.module.css'

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={s.switch} onClick={() => onChange(!checked)}>
      <motion.span className={s.knob} layout transition={snappy} />
    </button>
  )
}

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; hideLabel?: boolean }>(
  function TextField({ label, hint, error, id, hideLabel, className, ...rest }, ref) {
    const auto = useId()
    const fid = id ?? auto
    return (
      <label className={`${s.field} ${className ?? ''}`} htmlFor={fid}>
        <span className={hideLabel ? 'sr-only' : s.label}>{label}</span>
        <input ref={ref} id={fid} className={s.input} aria-invalid={!!error || undefined} aria-describedby={`${fid}-msg`} {...rest} />
        {(error || hint) && <span id={`${fid}-msg`} className={error ? s.error : s.hint}>{error ?? hint}</span>}
      </label>
    )
  },
)

export function SettingGroup({ title, children, tone, dense }: { title?: string; children: ReactNode; tone?: 'danger'; dense?: boolean }) {
  return (
    <section className={s.group} data-tone={tone} data-dense={dense || undefined}>
      {title && <h2 className={s.groupTitle}>{title}</h2>}
      <div className={s.rows}>{children}</div>
    </section>
  )
}

export function SettingRow({ label, description, children }: { label: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowLabel}>{label}</div>
        {description && <div className={s.rowDesc}>{description}</div>}
      </div>
      {children && <div className={s.control}>{children}</div>}
    </div>
  )
}
