// Cloud sync state (docs/design/specs/settings.md). UI phase: providers are simulated with realistic
// timings and behaviours (Google's ~hourly tokens, Dropbox's silent refresh). The engine phase replaces
// the simulated transport; the state model and every surface built on it stay.
import { useSyncExternalStore } from 'react'
import { toast } from './toasts'
import { DRIVES } from '../cloud'
import { loadKey, newKey, storeKey, unlockKey } from '../cloud/crypto'
import { NeedsSignIn, ProviderFull } from '../cloud/types'
import { decks, getLibrary, isLive } from './library'
import { ENTRIES, KEYFILE, pendingCount, readKeyFile, resetBase, rewriteAll, syncOnce, type SyncContext } from './syncEngine'

import type { ProviderId } from '../cloud/types'
export type { ProviderId }
export type Auth = 'none' | 'authorizing' | 'ok' | 'expired' | 'revoked' | 'reconnecting'
export type Issue = null | 'provider-full' | 'folder-deleted'

export const PROVIDERS: Record<ProviderId, { name: string; stays: string; folder: string; recommended?: boolean }> = {
  dropbox: { name: 'Dropbox', stays: 'Stays connected', folder: 'Apps/Ream', recommended: true },
  onedrive: { name: 'OneDrive', stays: 'Sign in about once a day', folder: 'Apps/Ream' },
  google: { name: 'Google Drive', stays: 'Reconnect about hourly when changes are waiting', folder: 'a hidden app folder' },
}

export type SyncState = {
  provider: ProviderId | null
  account: string | null
  accountName?: string
  avatar?: string
  lastError?: string
  deviceName: string
  auth: Auth
  online: boolean
  pending: number
  transfer: { label: string; done: number; total: number } | null
  conflicts: number
  issue: Issue
  lastSyncAt: number | null
  otherDevice: { name: string; at: number } | null
  encrypted: boolean
  locked: boolean
  visibleCopies: boolean
  dismissals: number
}

const KEY = 'ream.sync.v1'
const initial: SyncState = {
  provider: null, account: null, deviceName: guessDevice(), auth: 'none', online: navigator.onLine, pending: 0,
  transfer: null, conflicts: 0, issue: null, lastSyncAt: null, otherDevice: null, encrypted: false, locked: false,
  visibleCopies: false, dismissals: 0,
}

function guessDevice() {
  const ua = navigator.userAgent
  if (/iPhone/.test(ua)) return 'iPhone'
  if (/iPad/.test(ua)) return 'iPad'
  if (/Android/.test(ua)) return 'Android phone'
  if (/Mac/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows PC'
  return 'This computer'
}

const H = 3600_000
const SCENARIOS: Record<string, Partial<SyncState>> = {
  'google-paused': { provider: 'google', account: 'leo@example.com', auth: 'expired', pending: 3, lastSyncAt: Date.now() - 2 * 24 * H, otherDevice: { name: 'Laptop', at: Date.now() - 5 * H } },
  'google-stale': { provider: 'google', account: 'leo@example.com', auth: 'expired', pending: 0, lastSyncAt: Date.now() - 30 * H, otherDevice: { name: 'Laptop', at: Date.now() - 3 * H } },
  'google-quiet': { provider: 'google', account: 'leo@example.com', auth: 'expired', pending: 0, lastSyncAt: Date.now() - 2 * H, otherDevice: null },
  'dropbox-ok': { provider: 'dropbox', account: 'leo@example.com', auth: 'ok', lastSyncAt: Date.now() - 60_000 },
  'dropbox-offline': { provider: 'dropbox', account: 'leo@example.com', auth: 'ok', online: false, pending: 2, lastSyncAt: Date.now() - H },
  'conflict': { provider: 'dropbox', account: 'leo@example.com', auth: 'ok', conflicts: 2, lastSyncAt: Date.now() - 120_000 },
  'locked': { provider: 'dropbox', account: 'leo@example.com', auth: 'ok', encrypted: true, locked: true, lastSyncAt: Date.now() - 6 * H },
  'full': { provider: 'google', account: 'leo@example.com', auth: 'ok', issue: 'provider-full', pending: 4, lastSyncAt: Date.now() - 8 * H },
  'none': {},
}

function load(): SyncState {
  const scenario = new URLSearchParams(location.search).get('sync')
  if (scenario && scenario in SCENARIOS) return { ...initial, ...SCENARIOS[scenario] }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = { ...initial, ...JSON.parse(raw), transfer: null, online: navigator.onLine } as SyncState
      // Google gives browser apps ~1h tokens and no refresh token: an hour later, sign-in is needed again.
      if (s.provider === 'google' && s.auth === 'ok' && (s.lastSyncAt ?? 0) < Date.now() - H) s.auth = 'expired'
      if (s.auth === 'authorizing' || s.auth === 'reconnecting') s.auth = s.provider ? 'expired' : 'none'
      return s
    }
  } catch { /* fall through */ }
  return initial
}

