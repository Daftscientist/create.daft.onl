// Product identity. Candidates are previewable in place with ?brand=<id> (remembered per browser)
// until the user picks one; then the others are deleted.
import { useSyncExternalStore } from 'react'
import s from './Brand.module.css'

type BrandDef = { id: string; name: string; mark: () => React.ReactElement }

const Foolscap = () => (
  // A sheet whose corner folds over into a jester's cap point, with the bell as a dot.
  <svg viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <path d="M9 7.5h9.5L24 13v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 24.5V9a1.5 1.5 0 0 1 1-1.5Z" fill="var(--paper)" />
    <path d="M18.5 7.5V12a1 1 0 0 0 1 1H24Z" fill="var(--deck)" />
    <circle cx="24.6" cy="7" r="1.9" fill="var(--deck)" />
  </svg>
)
const Ream = () => (
  // Three stacked sheets, offset like a ream seen edge-on.
  <svg viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <rect x="9" y="17" width="16" height="7" rx="1.6" fill="var(--paper)" opacity=".38" />
    <rect x="8" y="13" width="16" height="7" rx="1.6" fill="var(--paper)" opacity=".66" />
    <rect x="7" y="8.5" width="16" height="7.5" rx="1.6" fill="var(--paper)" />
    <rect x="9.5" y="11" width="6.5" height="1.6" rx=".8" fill="var(--deck)" />
  </svg>
)
const Sheaf = () => (
  // Three sheets fanned from one corner, a bundle held together.
  <svg viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <g transform="translate(10 24)">
      <rect x="0" y="-15" width="10" height="13" rx="1.4" fill="var(--paper)" opacity=".4" transform="rotate(-24)" />
      <rect x="0" y="-15" width="10" height="13" rx="1.4" fill="var(--paper)" opacity=".7" transform="rotate(-8)" />
      <rect x="0" y="-15" width="10" height="13" rx="1.4" fill="var(--paper)" transform="rotate(10)" />
    </g>
    <circle cx="10" cy="24" r="1.6" fill="var(--deck)" />
  </svg>
)
const Octavo = () => (
  // A sheet folded into eight: the fold lines are the mark.
  <svg viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <rect x="8" y="7" width="16" height="18" rx="1.8" fill="var(--paper)" />
    <path d="M16 7v18M8 11.5h16M8 16h16M8 20.5h16" stroke="var(--ink)" strokeOpacity=".16" strokeWidth="1" />
    <rect x="8" y="7" width="8" height="4.5" rx="1.2" fill="var(--deck)" />
  </svg>
)
const Office = () => (
  <svg viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="8" fill="var(--ink)" />
    <rect x="7" y="9" width="18" height="12" rx="2.5" fill="var(--paper)" />
    <rect x="10" y="12.5" width="8" height="2" rx="1" fill="var(--deck)" />
  </svg>
)

export const BRANDS: BrandDef[] = [
  { id: 'foolscap', name: 'Foolscap', mark: Foolscap },
  { id: 'ream', name: 'Ream', mark: Ream },
  { id: 'sheaf', name: 'Sheaf', mark: Sheaf },
  { id: 'octavo', name: 'Octavo', mark: Octavo },
  { id: 'office', name: 'Office', mark: Office },
]

const KEY = 'office.brand.preview'
function read(): BrandDef {
  let id = new URLSearchParams(location.search).get('brand')
  try {
    if (id) localStorage.setItem(KEY, id)
    else id = localStorage.getItem(KEY)
  } catch { /* preview only */ }
  return BRANDS.find((b) => b.id === id) ?? BRANDS[0]
}
let current = read()
document.title = current.name
addEventListener('popstate', () => { current = read(); document.title = current.name })

export const useBrand = () => useSyncExternalStore(() => () => {}, () => current)

export function BrandMark({ size = 22 }: { size?: number }) {
  const b = useBrand()
  return <span className={s.mark} style={{ width: size, height: size }}><b.mark /></span>
}

export function BrandLockup() {
  const b = useBrand()
  return (
    <span className={s.lockup}>
      <BrandMark />
      <span className={s.name}>{b.name}</span>
    </span>
  )
}
