// What Ream sent to AI providers from this account on this browser (spec: Usage): requests, tokens and pictures
// per provider and model, by day. The provider's own dashboard is the bill.
import { scoped } from '../accounts'
import { useSyncExternalStore } from 'react'

export type Count = { requests: number; input: number; output: number; reasoning: number; cached: number; pictures: number }
type Store = Record<string, Record<string, Count>> // "provider:model" → "YYYY-MM-DD" → counts
const KEY = scoped('ream.usage')
const zero = (): Count => ({ requests: 0, input: 0, output: 0, reasoning: 0, cached: 0, pictures: 0 })
let store: Store = (() => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { return {} } })()
const listeners = new Set<() => void>()
const day = (t = Date.now()) => new Date(t).toISOString().slice(0, 10)

/** Adds to today's counts for a model. Token fields are optional (providers don't all report them). */
export function recordUsage(provider: string, model: string, add: Partial<Count>) {
  const k = `${provider}:${model}`
  const d = day()
  const cur = store[k]?.[d] ?? zero()
  const next: Count = { ...cur }
  for (const f of Object.keys(next) as (keyof Count)[]) next[f] += Math.max(0, Math.round(add[f] ?? 0))
  store = { ...store, [k]: { ...store[k], [d]: next } }
  try { localStorage.setItem(KEY, JSON.stringify(store)) } catch { /* full: counts stay for this session */ }
  for (const l of listeners) l()
}

/** Totals per model since `days` ago (all time when null). */
export function usageSince(days: number | null): { provider: string; model: string; count: Count }[] {
  const from = days === null ? '' : day(Date.now() - (days - 1) * 86_400_000)
  return Object.entries(store).map(([k, byDay]) => {
    const [provider, ...rest] = k.split(':')
    const count = zero()
    for (const [d, c] of Object.entries(byDay)) if (d >= from) for (const f of Object.keys(count) as (keyof Count)[]) count[f] += c[f] ?? 0
    return { provider, model: rest.join(':'), count }
  }).filter((x) => x.count.requests > 0 || x.count.pictures > 0)
}
export function clearUsage() { store = {}; try { localStorage.removeItem(KEY) } catch { /* ok */ } for (const l of listeners) l() }
export function useUsageVersion() { return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => store) }

/** Totals for each day of the last `days` days (oldest first), across every model. */
export function usageByDay(days: number): { day: string; count: Count }[] {
  const out = Array.from({ length: days }, (_, i) => ({ day: day(Date.now() - (days - 1 - i) * 86_400_000), count: zero() }))
  const at = new Map(out.map((x) => [x.day, x.count]))
  for (const byDay of Object.values(store)) for (const [d, c] of Object.entries(byDay)) {
    const t = at.get(d)
    if (t) for (const f of Object.keys(t) as (keyof Count)[]) t[f] += c[f] ?? 0
  }
  return out
}
