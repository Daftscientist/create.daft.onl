// Buttons (DESIGN.md §6 Button). The only place button styling lives.
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import s from './Button.module.css'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  size?: Size
  icon?: ReactNode
  trailing?: ReactNode
}>(function Button({ variant = 'secondary', size = 'md', icon, trailing, children, className, type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} className={`${s.btn} ${className ?? ''}`} data-variant={variant} data-size={size} {...rest}>
      {icon && <span className={s.icon}>{icon}</span>}
      {children && <span className={s.text}>{children}</span>}
      {trailing}
    </button>
  )
})

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  hint?: string
  size?: 'sm' | 'md' | 'lg'
  tone?: 'fill' | 'plain' | 'glass'
  tooltip?: boolean
  side?: 'bottom' | 'top' | 'right'
}>(function IconButton({ label, hint, size = 'md', tone = 'fill', tooltip = true, side, children, className, type = 'button', ...rest }, ref) {
  const btn = (
    <button ref={ref} type={type} aria-label={label} className={`${s.icon_btn} ${tone === 'glass' ? 'glass' : ''} ${className ?? ''}`} data-size={size} data-tone={tone} {...rest}>
      {children}
    </button>
  )
  return tooltip ? <Tooltip label={label} hint={hint} side={side}>{btn}</Tooltip> : btn
})

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className={s.kbd}>{children}</kbd>
}

/** A shortcut as separate key caps: <Keys keys={['Ctrl', 'K']} />. */
export function Keys({ keys }: { keys: string[] }) {
  return <span className={s.keys}>{keys.map((k, i) => <kbd key={i} className={s.cap}>{k}</kbd>)}</span>
}

/** iOS-style text action for mobile headers ("Select", "Done", "Empty"). */
export function TextButton({ children, className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={`${s.textBtn} ${className ?? ''}`} {...rest}>{children}</button>
}

/** Mobile back control: chevron + "Back", always visible beside the edge-swipe gesture. */
export function BackButton({ onClick, label = 'Back' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={s.backBtn} onClick={onClick}>
      <svg width="12" height="20" viewBox="0 0 12 20" aria-hidden><path d="M10 2 2 10l8 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
      {label}
    </button>
  )
}
