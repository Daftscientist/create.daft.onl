# Engine: running domOXML in the browser

Status: **proposed**, 2026-11-05. Numbers below were measured, not estimated.

office.daft.onl is fully client-side. domOXML (Python, `~/domOXML`) is the document engine:
PPTX → canonical IR → PPTX / normalized HTML. This doc records how it runs in a browser tab.

## What domOXML actually needs

| Path | Needs a browser? | Deps |
|---|---|---|
| PPTX → IR (`read_pptx_result`) | No | lxml, defusedxml, Pillow, fontTools, brotli, pydantic |
| IR → PPTX (`build_pptx`) | No | same |
| IR → normalized HTML (`serialize_canvas`, `pptx_to_html`) | No | same |
| HTML/CSS → IR (`BrowserSession.render`) | **Yes**: computed styles, layout boxes, full-slide PNG, isolated element PNGs, backdrop captures | Playwright + Chromium |

Importing and exporting decks is pure Python. Only *authoring from HTML* needs a renderer.

## Measured: domOXML under Pyodide (Node 22, Pyodide 314.0.7 / CPython 3.14)

Unmodified domOXML source, `playwright` stubbed out. Real decks from `domOXML/real-decks/pptx`.

| Step | Pyodide | Native CPython |
|---|---|---|
| Boot interpreter | 1.7 s | — |
| Load lxml, pydantic, Pillow, brotli, fontTools | 0.5 s | — |
| `import domoxml` | 1.8 s | 0.24 s |
| Read PPTX → IR (2-slide chart deck) | 131 ms | 96 ms |
| IR → HTML (same) | 135 ms | 74 ms |
| IR → PPTX (same) | 56 ms | 48 ms |
| IR → JSON | 6 ms | 2 ms |

Payload: ~20 MB raw, **~12.8 MB gzipped**, cached after first visit.

Conclusion: once warm, conversions run at roughly 1–2× native speed. The cost is a ~4 s cold start and a
~13 MB first download, not per-operation speed.

## Decisions

**D1. domOXML runs unmodified on Pyodide, in a dedicated Web Worker, for import/export only.**
The worker boots on idle after the home screen paints, so it is warm before the first
import or download. Every call is a message: `import(pptxBytes) → irJson`, `export(irJson, fmt) → bytes`.
Later: a Pyodide memory snapshot can cut the cold start (needs measuring).

**D2. Nothing on the interaction hot path touches Python.** Home thumbnails, the editor and
previews render IR → DOM in TypeScript. IR types are generated from domOXML's pydantic JSON Schema,
so the two can't drift silently.

**D3. Rasters come from the browser we're already in, never from a re-implementation.**
domOXML rasterizes exactly the CSS that has no native Office mapping (filters, blend modes,
backdrop blur, masks). A raster engine that re-implements CSS fails on those same cases.
- Primary fallback: SVG `foreignObject` → canvas over a same-origin offscreen iframe. Uses the real
  engine's paint; fonts and images must be inlined first.
- Progressive: HTML-in-Canvas `drawElementImage` (Chrome origin trial, `content="drawable"` since
  Chrome 155) paints an isolated element with the real compositor. Feature-detect it.
- Computed styles and layout boxes: run domOXML's own `_SNAPSHOT_JS` inside the iframe. No change needed.
- **Takumi: rejected** for parity rasters. It is a CSS-subset engine (taffy + its own painter), so it fails
  on blur, blend and backdrop, which is exactly what domOXML rasterizes. It has no other job here either:
  thumbnails are live DOM renders of the IR.
- Escape hatch, not built now: an opt-in "exact export" through a headless-Chromium endpoint.

**D4. Storage: OPFS + SQLite-wasm.**
- SQLite (official sqlite-wasm, `opfs-sahpool` VFS, in a worker) holds the file tree, metadata,
  recents, and an FTS5 index of slide text. Folders are rows, so move and rename are instant and atomic.
- Content-addressed blob store in OPFS (`/blobs/<sha256>`) for images, media and fonts. IR JSON refers to
  assets by hash instead of inlining base64.
- IR stored per slide (`/docs/<id>/slides/<n>.json`) so editing one slide rewrites one file.
- Call `navigator.storage.persist()` at first save.

## Upstream domOXML changes this needs

1. **Lazy Playwright import.** `import domoxml` currently pulls Playwright via
   `core/ir/lowering.py → core/render/browser.py`. Put rendering behind a `Renderer` protocol;
   Playwright becomes one implementation, and the browser iframe another.
2. **IR doesn't round-trip through JSON today.** `PictureFill.data`, `PictureFill.svg_data`,
   `MediaNode.media_data` and `FontFace.data` are `bytes` without `ser_json_bytes="base64"`, so
   `SlideIR.model_dump_json()` raises `invalid utf-8 sequence`. Fix by moving assets to hash refs (D4),
   plus a JSON round-trip test.
3. **Pins.** `pydantic>=2.13`, but Pyodide ships 2.12.5. The spike ran fine on 2.12.5, so the pin can
   relax to match Pyodide.

## Open risks

- **Safari storage eviction.** Safari can clear script-written storage (OPFS included) for sites
  that haven't been visited in a while, unless the site is installed to the Home Screen. Verify this
  on current Safari. Mitigations: PWA install prompt, visible "last backed up", one-click export of everything.
- **PPTX imports have no authoritative slide render client-side.** `fallback_pngs` normally come from
  PowerPoint or LibreOffice. Without them, unsupported source visuals stay as reported coverage debt
  instead of pixel fallbacks. LibreOffice-WASM could fill this but is very heavy; not now.
- **First load.** ~13 MB, mitigated by D1's idle warm-up and HTTP caching.

Spike scripts: run outside the repo; reproduce with `pyodide` from npm + `loadPackage([...])`.