let state = load()
const listeners = new Set<() => void>()
function set(next: Partial<SyncState>) {
  state = { ...state, ...next }
  try { if (!new URLSearchParams(location.search).has('sync')) localStorage.setItem(KEY, JSON.stringify(state)) } catch { /* ignore */ }
  listeners.forEach((l) => l())
  schedulePush()
}
export const useSync = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state)
export const getSync = () => state

addEventListener('online', () => set({ online: true }))
addEventListener('offline', () => set({ online: false }))

// ---------- derived ----------
export const needsSignIn = (s: SyncState) => s.provider !== null && (s.auth === 'expired' || s.auth === 'revoked')
export const canSync = (s: SyncState) => s.provider !== null && s.auth === 'ok' && s.online && !s.locked && !s.issue

let dismissedThisSession = false
/** First-load / in-flow prompt: only when something is actually at stake (review round 1, blocker 1). */
export function noticeReason(s: SyncState): null | { kind: 'waiting' | 'stale' | 'locked' | 'full' | 'deleted' } {
  if (!s.provider || !s.online || dismissedThisSession) return null
  if (s.locked) return { kind: 'locked' }
  if (s.issue === 'provider-full') return { kind: 'full' }
  if (s.issue === 'folder-deleted') return { kind: 'deleted' }
  if (!needsSignIn(s) || s.dismissals >= 2) return null
  if (s.pending > 0) return { kind: 'waiting' }
  const stale = !s.lastSyncAt || Date.now() - s.lastSyncAt > 12 * H
  if (stale && s.otherDevice && s.otherDevice.at > (s.lastSyncAt ?? 0)) return { kind: 'stale' }
  return null
}
export function dismissNotice() { dismissedThisSession = true; set({ dismissals: state.dismissals + 1 }) }

export type Summary = { tone: 'ok' | 'busy' | 'warn' | 'danger' | 'muted'; title: string; detail?: string; text: string; action?: 'reconnect' | 'review' | 'unlock' | 'open-provider' }
/** One wording for every status surface. Priority: locked > reconnect > error > conflict > offline > syncing > up to date. */
export function summary(s: SyncState, now = Date.now()): Summary {
  const make = (tone: Summary['tone'], title: string, detail?: string, action?: Summary['action']): Summary =>
    ({ tone, title, detail, action, text: detail ? `${title} · ${detail}` : title })
  if (!s.provider) return make('muted', 'Stored in this browser')
  const name = PROVIDERS[s.provider].name
  const waiting = s.pending ? `${s.pending} ${s.pending === 1 ? 'change' : 'changes'} waiting` : undefined
  if (s.locked) return make('warn', `${name} library is locked`, 'Enter your passphrase', 'unlock')
  if (s.auth === 'reconnecting') return make('busy', `Reconnecting ${name}…`)
  if (needsSignIn(s)) return make('warn', `${name} paused`, waiting ?? 'Sign in to sync', 'reconnect')
  if (s.issue === 'provider-full') return make('danger', `${name} is full`, waiting, 'open-provider')
  if (s.issue === 'folder-deleted') return make('danger', `Ream’s folder was deleted from ${name}`)
  if (s.conflicts) return make('warn', `${s.conflicts} ${s.conflicts === 1 ? 'conflict' : 'conflicts'}`, 'Choose which copies to keep', 'review')
  if (!s.online) return make('muted', 'Offline', waiting ?? 'Changes are saved here')
  if (s.transfer) return make('busy', s.transfer.label, `${Math.round((s.transfer.done / Math.max(1, s.transfer.total)) * 100)}%`)
  if (s.pending) return make('busy', `Syncing ${s.pending} ${s.pending === 1 ? 'change' : 'changes'}…`)
  return make('ok', `Synced with ${name}`, s.lastSyncAt ? relShort(now - s.lastSyncAt) : undefined)
}
function relShort(ms: number) {
  if (ms < 60_000) return 'just now'
  if (ms < H) return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 24 * H) return `${Math.floor(ms / H)}h ago`
  return `${Math.floor(ms / (24 * H))}d ago`
}

