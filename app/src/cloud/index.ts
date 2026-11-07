import type { Account } from '../data/accounts'
import { dropboxDrive } from './dropbox'
import { fakeDrive } from './fake'
import { googleDrive } from './google'
import { onedriveDrive } from './onedrive'
import { scoped } from '../data/accounts'
import type { CloudAccount, CloudDrive } from './types'

const made = new Map<string, CloudDrive>()
/** The drive behind a cloud account (one instance per account). */
export function driveFor(a: Pick<Account, 'id' | 'kind'> & { email?: string }): CloudDrive {
  const k = `${a.kind}:${a.id}`
  let d = made.get(k)
  if (!d) {
    const fake = import.meta.env.DEV ? localStorage.getItem('ream.fakecloud') : null
    if (fake) d = fakeDrive(fake)
    else if (a.kind === 'dropbox') d = dropboxDrive(a.id)
    else if (a.kind === 'google') d = googleDrive(a.id, () => a.email)
    else if (a.kind === 'onedrive') d = onedriveDrive(a.id)
    else throw new Error('A local account has no cloud drive.')
    made.set(k, d)
  }
  return d
}

const TOKEN_KEYS = ['ream.cloud.dropbox', 'ream.cloud.google', 'ream.cloud.onedrive']
const snapshot = (id: string) => TOKEN_KEYS.map((b) => [scoped(b, id), localStorage.getItem(scoped(b, id))] as const)
const restore = (snap: ReturnType<typeof snapshot>) => { for (const [k, v] of snap) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v) } }

/** Signs an existing account back in and checks it's the same person before keeping the new credentials. A
 *  different person's sign-in is undone (the account's previous credentials come back) and returned, so one person's
 *  library can never sync into someone else's storage. Call inside a click. */
export async function reauthenticate(a: Pick<Account, 'id' | 'kind' | 'remoteId'> & { email?: string }): Promise<{ ok: true; who: CloudAccount } | { ok: false; who: CloudAccount }> {
  const snap = snapshot(a.id)
  const drive = driveFor(a)
  try { await drive.reconnect() } catch (e) { restore(snap); throw e }
  let who: CloudAccount
  try { who = await drive.account() } catch (e) { restore(snap); throw e }
  if (a.remoteId && who.id !== a.remoteId) { restore(snap); return { ok: false, who } }
  return { ok: true, who }
}
export type { CloudAccount, CloudDrive, ProviderId } from './types'
