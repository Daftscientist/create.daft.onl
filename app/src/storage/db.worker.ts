// The library's durable store: SQLite (official WASM build) on OPFS via the sync-access-handle pool,
// plus a content-addressed blob area in OPFS for media (engine phase). Runs only in this worker.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm'
import type { Request, Response, Row } from './protocol'

type DB = { exec: (o: unknown) => unknown; close: () => void }

let db: DB | null = null
// Each account has its own pool directory and blob directory (the default account keeps the original names).
let dirs = { dir: '/ream-db', blobs: 'blobs' }
let pool: { wipeFiles: () => Promise<void>; OpfsSAHPoolDb: new (name: string) => DB } | null = null

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, parent_id TEXT, type TEXT NOT NULL, json TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS entries_parent ON entries(parent_id);
  CREATE TABLE IF NOT EXISTS docs (id TEXT PRIMARY KEY, json TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

async function open() {
  const sqlite3 = await sqlite3InitModule()
  pool = (await (sqlite3 as unknown as { installOpfsSAHPoolVfs: (o: object) => Promise<typeof pool> })
    .installOpfsSAHPoolVfs({ directory: dirs.dir, name: `opfs-sahpool${dirs.dir.replace(/\W/g, '-')}`, initialCapacity: 6 }))!
  db = new pool.OpfsSAHPoolDb('/library.sqlite3')
  db.exec({ sql: 'PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;' })
  db.exec({ sql: SCHEMA })
}

function rows(sql: string, bind?: unknown[]): Row[] {
  return db!.exec({ sql, bind, rowMode: 'object', returnValue: 'resultRows' }) as Row[]
}

async function blobDir() {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(dirs.blobs, { create: true })
}

async function handle(req: Request): Promise<unknown> {
  switch (req.op) {
    case 'open': {
      dirs = { dir: req.dir, blobs: req.blobs }
      if (!db) await open()
      return {
        entries: rows('SELECT json FROM entries').map((r) => JSON.parse(r.json as string)),
        docs: Object.fromEntries(rows('SELECT id, json FROM docs').map((r) => [r.id, JSON.parse(r.json as string)])),
        meta: Object.fromEntries(rows('SELECT key, value FROM meta').map((r) => [r.key, JSON.parse(r.value as string)])),
      }
    }
    case 'apply': {
      db!.exec({ sql: 'BEGIN' })
      try {
        for (const m of req.mutations) {
          if (m.kind === 'entry') db!.exec({ sql: 'INSERT OR REPLACE INTO entries(id, parent_id, type, json) VALUES (?,?,?,?)', bind: [m.entry.id, m.entry.parentId, m.entry.type, JSON.stringify(m.entry)] })
          else if (m.kind === 'delete') {
            db!.exec({ sql: 'DELETE FROM entries WHERE id = ?', bind: [m.id] })
            db!.exec({ sql: 'DELETE FROM docs WHERE id = ?', bind: [m.id] })
          } else if (m.kind === 'doc') db!.exec({ sql: 'INSERT OR REPLACE INTO docs(id, json) VALUES (?,?)', bind: [m.id, JSON.stringify(m.doc)] })
          else if (m.kind === 'meta') db!.exec({ sql: 'INSERT OR REPLACE INTO meta(key, value) VALUES (?,?)', bind: [m.key, JSON.stringify(m.value)] })
        }
        db!.exec({ sql: 'COMMIT' })
      } catch (e) {
        db!.exec({ sql: 'ROLLBACK' })
        throw e
      }
      return null
    }
    case 'wipe': {
      db?.close()
      db = null
      await pool?.wipeFiles()
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(dirs.blobs, { recursive: true }).catch(() => {})
      await open()
      return null
    }
    case 'putBlob': {
      const dir = await blobDir()
      const fh = await dir.getFileHandle(req.hash, { create: true })
      const access = await (fh as unknown as { createSyncAccessHandle: () => Promise<{ truncate: (n: number) => void; write: (b: Uint8Array, o: { at: number }) => number; flush: () => void; close: () => void }> }).createSyncAccessHandle()
      access.truncate(0)
      access.write(new Uint8Array(req.bytes), { at: 0 })
      access.flush()
      access.close()
      return null
    }
    case 'getBlob': {
      const dir = await blobDir()
      const fh = await dir.getFileHandle(req.hash).catch(() => null)
      return fh ? await fh.getFile() : null
    }
  }
}

self.onmessage = async (ev: MessageEvent<Request>) => {
  const req = ev.data
  try {
    const result = await handle(req)
    self.postMessage({ id: req.id, ok: true, result } satisfies Response)
  } catch (e) {
    const err = e as { name?: string; message?: string }
    self.postMessage({ id: req.id, ok: false, error: { name: err.name ?? 'Error', message: err.message ?? String(e) } } satisfies Response)
  }
}
