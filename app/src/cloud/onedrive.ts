// OneDrive (personal Microsoft accounts) through MSAL: PKCE with refresh tokens (about 24h for
// browser apps, then a sign-in). Files live in the app folder (Apps/Ream), via Microsoft Graph.
import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser'
import { CLOUD, redirectUri } from './config'
import { NeedsSignIn, ProviderFull, RemoteConflict, type CloudAccount, type CloudDrive, type RemoteFile } from './types'

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
const account = async (): Promise<AccountInfo | null> => (await client()).getAllAccounts()[0] ?? null

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

type Item = { name: string; eTag: string; lastModifiedDateTime: string; file?: unknown }
const toFile = (i: Item): RemoteFile => ({ name: i.name, rev: i.eTag, modified: Date.parse(i.lastModifiedDateTime) })
const enc = encodeURIComponent

export const onedrive: CloudDrive = {
  id: 'onedrive',
  prepare() { void client() },
  async signIn() {
    const p = await client()
    const r = await p.loginPopup({ scopes: SCOPES, prompt: 'select_account' })
    p.setActiveAccount(r.account)
    return this.account()
  },
  async reconnect() {
    const p = await client()
    const acct = await account()
    await p.acquireTokenPopup({ scopes: SCOPES, ...(acct ? { account: acct } : {}) })
  },
  async ready() { try { await token(); return true } catch { return false } },
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
  async signOut() {
    const p = await client()
    const acct = await account()
    if (acct) await p.clearCache({ account: acct })
  },
}
