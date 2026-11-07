# Roadmap

Updated 2026-11-07. One page for where things stand and what comes next. Specs hold the detail; this holds the order.

## Direction (decided by the user, 2026-11-07)
- **Python core now, Rust where it hurts.** domOXML (Python) stays the engine. Parts move to Rust one at a time when
  measurement shows they're a bottleneck (startup, a slow conversion, something needed natively), each behind the same
  interface so nothing above it changes. `docs/architecture/CORE.md` is the long-term picture, not a rewrite plan.
- **HTML stays the AI's authoring language.** Models write HTML/CSS (any layout); the browser lays it out once;
  domOXML captures the result. The model's edits are reconciled per element so they stay small and undoable.
- **One deck-edit protocol everywhere.** The same operations (insert/replace slides, update elements by id, delete,
  move, set slide properties) are used by Ream's editor, Ream's AI, the domOXML MCP tools, and later the Rust core.
  Defined once (JSON Schema, in domOXML), with revisions so concurrent edits are detected, not lost.

## Workstreams
| # | Workstream | State | Next |
|---|---|---|---|
| 1 | **domOXML MCP App** (decks you and the model co-edit inside Claude, ChatGPT, VS Code…) | Spec drafted: `~/domOXML/docs/mcp-app.md` | Review (Claude + Codex), then build: local server first |
| 2 | **Deck-edit protocol** (shared operations + revisions) | Part of the MCP spec | Extract to its own schema once the MCP tools settle; then Ream's AI tools adopt it |
| 3 | **Startup speed** (Pyodide diet: drop unused lxml, lazy Pillow/fontTools/imports, memory snapshot) | Measured cause, not done | Days of work; measure before/after |
| 4 | **Ream: projects + chat** | Shipped (502a34a) | Deferred items in `specs/projects.md` |
| 5 | **Ream: interactive answers (OpenUI)** | Phase 1 shipped (738c847) | Codex post-build review; try with a real provider; phase 2 |
| 6 | **Ream: accounts + sync v2** | Shipped | Faster change checks, Dropbox longpoll (waiting on go-ahead) |
| 7 | **Rust core** | Long-term design (CORE.md v2) | Only where #3 or the MCP show a bottleneck |
| — | Older pending | Restore from backup; hidden slides export as visible; Morph plays as fade; phone editing; UI hillclimb | Scheduled after #1–#3 |

## How we work
- Every surface: spec → Claude + Codex pre-build review → build → screenshots → Codex post-build review
  (office-ui skill for Ream UI). Reviews logged in `docs/design/review-log.md`.
- Architecture changes get a doc in `docs/architecture/` and the same two reviews before code.
- Commit and push to main when a slice works and is verified; say what wasn't tested.
