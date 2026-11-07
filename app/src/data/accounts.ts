// Accounts (docs/design/specs/accounts.md). Each account is a whole, isolated library on this device: local, or
// backed by a Dropbox / Google Drive / OneDrive account (its local library is then an offline cache that syncs).
// The registry lives in localStorage; the active account is fixed for the page's life: switching reloads, so no
// state from one account can leak into another. The first account ("default") uses the pre-accounts storage names,
// so libraries from before accounts carry on in place.
import { useSyncExternalStore } from 'react'

export type AccountKind = 'local' | 'dropbox' | 'google' | 'onedrive'
export type Account = {
  id: string
  kind: AccountKind
  name: string
  email?: string
  avatar?: string
  /** Local accounts: the seed of their generated face (lib/avatar). */
  avatarSeed?: string
  /** Monogram colour for local accounts (and a fallback when a photo fails). */
  hue: number
  /** The provider's own id for the signed-in user: the same person signing in twice is one account. */
  remoteId?: string
  addedAt: number
}
/** `active` is only the account a fresh launch opens; each tab remembers its own (sessionStorage), so switching in
 *  one tab never changes another. `legacyClaimed`: the "default" id (pre-accounts storage names) is used once, ever. */
type Registry = { accounts: Account[]; active: string | null; legacyClaimed?: boolean }

const KEY = 'ream.accounts.v1', TAB = 'ream.tab.account'
const read = (): Registry => {
  try { const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Registry | null; if (r?.accounts) return r } catch { /* fall through */ }
  return { accounts: [], active: null }
}

/** Libraries from before accounts: became the "default" account, local or the provider it synced with. */
function migrate(): Registry {
  const r = read()
  if (r.accounts.length || r.legacyClaimed) return r
  const old = (() => { try { return JSON.parse(localStorage.getItem('ream.sync.v1') ?? 'null') as { provider?: AccountKind; account?: string; accountName?: string; avatar?: string } | null } catch { return null } })()
  // Test and demo links (?demo, ?empty, ?reset) open straight into a local library.
  const testLink = /[?&](demo|empty|reset)\b/.test(location.search)
  const hadLibrary = !!localStorage.getItem('ream.device.id') || !!old || testLink
  if (!hadLibrary) return r
  const a: Account = old?.provider
    ? { id: 'default', kind: old.provider, name: old.accountName ?? old.account ?? 'My account', email: old.account, avatar: old.avatar, hue: 220, addedAt: Date.now() }
    : { id: 'default', kind: 'local', name: 'Personal', hue: 220, addedAt: Date.now() }
  const next: Registry = { accounts: [a], active: 'default', legacyClaimed: true }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

let reg = migrate()
const tabPick = (() => {
  const params = new URLSearchParams(location.search)
  // `?account=<id>` opens a specific account in this tab.
  const want = params.get('account') ?? (() => { try { return sessionStorage.getItem(TAB) } catch { return null } })()
  return want && reg.accounts.some((a) => a.id === want) ? want : null
})()
/** The account this page has open, fixed until reload (null: none yet, first run). */
const ACTIVE: Account | null = reg.accounts.find((a) => a.id === (tabPick ?? reg.active)) ?? reg.accounts[0] ?? null
try { if (ACTIVE) sessionStorage.setItem(TAB, ACTIVE.id) } catch { /* private mode */ }

const listeners = new Set<() => void>()
/** Every change re-reads the registry first, so two tabs adding accounts at once don't drop each other's. */
function write(change: (r: Registry) => Registry) {
  const next = change(read())
  reg = next
  localStorage.setItem(KEY, JSON.stringify(next))
  listeners.forEach((l) => l())
}
// Another tab added, renamed or removed an account.
addEventListener('storage', (e) => { if (e.key === KEY) { reg = read(); listeners.forEach((l) => l()) } })

export const useAccounts = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => reg)
export const getAccounts = () => reg
/** The account open in this page. */
export const activeAccount = () => (ACTIVE ? reg.accounts.find((a) => a.id === ACTIVE.id) ?? ACTIVE : null)
export const activeId = () => ACTIVE?.id ?? 'default'
export const needsFirstRun = () => !ACTIVE

