# editor/: the deck editor

Spec: `docs/design/specs/editor.md`. Every change goes through `ops.ts` (one transaction each, `history.ts`);
gestures preview on the live stage DOM and commit once. Exactness per object: `irdiff.ts` (diff) +
`engine/bridge.py` `_splice` (export).

| Module | What it is |
|---|---|
| `session` | The open deck's editor state (slide, selection, group scope, editing, zoom, column, locks) |
| `ops` | Every edit: geometry, styles, text runs, insert/delete, order, group, lock, slides, background |
| `history` | Transactions, undo/redo, AI-turn undo, skipping slides changed since |
| `irdiff` | Per-object change records (dirty / moved) that keep untouched objects exact on export |
| `geometry` | Box read/write (px, rotation), group payloads |
| `text` / `textctl` | Paragraph model (normalization, lists, levels) / the live text edit and formatting targets |
| `snap` | Smart guides and equal spacing |
| `units` | in/cm/pt/px with arithmetic |
| `insert`, `clipboard`, `keys`, `commandList` | Insert bar, clipboard format, keyboard map, ⌘K commands |
| `Canvas`, `Rail`, `ContextBar`, `NotesDrawer`, `InsertGallery`, `Present` | The surfaces (v3: the context bar replaced the Format column and floating text bar) |
| `Sections` | The property sections the context bar opens in popovers (and Design in a dialog) |
