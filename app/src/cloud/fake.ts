// Development only: a fake app-folder provider (a local test server) so the sync engine can be exercised end to end
// across two browsers. Never used in production builds.
import { RemoteConflict, type CloudDrive } from './types'

export function fakeDrive(url: string): CloudDrive {
  const rpc = async <T>(body: Record<string, unknown>): Promise<T> => {
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) })
    if (res.status === 409) throw new RemoteConflict(String(body.name))
    return res.json() as Promise<T>
  }
  return {
    id: 'dropbox',
    prepare() {},
    async signIn() { return { id: 'fake', email: 'fake@test', name: 'Fake cloud' } },
    async reconnect() {},
    async ready() { return true },
    async account() { return { id: 'fake', email: 'fake@test', name: 'Fake cloud' } },
    list: () => rpc({ op: 'list' }),
    changes: (cursor) => rpc({ op: 'changes', cursor }),
    async quota() { return { used: 3e9, total: 2e10 } },
    get: (name) => rpc({ op: 'get', name }),
    put: (name, body, ifRev) => rpc({ op: 'put', name, body, ifRev: ifRev === undefined ? '__any__' : ifRev }),
    async remove(name) { await rpc({ op: 'remove', name }) },
    async signOut() {},
    async forget() {},
  }
}
