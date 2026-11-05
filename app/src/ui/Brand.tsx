// Product identity: Ream. The mark is a lowercase r whose arm ends in a sheet of paper
// (a page being added to the ream). Chosen 2026-11-05.
import s from './Brand.module.css'

export const PRODUCT = 'Ream'

export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <span className={s.mark} style={{ width: size, height: size }}>
      <svg viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="var(--ink)" />
        <path d="M10 23V12.8C10 10.7 11.7 9 13.8 9H17" fill="none" stroke="var(--paper)" strokeWidth="3.4" strokeLinecap="round" />
        <rect x="17.5" y="7.5" width="7" height="9" rx="1.6" fill="var(--deck)" transform="rotate(12 21 12)" />
      </svg>
    </span>
  )
}

export function BrandLockup() {
  return (
    <span className={s.lockup} aria-label={PRODUCT}>
      <BrandMark />
      <span className={s.name} aria-hidden>{PRODUCT}</span>
    </span>
  )
}
