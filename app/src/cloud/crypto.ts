// End-to-end encryption for synced files. The key is derived from the passphrase (PBKDF2-SHA256,
// 310k iterations) and kept on this device as a non-extractable CryptoKey in IndexedDB; the cloud
// only ever stores AES-GCM ciphertext plus a salt and a check value to recognise the right passphrase.
const ITER = 310_000
const enc = new TextEncoder()
const dec = new TextDecoder()
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export type KeyFile = { v: 1; salt: string; check: string }

async function derive(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function seal(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text)))
  return JSON.stringify({ ream: 'sealed', v: 1, iv: b64(iv), data: b64(data) })
}

export const isSealed = (text: string) => text.startsWith('{"ream":"sealed"')

export async function open(key: CryptoKey, text: string): Promise<string> {
  const { iv, data } = JSON.parse(text) as { iv: string; data: string }
  return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(data)))
}

export async function newKey(passphrase: string): Promise<{ key: CryptoKey; file: KeyFile }> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await derive(passphrase, salt)
  return { key, file: { v: 1, salt: b64(salt), check: await seal(key, 'ream-key-check') } }
}

/** Returns the key if the passphrase is right, null otherwise. */
export async function unlockKey(passphrase: string, file: KeyFile): Promise<CryptoKey | null> {
  const key = await derive(passphrase, unb64(file.salt))
  try { return (await open(key, file.check)) === 'ream-key-check' ? key : null } catch { return null }
}

// ---------- device key store (IndexedDB keeps CryptoKey objects without exposing their bytes) ----------
const DB = 'ream-keys'
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => r.result.createObjectStore('keys')
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
export async function storeKey(key: CryptoKey | null) {
  const db = await idb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('keys', 'readwrite')
    if (key) tx.objectStore('keys').put(key, 'library')
    else tx.objectStore('keys').delete('library')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
export async function loadKey(): Promise<CryptoKey | null> {
  try {
    const db = await idb()
    return await new Promise((resolve) => {
      const r = db.transaction('keys').objectStore('keys').get('library')
      r.onsuccess = () => resolve((r.result as CryptoKey) ?? null)
      r.onerror = () => resolve(null)
    })
  } catch { return null }
}
