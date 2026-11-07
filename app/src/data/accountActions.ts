// What you can do with accounts (spec: accounts): add one (a provider sign-in or a new local library), sign back
// in, check whether a session still works, remove one from this device. Switching itself reloads (accounts.ts).
import { driveFor, reauthenticate } from '../cloud'
import { cameoAvatar } from '../lib/avatar'
import { storage, wipeAccount } from '../storage/client'
import { activeId, addAccount, findSame, forgetAccount, getAccounts, reserveId, switchTo, updateAccount, type Account, type AccountKind } from './accounts'
import { forgetProvider, markSignedOut } from './sync'

/** Everything kept in localStorage per account (the default account's are unsuffixed). */
const SCOPED_KEYS = ['ream.sync.v1', 'ream.sync.base', 'ream.cloud.dropbox', 'ream.cloud.google', 'ream.cloud.onedrive']
const keyFor = (base: string, id: string) => (id === 'default' ? base : `${base}@${id}`)

function moveKeys(from: string, to: string) {
  for (const base of SCOPED_KEYS) {
    const v = localStorage.getItem(keyFor(base, from))
    if (v === null) continue
    localStorage.setItem(keyFor(base, to), v)
    localStorage.removeItem(keyFor(base, from))
  }
}

export type AddResult = { account: Account; existed: boolean }

/** Sign in to a provider and add that account (or find it, if it's already here). Call inside a click: it opens
 *  the provider's window before awaiting anything. */
export async function addCloudAccount(kind: Exclude<AccountKind, 'local'>, cancelled: () => boolean = () => false): Promise<AddResult | null> {
  const id = reserveId()
  const another = getAccounts().accounts.some((a) => a.kind === kind)
  const who = await driveFor({ id, kind }).signIn({ another })
  // Cancelled while the window was open: a late sign-in adds nothing and leaves no credentials behind.
  if (cancelled()) { for (const base of SCOPED_KEYS) if (id !== 'default') localStorage.removeItem(keyFor(base, id)); return null }
  const same = findSame(kind, who.id)
  if (same) {
    // Signed in again as someone already added: their fresh tokens belong to that account.
    if (same.id !== id) moveKeys(id, same.id)
    updateAccount(same.id, { name: who.name, email: who.email, avatar: who.avatar })
    return { account: same, existed: true }
  }
  return { account: addAccount({ id, kind, name: who.name || who.email, email: who.email, avatar: who.avatar, remoteId: who.id }), existed: false }
}

export function addLocalAccount(name: string, seed: string): Account {
  return addAccount({ kind: 'local', name: name.trim() || 'Personal', avatarSeed: seed, avatar: cameoAvatar(seed) })
}

export type Health = 'ok' | 'signin' | 'local' | 'offline'
/** Whether an account can be used without asking the person (silent refresh where the provider allows it). */
export async function accountHealth(a: Account): Promise<Health> {
  if (a.kind === 'local') return 'local'
  if (!navigator.onLine) return 'offline'
  try { return (await driveFor(a).ready()) ? 'ok' : 'signin' } catch { return 'signin' }
}

export class WrongAccount extends Error {
  got: string; want: string
  constructor(got: string, want: string) { super(`That was ${got}. Sign in as ${want}, or add ${got} as another account.`); this.name = 'WrongAccount'; this.got = got; this.want = want }
}
/** Sign back in to an account (call inside a click). Refuses a different person's sign-in so libraries never mix. */
export async function signInAgain(a: Account): Promise<void> {
  const r = await reauthenticate(a)
  if (!r.ok) throw new WrongAccount(r.who.email, a.email ?? a.name)
  updateAccount(a.id, { remoteId: a.remoteId ?? r.who.id, name: r.who.name || a.name, email: r.who.email, avatar: r.who.avatar ?? a.avatar })
}

/** Removes an account from this device: its local library, tokens and keys. Files in the provider stay. */
export async function removeAccount(a: Account): Promise<boolean> {
  if (a.id === activeId()) {
    await forgetProvider()
    await storage.wipe()
  } else {
    if (a.kind !== 'local') await driveFor(a).forget().catch(() => {})
    if (!(await wipeAccount(a.id))) return false
  }
  for (const base of SCOPED_KEYS) localStorage.removeItem(keyFor(base, a.id))
  indexedDB.deleteDatabase(keyFor('ream-versions', a.id))
  const next = forgetAccount(a.id)
  if (a.id === activeId()) { if (next) switchTo(next.id); else location.href = '/' }
  return true
}

/** Signs out of a cloud account but keeps it in the switcher (signed out): its device copy stays until unlinked. */
export async function signOutAccount(a: Account) {
  if (a.kind === 'local') return
  if (a.id === activeId()) { await forgetProvider(); markSignedOut() }
  else await driveFor(a).forget().catch(() => {})
}