// ---------- local changes ----------
// ---------- device identity ----------
export function deviceId(): string {
  let id = localStorage.getItem('ream.device.id')
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('ream.device.id', id) }
  return id
}

// ---------- local changes ----------
let notifiedThisInterruption = false
export function noteLocalChange(_n = 1, quiet = false) {
  if (!state.provider) return
  set({ pending: pendingCount() })
  if (!quiet && needsSignIn(state) && state.online && !notifiedThisInterruption && !document.fullscreenElement) {
    notifiedThisInterruption = true
    toast({
      message: `${PROVIDERS[state.provider].name} sync is paused. Your changes are saved in this browser.`,
      duration: 10_000,
      action: { label: 'Reconnect', run: () => void reconnect() },
    })
  }
}

let pushTimer: number | undefined
function schedulePush() {
  clearTimeout(pushTimer)
  if (!canSync(state) || !state.pending || state.transfer) return
  pushTimer = window.setTimeout(() => void syncNow(), 3000)
}

// ---------- the real thing ----------
async function context(): Promise<SyncContext> {
  return { drive: DRIVES[state.provider!], device: deviceId(), deviceName: state.deviceName, key: state.encrypted ? await loadKey() : null }
}

let running: Promise<void> | null = null
/** Runs one sync and maps provider failures onto the status model. */
export function syncNow(): Promise<void> {
  if (!state.provider || state.locked || !state.online) return Promise.resolve()
  running ??= (async () => {
    try {
      const drive = DRIVES[state.provider!]
      if (!(await drive.ready())) { set({ auth: 'expired' }); return }
      const result = await syncOnce(await context(), (label, done, total) => set({ transfer: { label, done, total } }))
      set({ auth: 'ok', transfer: null, pending: pendingCount(), lastSyncAt: Date.now(), issue: null, lastError: undefined,
        conflicts: state.conflicts + result.conflicts, otherDevice: result.otherDevice })
      if (result.conflicts) toast({ message: `${result.conflicts} ${result.conflicts === 1 ? 'deck was' : 'decks were'} changed on two devices. Both versions are kept.` })
    } catch (e) {
      set({ transfer: null })
      if (e instanceof NeedsSignIn) set({ auth: 'expired' })
      else if (e instanceof ProviderFull) set({ issue: 'provider-full' })
      else if ((e as Error).name === 'Locked') set({ locked: true })
      else if (!navigator.onLine) set({ online: false })
      else { set({ lastError: (e as Error).message }); toast({ message: `Sync failed: ${(e as Error).message}`, tone: 'danger' }) }
    } finally {
      running = null
    }
  })()
  return running
}

addEventListener('focus', () => { if (canSync(state)) void syncNow() })
setInterval(() => { if (canSync(state) && document.visibilityState === 'visible') void syncNow() }, 3 * 60_000)
addEventListener('online', () => { if (canSync(state)) void syncNow() })

