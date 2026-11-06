// domOXML in a worker: Pyodide (CPython on WebAssembly) running the real domOXML wheel. The page
// never blocks on it. Pyodide and its compiled packages (lxml, pydantic-core, Pillow…) come from
// the matching jsDelivr build; the domOXML wheel is ours, in /engine.
import { loadPyodide, type PyodideAPI } from 'pyodide'
import bridge from './bridge.py?raw'

const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/'
export type EngineOp = 'ping' | 'import_pptx' | 'compose' | 'export_pptx'
export type EngineRequest = { id: number; op: EngineOp; args: unknown[] }
export type EngineResponse = { kind: 'result'; id: number; ok: true; value: unknown } | { kind: 'result'; id: number; ok: false; error: string } | { kind: 'progress'; progress: string }

const say = (progress: string) => postMessage({ kind: 'progress', progress } satisfies EngineResponse)

let ready: Promise<PyodideAPI> | null = null
function boot() {
  return (ready ??= (async () => {
    say('Starting the engine')
    const py = await loadPyodide({ indexURL: PYODIDE })
    say('Loading domOXML')
    const manifest = await (await fetch('/engine/manifest.json')).json() as { domoxml: string; deps: string[] }
    await py.loadPackage(['lxml', 'pillow', 'pydantic', 'fonttools', 'brotli'])
    // The wheels are unpacked straight into site-packages: their dependencies are loaded above
    // (Playwright is only for Chromium rendering), and micropip would refuse Pyodide's pydantic
    // over domOXML's pin even though it runs on it.
    for (const w of [...manifest.deps, manifest.domoxml]) {
      py.FS.writeFile(`/tmp/${w}`, new Uint8Array(await (await fetch(`/engine/${w}`)).arrayBuffer()))
      py.runPython(`import site, zipfile; zipfile.ZipFile('/tmp/${w}').extractall(site.getsitepackages()[0])`)
    }
    py.runPython(bridge)
    return py
  })())
}

self.onmessage = async (e: MessageEvent<EngineRequest>) => {
  const { id, op, args } = e.data
  try {
    const py = await boot()
    const fn = py.globals.get(op)
    const out = fn(...args)
    const value = typeof out === 'object' && out && 'toJs' in out ? out.toJs() : out
    postMessage({ kind: 'result', id, ok: true, value } satisfies EngineResponse)
  } catch (err) {
    const msg = String((err as Error).message ?? err)
    // Python tracebacks: the last line is the actual error.
    postMessage({ kind: 'result', id, ok: false, error: msg.trim().split('\n').pop() ?? msg } satisfies EngineResponse)
  }
}
