// The engine's front door. One worker, started on first use; calls queue behind its boot.
import type { EngineOp, EngineRequest, EngineResponse } from './engine.worker'

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
const progress = new Set<(p: string) => void>()

function call<T>(op: EngineOp, ...args: unknown[]): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<EngineResponse>) => {
      const m = e.data
      if (m.kind === 'progress') { progress.forEach((l) => l(m.progress)); return }
      const p = pending.get(m.id)
      pending.delete(m.id)
      if (m.ok) p?.resolve(m.value)
      else p?.reject(new Error(m.error))
    }
  }
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ id, op, args } satisfies EngineRequest)
  })
}

let booted = false
/** Boots the engine (downloads it the first time; the browser caches it after). */
export const engineReady = () => call<boolean>('ping').then((v) => { booted = true; return v })
export const engineBooted = () => booted
/** Starts the engine in the background when work is likely soon (a deck is open), so a download or
 *  import doesn't wait for it. Skipped when the user asked to save data. */
export function warmEngine() {
  if (booted || (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
  const go = () => void engineReady().catch(() => { /* the real call reports it */ })
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1500)
}
export const onEngineProgress = (l: (p: string) => void) => (progress.add(l), () => progress.delete(l))

export type ImportedDeck = { slides: { html: string; w: number; h: number; ir: string }[]; css: string; warnings: string[] }
export async function importPptx(bytes: ArrayBuffer): Promise<ImportedDeck> {
  return JSON.parse(await call<string>('import_pptx', new Uint8Array(bytes)))
}
export const composePage = (html: string, css: string, w: number, h: number) => call<string>('compose', html, css, w, h)
export async function exportPptxPayload(payload: object): Promise<{ pptx: Uint8Array<ArrayBuffer>; warnings: string[] }> {
  const out = JSON.parse(await call<string>('export_pptx', JSON.stringify(payload))) as { pptx: string; warnings: string[] }
  return { pptx: Uint8Array.from(atob(out.pptx), (c) => c.charCodeAt(0)), warnings: out.warnings }
}
