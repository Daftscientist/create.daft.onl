// Dropbox: PKCE with offline access, so the refresh token keeps it connected without the user.
// Files live in Apps/Ream (an App folder: Ream can't see anything else in the account).
import { CLOUD, redirectUri } from './config'
import { openPopup, pkce, popupForCode, randomState } from './oauth'
import { scoped } from '../data/accounts'
import { CursorReset, NeedsSignIn, ProviderFull, RemoteConflict, type CloudAccount, type CloudDrive, type RemoteFile } from './types'

type Tokens = { access: string; refresh: string; expiresAt: number }

/** One Dropbox account's drive (its tokens are kept under the Ream account's id). */
export function dropboxDrive(accountId: string): CloudDrive {
  const KEY = scoped('ream.cloud.dropbox', accountId)
  const load = (): Tokens | null => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } }
  const save = (t: Tokens | null) => { if (t) localStorage.setItem(KEY, JSON.stringify(t)); else localStorage.removeItem(KEY) }

  async function tokenRequest(body: Record<string, string>, keepRefresh = ''): Promise<Tokens> {
    const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLOUD.dropbox.appKey, ...body }),
    })
    // A rejected grant means signing in again; anything else (throttling, an outage) is temporary.
    if (res.status === 400 || res.status === 401) throw new NeedsSignIn('dropbox')
    if (!res.ok) throw new Error(`Dropbox is unavailable (${res.status})`)
    const j = await res.json()
    // Only a refresh keeps the existing refresh token; a new sign-in never borrows another grant's.
    return { access: j.access_token, refresh: j.refresh_token ?? keepRefresh, expiresAt: Date.now() + (j.expires_in - 60) * 1000 }
  }

  async function token(): Promise<string> {
    let t = load()
    if (!t) throw new NeedsSignIn('dropbox')
    if (Date.now() > t.expiresAt) {
      t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }, t.refresh)
      save(t)
    }
    return t.access
  }

  async function rpc<T>(path: string, args?: unknown): Promise<T> {
    const res = await fetch(`https://api.dropboxapi.com/2/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${await token()}`, ...(args === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: args === undefined ? undefined : JSON.stringify(args),
    })
    if (res.status === 401) throw new NeedsSignIn('dropbox')
    if (!res.ok) throw Object.assign(new Error(await res.text()), { status: res.status })
    return res.json() as Promise<T>
  }

  type Meta = { '.tag': string; name: string; rev: string; server_modified: string }
  const toFile = (m: Meta): RemoteFile => ({ name: m.name, rev: m.rev, modified: Date.parse(m.server_modified) })

  return {
    id: 'dropbox',
    prepare() {},
    async signIn(opts) {
      const win = openPopup() // first, synchronously: keeps the click's user gesture
      const { verifier, challenge } = await pkce()
      const state = randomState()
      const url = 'https://www.dropbox.com/oauth2/authorize?' + new URLSearchParams({
        client_id: CLOUD.dropbox.appKey, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
        token_access_type: 'offline', redirect_uri: redirectUri(), state,
        // Adding another account, or signing back in: let the person pick which Dropbox account.
        ...(opts?.another ? { force_reauthentication: 'true' } : {}),
      })
      const code = await popupForCode(win, url, state)
      save(await tokenRequest({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri() }))
      return this.account()
    },
    async reconnect() { await this.signIn() },
    async ready() { try { await token(); return true } catch (e) { return !(e instanceof NeedsSignIn) } },
    async account(): Promise<CloudAccount> {
      const a = await rpc<{ account_id: string; email: string; name: { display_name: string }; profile_photo_url?: string }>('users/get_current_account')
      return { id: a.account_id, email: a.email, name: a.name.display_name, avatar: a.profile_photo_url }
    },
    async list() {
      const out: RemoteFile[] = []
      let page = await rpc<{ entries: Meta[]; cursor: string; has_more: boolean }>('files/list_folder', { path: '' })
      for (;;) {
        out.push(...page.entries.filter((e) => e['.tag'] === 'file').map(toFile))
        if (!page.has_more) return out
        page = await rpc('files/list_folder/continue', { cursor: page.cursor })
      }
    },
    async changes(cursor) {
      const changed: RemoteFile[] = [], removed: string[] = []
      type Page = { entries: Meta[]; cursor: string; has_more: boolean }
      let page: Page
      try { page = cursor ? await rpc<Page>('files/list_folder/continue', { cursor }) : await rpc<Page>('files/list_folder', { path: '', include_deleted: false }) }
      catch (e) { if (cursor && (e as { status?: number }).status === 409) throw new CursorReset(); throw e }
      for (;;) {
        for (const e of page.entries) { if (e['.tag'] === 'file') changed.push(toFile(e)); else if (e['.tag'] === 'deleted') removed.push(e.name) }
        if (!page.has_more) return { changed, removed, cursor: page.cursor, full: !cursor }
        page = await rpc<Page>('files/list_folder/continue', { cursor: page.cursor })
      }
    },
    async quota() {
      try { const q = await rpc<{ used: number; allocation: { allocated?: number } }>('users/get_space_usage'); return q.allocation.allocated ? { used: q.used, total: q.allocation.allocated } : null } catch { return null }
    },
    async get(name) {
      const res = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Dropbox-API-Arg': JSON.stringify({ path: `/${name}` }) },
      })
      if (res.status === 409) return null
      if (res.status === 401) throw new NeedsSignIn('dropbox')
      if (!res.ok) throw new Error(`Dropbox download failed (${res.status})`)
      const meta = JSON.parse(res.headers.get('Dropbox-API-Result') ?? '{}') as Meta
      return { text: await res.text(), rev: meta.rev }
    },
    async put(name, body, ifRev) {
      const mode = ifRev ? { '.tag': 'update', update: ifRev } : ifRev === null ? { '.tag': 'add' } : { '.tag': 'overwrite' }
      const res = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await token()}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify({ path: `/${name}`, mode, mute: true, autorename: false }),
        },
        body,
      })
      if (res.status === 401) throw new NeedsSignIn('dropbox')
      if (res.status === 409) {
        const err = await res.text()
        if (err.includes('insufficient_space')) throw new ProviderFull()
        throw new RemoteConflict(name)
      }
      if (!res.ok) throw new Error(`Dropbox upload failed (${res.status})`)
      return toFile(await res.json())
    },
    async remove(name) {
      await rpc('files/delete_v2', { path: `/${name}` }).catch((e: { status?: number }) => { if (e.status !== 409) throw e })
    },
    async forget() { save(null) },
    async signOut() {
      await rpc('auth/token/revoke').catch(() => {})
      save(null)
    },
  }
}
