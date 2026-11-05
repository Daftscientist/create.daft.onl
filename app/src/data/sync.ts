// Cloud sync state (docs/design/specs/settings.md). UI phase: providers are simulated with realistic
// timings and behaviours (Google's ~hourly tokens, Dropbox's silent refresh). The engine phase replaces
// the simulated transport; the state model and every surface built on it stay.
import { useSyncExternalStore } from 'react'
import { toast } from './toasts'

export type ProviderId = 'dropbox' | 'google' | 'onedrive'
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
let notifiedThisInterruption = false
export function noteLocalChange(n = 1, quiet = false) {
  if (!state.provider) return
  set({ pending: state.pending + n })
  if (!quiet && needsSignIn(state) && state.online && !notifiedThisInterruption && !document.fullscreenElement) {
    notifiedThisInterruption = true
    toast({
      message: `${PROVIDERS[state.provider].name} sync is paused. Your changes are saved in this browser.`,
      duration: 10_000,
      action: { label: 'Reconnect', run: reconnect },
    })
  }
}

let pushTimer: number | undefined
function schedulePush() {
  clearTimeout(pushTimer)
  if (!canSync(state) || !state.pending || state.transfer) return
  pushTimer = window.setTimeout(() => {
    if (canSync(state) && state.pending) set({ pending: 0, lastSyncAt: Date.now() })
  }, 2500)
}

// ---------- actions (simulated transport) ----------
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runTransfer(label: string, total: number) {
  for (let done = 0; done <= total; done += Math.max(1, Math.ceil(total / 8))) {
    set({ transfer: { label, done, total } })
    await wait(260)
  }
  set({ transfer: null, pending: 0, lastSyncAt: Date.now() })
}

/** Starts sign-in. Returns 'choose' when this device already has a library and the remote has one too. */
export async function connect(provider: ProviderId): Promise<'choose' | 'done' | 'cancelled'> {
  set({ auth: 'authorizing', provider })
  await wait(1100)
  set({ auth: 'ok', account: 'leo@example.com', issue: null, otherDevice: { name: 'Laptop', at: Date.now() - 6 * H } })
  return 'choose'
}

export async function finishConnect(choice: 'merge' | 'remote' | 'upload', localDecks: number) {
  notifiedThisInterruption = false
  if (choice === 'upload') await runTransfer(`Uploading ${localDecks} decks`, localDecks)
  else await runTransfer(choice === 'merge' ? 'Merging libraries' : 'Bringing in your library', localDecks + 6)
  toast({ message: `${PROVIDERS[state.provider!].name} is up to date`, tone: 'ok' })
}

export function cancelConnect() {
  set({ provider: null, account: null, auth: 'none', transfer: null })
}

export async function reconnect() {
  if (!state.provider || state.auth === 'reconnecting') return
  set({ auth: 'reconnecting' })
  await wait(1200)
  set({ auth: 'ok' })
  notifiedThisInterruption = false
  if (state.pending || (state.otherDevice && state.otherDevice.at > (state.lastSyncAt ?? 0))) {
    await runTransfer('Catching up', Math.max(3, state.pending))
  } else set({ lastSyncAt: Date.now() })
  toast({ message: `${PROVIDERS[state.provider].name} is up to date`, tone: 'ok' })
}

export function disconnect() {
  const name = state.provider ? PROVIDERS[state.provider].name : ''
  set({ ...initial, deviceName: state.deviceName, online: state.online })
  toast({ message: `Disconnected ${name}. Your library stays in this browser.` })
}

export async function syncNow() {
  if (!canSync(state)) return
  await runTransfer('Checking for changes', 4)
}

export async function unlock(passphrase: string): Promise<boolean> {
  await wait(700)
  if (passphrase.length < 4) return false
  set({ locked: false })
  await runTransfer('Decrypting library', 12)
  return true
}

export async function setEncryption(on: boolean) {
  set({ encrypted: on })
  await runTransfer(on ? 'Encrypting library' : 'Removing encryption', 20)
}

export const setDeviceName = (deviceName: string) => set({ deviceName })
export const setVisibleCopies = (visibleCopies: boolean) => set({ visibleCopies })
export const resolveConflicts = () => set({ conflicts: 0 })
