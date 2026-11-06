// One interface for every cloud provider. Implementations talk to the provider straight from the
// browser (CORS verified in docs/architecture/SYNC.md); tokens never leave this device.
export type ProviderId = 'dropbox' | 'google' | 'onedrive'

export type CloudAccount = { id: string; email: string; name: string; avatar?: string }
export type RemoteFile = { name: string; rev: string; modified: number }

export class NeedsSignIn extends Error {
  constructor(provider: ProviderId) { super(`${provider} needs you to sign in again`); this.name = 'NeedsSignIn' }
}
export class RemoteConflict extends Error {
  constructor(name: string) { super(`${name} changed on another device`); this.name = 'RemoteConflict' }
}
export class ProviderFull extends Error {
  constructor() { super('Your cloud storage is full'); this.name = 'ProviderFull' }
}

export interface CloudDrive {
  readonly id: ProviderId
  /** Loads the provider's sign-in code ahead of time, so a later click can open its window at once. */
  prepare(): void
  /** Interactive: must run inside a user gesture (a click), because it opens a sign-in window. */
  signIn(opts?: { another?: boolean }): Promise<CloudAccount>
  /** Interactive re-authorisation for a provider whose session lapsed (Google: about hourly). */
  reconnect(): Promise<void>
  /** True when calls can be made right now without asking the user. */
  ready(): Promise<boolean>
  account(): Promise<CloudAccount>
  list(): Promise<RemoteFile[]>
  get(name: string): Promise<{ text: string; rev: string } | null>
  /** `ifRev` makes the write conditional: it throws RemoteConflict if the file changed since. */
  put(name: string, body: string, ifRev?: string | null): Promise<RemoteFile>
  remove(name: string): Promise<void>
  signOut(): Promise<void>
  /** Forgets this device's credentials only: no revocation, so other devices keep their access. */
  forget(): Promise<void>
}
