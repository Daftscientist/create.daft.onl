// OAuth helpers: PKCE, a sign-in popup, and the /auth/callback page's hand-off back to the app.
import { redirectUri } from './config'

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))
  return { verifier, challenge }
}

export const randomState = () => b64url(crypto.getRandomValues(new Uint8Array(16)))

export class PopupBlocked extends Error {
  constructor() { super('Your browser blocked the sign-in window'); this.name = 'PopupBlocked' }
}
export class SignInCancelled extends Error {
  constructor() { super('Sign-in was cancelled'); this.name = 'SignInCancelled' }
}

/** Opens a blank, centred sign-in window. Call it synchronously inside the click handler, before any
 *  await, or the browser treats it as an unrequested popup and blocks it. */
export function openPopup(): Window {
  const w = 520, h = 680
  const left = Math.max(0, screenX + (outerWidth - w) / 2), top = Math.max(0, screenY + (outerHeight - h) / 2)
  // A name per attempt: a second sign-in never takes over the first one's window.
  const win = open('about:blank', `ream-signin-${Math.random().toString(36).slice(2, 8)}`, `popup,width=${w},height=${h},left=${left},top=${top}`)
  if (!win) throw new PopupBlocked()
  return win
}

/** Points an already-open popup at `url` and resolves with the code the callback page posts back. */
export function popupForCode(win: Window, url: string, state: string): Promise<string> {
  win.location.href = url
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.source !== 'ream-auth' || e.data.state !== state) return
      cleanup()
      if (e.data.error) reject(e.data.error === 'access_denied' ? new SignInCancelled() : new Error(e.data.error))
      else resolve(e.data.code as string)
    }
    // A provider page with Cross-Origin-Opener-Policy makes the window look closed at once while it's still open.
    // Closed within the first second means that: stop watching and wait for the callback (up to 10 minutes).
    // Closed later means the person closed it.
    const started = Date.now()
    const timer = setInterval(() => {
      if (!win.closed) return
      clearInterval(timer)
      if (Date.now() - started > 1200) { cleanup(); reject(new SignInCancelled()) }
    }, 400)
    const giveUp = setTimeout(() => { cleanup(); reject(new SignInCancelled()) }, 10 * 60_000)
    let cleanup = () => { removeEventListener('message', onMessage); clearInterval(timer); clearTimeout(giveUp) }
    // Sign-in pages may set Cross-Origin-Opener-Policy, which severs window.opener; a same-origin
    // BroadcastChannel reaches us either way.
    const channel = new BroadcastChannel('ream-auth')
    channel.onmessage = (e) => onMessage(new MessageEvent('message', { data: e.data, origin: location.origin }))
    const close = cleanup
    cleanup = () => { close(); channel.close() }
    addEventListener('message', onMessage)
  })
}

/** Runs on /auth/callback before the app boots. Returns true when it handled the page. */
export async function handleAuthCallback(): Promise<boolean> {
  if (location.pathname !== '/auth/callback') return false
  if (location.hash.includes('code=') || location.hash.includes('error=')) {
    // Microsoft (MSAL) answers in the fragment and listens through its own bridge.
    const { broadcastResponseToMainFrame } = await import('@azure/msal-browser/redirect-bridge')
    await broadcastResponseToMainFrame().catch(() => {})
    return true
  }
  const q = new URLSearchParams(location.search)
  const msg = { source: 'ream-auth', state: q.get('state'), code: q.get('code'), error: q.get('error') }
  window.opener?.postMessage(msg, location.origin)
  new BroadcastChannel('ream-auth').postMessage(msg)
  document.body.textContent = 'Signed in. You can close this window.'
  setTimeout(() => close(), 300)
  return true
}

export { redirectUri }
