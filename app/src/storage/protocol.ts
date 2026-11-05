// Messages between the UI and the storage worker.
import type { Entry, LibraryState } from '../data/types'

export type Row = Record<string, unknown>

export type Mutation =
  | { kind: 'entry'; entry: Entry }
  | { kind: 'delete'; id: string }
  | { kind: 'doc'; id: string; doc: unknown }
  | { kind: 'meta'; key: string; value: unknown }

export type Op =
  | { op: 'open' }
  | { op: 'apply'; mutations: Mutation[] }
  | { op: 'wipe' }
  | { op: 'putBlob'; hash: string; bytes: ArrayBuffer }
  | { op: 'getBlob'; hash: string }

export type Request = Op & { id: number }
export type Response = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: { name: string; message: string } }

export type Opened = { entries: Entry[]; docs: Record<string, unknown>; meta: Partial<Record<keyof LibraryState, unknown>> & Record<string, unknown> }