/** Sign in (call from a click). Returns what the connect flow should ask next. */
export async function connect(provider: ProviderId): Promise<'choose' | 'done' | 'cancelled' | 'locked'> {
  set({ auth: 'authorizing', provider, lastError: undefined })
  try {
    const acct = await DRIVES[provider].signIn()
    set({ auth: 'ok', account: acct.email, accountName: acct.name, avatar: acct.avatar, issue: null })
  } catch (e) {
    set({ provider: null, auth: 'none', account: null })
    if ((e as Error).name === 'SignInCancelled') return 'cancelled'
    throw e
  }
  const files = await DRIVES[provider].list()
  const remoteHasLibrary = files.some((f) => f.name === ENTRIES)
  const encrypted = files.some((f) => f.name === KEYFILE)
  resetBase()
  if (encrypted) { set({ encrypted: true, locked: true }); return 'locked' }
  const localDecks = decks(getLibrary()).filter(isLive).length
  if (remoteHasLibrary && localDecks) return 'choose'
  await finishConnect('merge')
  return 'done'
}

export async function finishConnect(choice: 'merge' | 'remote' | 'upload', _localDecks = 0) {
  notifiedThisInterruption = false
  if (choice === 'remote') {
    const { applyRemote } = await import('./library')
    applyRemote({ upserts: [], deletes: Object.keys(getLibrary().entries) })
  }
  set({ transfer: { label: 'Syncing your library', done: 0, total: 1 } })
  await syncNow()
  if (!state.lastError && state.provider) toast({ message: `${PROVIDERS[state.provider].name} is up to date`, tone: 'ok' })
}

export function cancelConnect() {
  set({ provider: null, account: null, auth: 'none', transfer: null })
}

/** A user gesture: Google needs one to hand out a new token. */
export async function reconnect() {
  if (!state.provider || state.auth === 'reconnecting') return
  set({ auth: 'reconnecting' })
  try {
    await DRIVES[state.provider].reconnect()
    set({ auth: 'ok' })
    notifiedThisInterruption = false
    await syncNow()
    if (!state.lastError) toast({ message: `${PROVIDERS[state.provider].name} is up to date`, tone: 'ok' })
  } catch (e) {
    set({ auth: 'expired' })
    if ((e as Error).name === 'PopupBlocked') toast({ message: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' })
  }
}

export async function disconnect() {
  const p = state.provider
  if (p) await DRIVES[p].signOut().catch(() => {})
  await storeKey(null)
  resetBase()
  set({ ...initial, deviceName: state.deviceName, online: state.online })
  if (p) toast({ message: `Disconnected ${PROVIDERS[p].name}. Your library stays in this browser.` })
}

export async function unlock(passphrase: string): Promise<boolean> {
  const file = await readKeyFile(DRIVES[state.provider!])
  if (!file) { set({ locked: false, encrypted: false }); return true }
  const key = await unlockKey(passphrase, file)
  if (!key) return false
  await storeKey(key)
  set({ locked: false, encrypted: true })
  await syncNow()
  return true
}

/** Turning encryption on re-uploads everything sealed with a key from the passphrase; off re-uploads it readable. */
export async function setEncryption(on: boolean, passphrase?: string) {
  const ctx = await context()
  const from = state.encrypted ? await loadKey() : null
  if (on) {
    const { key, file } = await newKey(passphrase!)
    await rewriteAll({ ...ctx, key }, from, (done, total) => set({ transfer: { label: 'Encrypting your library', done, total } }))
    await ctx.drive.put(KEYFILE, JSON.stringify(file))
    await storeKey(key)
  } else {
    await rewriteAll({ ...ctx, key: null }, from, (done, total) => set({ transfer: { label: 'Removing encryption', done, total } }))
    await ctx.drive.remove(KEYFILE)
    await storeKey(null)
  }
  set({ encrypted: on, transfer: null })
}

export const setDeviceName = (deviceName: string) => set({ deviceName })
export const setVisibleCopies = (visibleCopies: boolean) => set({ visibleCopies })
export const resolveConflicts = () => set({ conflicts: 0 })

// First check on load: is the linked provider still usable without asking?
if (state.provider && !new URLSearchParams(location.search).has('sync')) {
  DRIVES[state.provider].prepare()
  void DRIVES[state.provider].ready().then((ok) => {
    set({ auth: ok ? 'ok' : 'expired', pending: pendingCount() })
    if (ok) void syncNow()
  })
}
