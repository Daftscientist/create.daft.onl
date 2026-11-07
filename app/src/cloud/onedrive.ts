// OneDrive (personal Microsoft accounts) through MSAL: PKCE with refresh tokens (about 24h for
// browser apps, then a sign-in). Files live in the app folder (Apps/Ream), via Microsoft Graph.
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser'
import { CLOUD, redirectUri } from './config'
import { scoped } from '../data/accounts'
import { CursorReset, NeedsSignIn, ProviderFull, RemoteConflict, type CloudAccount, type CloudDrive, type RemoteFile } from './types'

const SCOPES = ['Files.ReadWrite.AppFolder', 'User.Read', 'offline_access']
let pca: Promise<PublicClientApplication> | null = null
function client() {
  pca ??= (async () => {
    const p = new PublicClientApplication({
      auth: { clientId: CLOUD.onedrive.clientId, authority: 'https://login.microsoftonline.com/consumers', redirectUri: redirectUri() },
      cache: { cacheLocation: 'localStorage' },
    })
    await p.initialize()
    return p
  })()
  return pca
}
/** One Microsoft account's drive. MSAL keeps every signed-in account in one cache; each Ream account remembers which
 *  is its own (by home account id). */
export function onedriveDrive(accountId: string): CloudDrive {
const HOME = scoped('ream.cloud.onedrive', accountId)
const account = async (): Promise<AccountInfo | null> => {
  const all = (await client()).getAllAccounts(), home = localStorage.getItem(HOME)
  if (home) return all.find((a) => a.homeAccountId === home) ?? null
  // A library linked before accounts: the account MSAL marked active when it signed in (never just the first one).
  const legacy = accountId === 'default' ? (await client()).getActiveAccount() : null
  if (legacy) localStorage.setItem(HOME, legacy.homeAccountId)
  return legacy
}

async function token(): Promise<string> {
  const p = await client()
  const acct = await account()
  if (!acct) throw new NeedsSignIn('onedrive')
  try {
    return (await p.acquireTokenSilent({ account: acct, scopes: SCOPES })).accessToken
  } catch (e) {
    if (e instanceof InteractionRequiredAuthError) throw new NeedsSignIn('onedrive')
    throw e
  }
}

const GRAPH = 'https://graph.microsoft.com/v1.0'
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${GRAPH}${path}`, { ...init, headers: { Authorization: `Bearer ${await token()}`, ...(init.headers ?? {}) } })
  if (res.status === 401) throw new NeedsSignIn('onedrive')
  if (res.status === 507) throw new ProviderFull()
  return res
}

type Item = { name: string; eTag: string; lastModifiedDateTime: string; file?: unknown; deleted?: unknown }
const toFile = (i: Item): RemoteFile => ({ name: i.name, rev: i.eTag, modified: Date.parse(i.lastModifiedDateTime) })
const enc = encodeURIComponent

return {
  id: 'onedrive',
  prepare() { void client() },
  async signIn() {
    const p = await client()
    const r = await p.loginPopup({ scopes: SCOPES, prompt: 'select_account' })
    localStorage.setItem(HOME, r.account.homeAccountId)
    return this.account()
  },
  async reconnect() {
    const p = await client()
    const acct = await account()
    const r = await p.acquireTokenPopup({ scopes: SCOPES, ...(acct ? { account: acct, loginHint: acct.username } : { prompt: 'select_account' }) })
    if (!acct) localStorage.setItem(HOME, r.account.homeAccountId)
  },
  async ready() { try { await token(); return true } catch (e) { return !(e instanceof NeedsSignIn) } },
  async account(): Promise<CloudAccount> {
    const me = await (await api('/me?$select=id,displayName,mail,userPrincipalName')).json()
    let avatar: string | undefined
    try {
      const photo = await api('/me/photos/96x96/$value')
      if (photo.ok) {
        const blob = await photo.blob()
        avatar = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result as string); fr.readAsDataURL(blob) })
      }
    } catch { /* no photo */ }
    return { id: me.id, email: me.mail ?? me.userPrincipalName, name: me.displayName, avatar }
  },
  async list() {
    const out: Item[] = []
    let url: string | null = '/me/drive/special/approot/children?$select=name,eTag,lastModifiedDateTime,file&$top=999'
    while (url) {
      const j: { value: Item[]; '@odata.nextLink'?: string } = await (await api(url)).json()
      out.push(...j.value.filter((i) => i.file))
      url = j['@odata.nextLink'] ? j['@odata.nextLink'].replace(GRAPH, '') : null
    }
    return out.map(toFile)
  },
  async changes(cursor) {
    const changed: RemoteFile[] = [], removed: string[] = []
    let url: string = cursor ?? '/me/drive/special/approot/delta?$select=name,eTag,lastModifiedDateTime,file,deleted'
    for (;;) {
      const res = await api(url.replace(GRAPH, ''))
      if (res.status === 410) throw new CursorReset()
      if (!res.ok) throw new Error(`OneDrive changes failed (${res.status})`)
      const j: { value: Item[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } = await res.json()
      for (const i of j.value) { if (i.deleted) { if (i.name) removed.push(i.name) } else if (i.file) changed.push(toFile(i)) }
      if (j['@odata.deltaLink']) return { changed, removed, cursor: j['@odata.deltaLink'], full: !cursor }
      url = j['@odata.nextLink']!
    }
  },
  async quota() {
    try {
      const res = await api('/me/drive?$select=quota')
      if (!res.ok) return null
      const q = (await res.json()).quota as { used?: number; total?: number }
      return q?.total ? { used: q.used ?? 0, total: q.total } : null
    } catch { return null }
  },
  async get(name) {
    const meta = await api(`/me/drive/special/approot:/${enc(name)}?$select=eTag`)
    if (meta.status === 404) return null
    const { eTag } = await meta.json()
    const res = await api(`/me/drive/special/approot:/${enc(name)}:/content`)
    if (!res.ok) return null
    return { text: await res.text(), rev: eTag }
  },
  async put(name, body, ifRev) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ifRev) headers['If-Match'] = ifRev
    if (ifRev === null) headers['If-None-Match'] = '*'
    const res = await api(`/me/drive/special/approot:/${enc(name)}:/content`, { method: 'PUT', headers, body })
    if (res.status === 412) throw new RemoteConflict(name)
    if (!res.ok) throw new Error(`OneDrive upload failed (${res.status})`)
    return toFile(await res.json())
  },
  async remove(name) {
    const res = await api(`/me/drive/special/approot:/${enc(name)}`, { method: 'DELETE' })
    if (!res.ok && res.status !== 404) throw new Error(`OneDrive delete failed (${res.status})`)
  },
  async forget() {
    const p = await client()
    const acct = await account()
    if (acct) await p.clearCache({ account: acct })
    localStorage.removeItem(HOME)
  },
  async signOut() {
    const p = await client()
    const acct = await account()
    if (acct) await p.clearCache({ account: acct })
    localStorage.removeItem(HOME)
  },
}
}
