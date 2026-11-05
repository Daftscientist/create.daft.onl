// Copy rules from DESIGN.md §7.
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export function relTime(t: number, now = Date.now()): string {
  const d = now - t
  if (d < MIN) return 'Just now'
  if (d < HOUR) return `${Math.floor(d / MIN)}m ago`
  const then = new Date(t)
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  if (t >= today.getTime()) return `${Math.floor(d / HOUR)}h ago`
  if (t >= today.getTime() - DAY) return 'Yesterday'
  if (t >= today.getTime() - 6 * DAY) return then.toLocaleDateString('en-GB', { weekday: 'short' })
  const sameYear = then.getFullYear() === new Date(now).getFullYear()
  return then.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** For mid-sentence use: "opened 2h ago", "backed up yesterday", but weekdays and months keep capitals. */
export function relTimeInline(t: number, now = Date.now()): string {
  const r = relTime(t, now)
  return r === 'Just now' || r === 'Yesterday' ? r.toLowerCase() : r
}

export function bytes(n: number): string {
  if (n < 1_000_000) return `${Math.max(1, Math.round(n / 1000))} KB`
  return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)} MB`
}

export const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`

/** Middle ellipsis keeps the distinguishing end of a long name ("Q3 review … final v2"). */
export function middleEllipsis(s: string, max = 48): string {
  if (s.length <= max) return s
  const keep = max - 1
  return `${s.slice(0, Math.ceil(keep * 0.6))}…${s.slice(s.length - Math.floor(keep * 0.4))}`
}
