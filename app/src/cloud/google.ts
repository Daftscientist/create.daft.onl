// Google Drive: Google Identity Services' token model. Browser-only apps get ~1h access tokens and
// no refresh token, so after an hour Ream asks for a one-click reconnect (a user gesture is required).
// Library files live in the hidden appDataFolder; openid/profile give the account email and avatar.
import { CLOUD } from './config'
import { scoped } from '../data/accounts'
import { NeedsSignIn, ProviderFull, RemoteConflict, type CloudAccount, type CloudDrive, type RemoteFile } from './types'

const SCOPES = 'openid email profile https://www.googleapis.com/auth/drive.appdata'
type Tokens = { access: string; expiresAt: number }

type TokenResponse = { access_token?: string; expires_in?: number; error?: string }
type TokenClient = { requestAccessToken: (o?: { prompt?: string }) => void }
declare global {
  interface Window {
    google?: { accounts: { oauth2: {
      initTokenClient: (o: { client_id: string; scope: string; prompt?: string; login_hint?: string; callback: (r: TokenResponse) => void; error_callback?: (e: { type: string }) => void }) => TokenClient
      revoke: (token: string, done: () => void) => void
    } } }
  }
}

let gis: Promise<void> | null = null
function loadGis() {
  gis ??= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = () => resolve()
    s.onerror = () => { gis = null; reject(new Error('Couldn’t reach Google. Check your connection.')) }
    document.head.appendChild(s)
  })
  return gis
}
// Preload so the click handler can open the window synchronously (popup blockers need the gesture).
if (Object.keys(localStorage).some((k) => k.startsWith('ream.cloud.google'))) void loadGis().catch(() => {})

/** One Google account's drive. Tokens are kept under the Ream account's id; signing back in hints that account's
 *  email so Google doesn't offer a different one. */
export function googleDrive(accountId: string, hint?: () => string | undefined): CloudDrive {
const KEY = scoped('ream.cloud.google', accountId)
const load = (): Tokens | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }
const save = (t: Tokens | null) => { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY) }

function requestToken(prompt: string): Promise<Tokens> {
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLOUD.google.clientId,
      scope: SCOPES,
      ...(hint?.() ? { login_hint: hint() } : {}),
      callback: (r) => {
        if (!r.access_token) return reject(new Error(r.error ?? 'Google sign-in failed'))
        const t = { access: r.access_token, expiresAt: Date.now() + ((r.expires_in ?? 3600) - 60) * 1000 }
        save(t)
        resolve(t)
      },
      error_callback: (e) => reject(Object.assign(new Error(e.type === 'popup_closed' ? 'Sign-in was cancelled' : 'Your browser blocked the sign-in window'), { name: e.type === 'popup_closed' ? 'SignInCancelled' : 'PopupBlocked' })),
    })
    client.requestAccessToken({ prompt })
  })
}

function token(): string {
  const t = load()
  if (!t || Date.now() > t.expiresAt) throw new NeedsSignIn('google')
  return t.access
}

async function api(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token()}`, ...(init.headers ?? {}) } })
  if (res.status === 401) { save(null); throw new NeedsSignIn('google') }
  if (res.status === 403 && (await res.clone().text()).includes('storageQuotaExceeded')) throw new ProviderFull()
  return res
}

let ids = new Map<string, string>()
type GFile = { id: string; name: string; version: string; modifiedTime: string }
const toFile = (f: GFile): RemoteFile => ({ name: f.name, rev: f.version, modified: Date.parse(f.modifiedTime) })

return {
  id: 'google',
  prepare() { void loadGis().catch(() => {}) },
  async signIn(opts) {
    await loadGis()
    await requestToken(opts?.another ? 'select_account consent' : 'consent')
    return this.account()
  },
  async reconnect() {
    await loadGis()
    await requestToken('')
  },
  async ready() { try { token(); return true } catch { return false } },
  async account(): Promise<CloudAccount> {
    const u = await (await api('https://www.googleapis.com/oauth2/v3/userinfo')).json()
    return { id: u.sub, email: u.email, name: u.name ?? u.email, avatar: u.picture }
  },
  async list() {
    const out: GFile[] = []
    let pageToken = ''
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,version,modifiedTime)', pageSize: '1000', ...(pageToken ? { pageToken } : {}) })
      const j = await (await api(`https://www.googleapis.com/drive/v3/files?${q}`)).json()
      out.push(...j.files)
      pageToken = j.nextPageToken ?? ''
    } while (pageToken)
    ids = new Map(out.map((f) => [f.name, f.id]))
    return out.map(toFile)
  },
  async get(name) {
    if (!ids.has(name)) await this.list()
    const id = ids.get(name)
    if (!id) return null
    const meta: GFile = await (await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,version,modifiedTime`)).json()
    const res = await api(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
    if (res.status === 404) return null
    return { text: await res.text(), rev: meta.version }
  },
  async put(name, body, ifRev) {
    if (!ids.has(name)) await this.list()
    const id = ids.get(name)
    if (id && ifRev) {
      // Drive has no conditional write on media uploads: check the version first (best effort).
      const meta: GFile = await (await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=version`)).json()
      if (meta.version !== ifRev) throw new RemoteConflict(name)
    }
    if (id && ifRev === null) throw new RemoteConflict(name)
    let res: Response
    if (id) {
      res = await api(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media&fields=id,name,version,modifiedTime`, { method: 'PATCH', body })
    } else {
      const boundary = `ream${crypto.randomUUID()}`
      const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`
      res = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,version,modifiedTime', {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart,
      })
    }
    if (!res.ok) throw new Error(`Google Drive upload failed (${res.status})`)
    const f: GFile = await res.json()
    ids.set(f.name, f.id)
    return toFile(f)
  },
  async remove(name) {
    if (!ids.has(name)) await this.list()
    const id = ids.get(name)
    if (id) { await api(`https://www.googleapis.com/drive/v3/files/${id}`, { method: 'DELETE' }); ids.delete(name) }
  },
  async forget() { save(null) },
  async signOut() {
    const t = load()
    if (t && window.google) await new Promise<void>((r) => window.google!.accounts.oauth2.revoke(t.access, r))
    save(null)
  },
}
}