/** A storage name for the active account (or a given one): the default account keeps the old names. */
export const scoped = (name: string, id = activeId()) => (id === 'default' ? name : `${name}@${id}`)

const hueFor = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 17)

/** Reserves an id for an account being signed in to (its tokens are saved under it before it exists). The legacy
 *  "default" id only for the very first account on a device that never had one. */
export const reserveId = () => (read().legacyClaimed || read().accounts.length ? Math.random().toString(36).slice(2, 10) : 'default')

/** A library found in this browser's storage from before accounts, with nothing else to say what it was. */
export function adoptLegacyLibrary() {
  write((r) => (r.accounts.length ? r : { accounts: [{ id: 'default', kind: 'local', name: 'Personal', hue: 220, addedAt: Date.now() }], active: 'default', legacyClaimed: true }))
}

export function addAccount(a: Omit<Account, 'id' | 'hue' | 'addedAt'> & { id?: string }): Account {
  const same = a.remoteId ? read().accounts.find((x) => x.kind === a.kind && x.remoteId === a.remoteId) : undefined
  if (same) { updateAccount(same.id, { name: a.name, email: a.email, avatar: a.avatar }); return { ...same, ...a, id: same.id } }
  const acct: Account = { ...a, id: a.id ?? reserveId(), hue: hueFor(a.email ?? a.name + Date.now()), addedAt: Date.now() }
  write((r) => ({ ...r, accounts: [...r.accounts, acct], active: r.active ?? acct.id, legacyClaimed: r.legacyClaimed || acct.id === 'default' }))
  return acct
}
export const findSame = (kind: AccountKind, remoteId: string) => read().accounts.find((x) => x.kind === kind && x.remoteId === remoteId)

export function updateAccount(id: string, patch: Partial<Omit<Account, 'id' | 'kind'>>) {
  write((r) => ({ ...r, accounts: r.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }))
}

// ---------- switching ----------
type Barrier = { phase: 'commit' | 'drain'; run: () => unknown }
const barriers: Barrier[] = []
/** Work that must finish before this page leaves its account: `commit` steps run first (end text editing), then
 *  `drain` steps are awaited (writes reach storage); a drain step returning false stops the switch. */
export const onBeforeSwitch = (phase: Barrier['phase'], run: () => unknown) => { barriers.push({ phase, run }) }

/** Opens another account: saves everything here first, then this tab reloads into it (and fresh launches open it
 *  too). Returns false when something here couldn't be saved; the page stays put. */
export async function switchTo(id: string): Promise<boolean> {
  if (!read().accounts.some((a) => a.id === id)) return false
  for (const b of barriers) if (b.phase === 'commit') b.run()
  for (const b of barriers) if (b.phase === 'drain' && (await b.run()) === false) return false
  write((r) => ({ ...r, active: id }))
  try { sessionStorage.setItem(TAB, id) } catch { /* private mode */ }
  location.href = '/'
  return true
}

/** Forgets an account on this device (the caller wipes its storage first). */
export function forgetAccount(id: string): Account | null {
  write((r) => { const accounts = r.accounts.filter((a) => a.id !== id); return { ...r, accounts, active: r.active === id ? accounts[0]?.id ?? null : r.active } })
  try { if (sessionStorage.getItem(TAB) === id) sessionStorage.removeItem(TAB) } catch { /* private mode */ }
  return reg.accounts.find((a) => a.id === reg.active) ?? null
}

export const PROVIDER_NAME: Record<AccountKind, string> = { local: 'This device', dropbox: 'Dropbox', google: 'Google Drive', onedrive: 'OneDrive' }
/** The line under an account's name. */
export const accountSub = (a: Account) => a.email ?? (a.kind === 'local' ? 'On this device' : PROVIDER_NAME[a.kind])
