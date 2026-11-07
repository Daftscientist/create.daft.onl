# Ream core: one Rust engine everywhere (proposal v2)

Status: **long-term design, not a rewrite plan** (the user, 2026-11-07): domOXML stays the Python core; parts move to
Rust one at a time when measurement shows a bottleneck, behind the same interfaces. HTML stays the AI's authoring
language (any layout; the browser measures it once; domOXML captures it). See `docs/ROADMAP.md`.

Originally a proposal, 2026-11-07. v1 was reviewed by a Claude subagent (17 findings) and
Codex high (23); they agreed on every major point. v2 below is the plan rewritten around their findings (triage at
the end).

## Why (the user's goals)
1. **Speed.**
2. **The same core everywhere**: web now, native UIs later; all document logic written once.
3. **Live co-editing later**, without rebuilding the document model when it comes.

## The core change: the model is the document, HTML is only a view
Today each slide *is* an HTML string. The editor edits that HTML, the AI writes HTML, and export re-reads changed
slides through the browser (about 11k lines of domOXML exist for that capture path). The imported IR is kept only so
untouched objects export exactly.

From now on: **a structured Ream document model is the truth.** The editor and the AI both change it through
validated **intents** (move, resize, set text, insert table, apply layout…). HTML is generated from the model for the
web canvas, never read back. PowerPoint is converted to and from the model directly.

domOXML's IR is **not** that model: it flattens masters, layouts, themes and placeholders into resolved per-slide
values and has no identities for table rows/cells, chart series or paragraphs. The IR stays as the import/export
format, connected to the model by adapters.

## Plan
### Step 0a. Speed now, without Rust (days)
The Pyodide worker loads lxml, which no runtime path uses (only test tooling); Pillow (8 files) and fontTools (2) can
load lazily; `import domoxml` (1.8 s) imports eagerly; memory snapshots are untried. Cut those, prewarm, measure cold
start and download. This delivers most of goal 1 in days; Rust is then justified by goals 2 and 3.

### Step 0b. Prove the risky parts (2–3 weeks, a disposable harness, go/no-go on numbers)
1. **Merge semantics on recorded edit traces**, including the concurrent cases that break naive CRDTs: resize vs move,
   group/ungroup vs child edits, reparent vs delete, multi-object reorder, table row/column inserts vs merged cells,
   two people typing in one box. Compare Loro against a small custom register-based format (with Loro or Yrs only for
   text), on identical workloads: correctness, file growth, speed, WASM size.
2. **Text editing binding**: one text box editing a CRDT text through contenteditable, with IME (Safari, Android),
   paste, emoji/combining/RTL, undo grouping, and remote edits arriving mid-composition. Budget: keystroke to paint
   < 8 ms.
3. **Porting rate**: port domOXML's text reading and inheritance to Rust; measure parity and lines per day, to
   estimate the full port honestly.
4. **Two-device folder sync** with single-writer files, end-to-end encryption, crashes at every step, and a device
   that comes back after weeks offline.
5. **Budgets** measured on a named low-end phone and laptop: WASM bytes (gz), init time, opening a 100-slide deck,
   peak memory, history growth over a long edit session, p95 interaction latency.

### Step 1. The Ream document model and intents, in Rust
- **Schema defined in Rust** (TypeScript types generated from it), versioned independently of the binary encoding.
  Deck-level from the start: **theme, masters, layouts, placeholders with inheritance kept**, per-node overrides as
  sparse maps; stable ids for slides, nodes, paragraphs, table rows/columns/cells, chart series/categories; notes,
  comments, animations, transitions.
- **Merge semantics chosen per structure** (from 0b): a node's transform is one atomic value in parent-local
  coordinates; a table's grid structure is one value with each cell's text its own container; paragraph properties
  keyed by paragraph id; deletion and reparenting rules defined. After every merge, every peer runs the same
  deterministic **repair pass** (normalise spans, drop orphans, clamp geometry), so all devices converge to a valid
  document.
- **Intents** are the only write path: validated fully before any change is made (CRDT transactions don't roll back).
  The editor sends intents (drags preview in the UI and commit once; geometry/snapping code is shared so previews
  don't cross the boundary per frame). **The AI uses typed tools** (insert shape, set text, apply layout, make chart,
  move, restyle…) validated by the core, with errors returned to it; whole-slide HTML rewrites go away (they would
  wipe out concurrent edits). Freeform layouts come through layouts and components, not raw HTML.
- **Unsupported content** (from PowerPoint or old HTML) becomes an **immutable opaque object**: frozen resources,
  bounds, a preview, and declared limits (move/resize/delete only). Never executed with app privileges.
- **History contract rewritten**: user undo via the CRDT's undo manager with transactions tagged by origin (user, AI
  turn, remote); AI-turn Undo is a compensating change computed from that turn's before/after (keeping today's
  skip-changed-slides behaviour); named versions are separate records restored by new operations.
- **Exactness defined**: imported source parts (shape XML, chart parts with embedded workbooks, relationships, media)
  are stored **outside the CRDT** as immutable, content-addressed blobs (the existing `ream-blob:` store), with part
  names remapped at export. "Changed" is derived by comparing a node with its import baseline (never a merged flag).
  Goal: patch only the XML of properties that changed, so a recoloured chart stays a native chart.
- **One document owner** (the main-thread core instance). Workers get immutable, versioned inputs (snapshot bytes) for
  import/export and return results tagged with that version. Work that needs the host (browser rasters for effects
  with no Office mapping) is an asynchronous, cancellable request from core to host.
- **Derived layout values never replicate automatically**: autofit scales and measured line breaks are local cache,
  recomputed per platform, and written into the document only by an explicit user edit of that box.

### Step 1m. Migration (ships with step 1)
- First, a **format gate** reaches every client: decks carry a format version, and old clients open newer decks
  read-only. No deck migrates before that's out.
- Each deck gets **one migration genesis**: the first device to migrate publishes an immutable starting document
  (document id, source revision, schema and migration version, id mapping); other devices adopt it instead of
  migrating independently (which would duplicate content when merged).
- HTML-only slides (AI- or Ream-made) migrate **through Pyodide** while it still ships (browser capture → domOXML →
  model). Pyodide can't be removed until every known deck has migrated (a legacy import stays available).
- The full legacy representation (HTML + IR) is kept, in the cloud folder too.

### Step 2. Sync on the model
- **Single-writer files**: each device owns one update file per deck that only it rewrites (batched, not one file per
  keystroke); readers merge all of them; snapshots are content-addressed and listed in manifests of what they cover.
  Durable inbox/outbox: received bytes and pending imports are stored before the provider cursor advances; nothing
  is retired until a covering snapshot is verified.
- **Full history kept** at first (no shallow trimming). Trimming waits for a retention protocol (device registry,
  acknowledged checkpoints, recovery for a device older than the checkpoint).
- **Identities separated**: user, installation, editing session (its own CRDT peer id, never shared by two tabs or a
  tab and a worker), document. Deck deletion uses epochs so an offline device can't resurrect a deleted deck.
- **Encryption**: authenticated envelopes binding document id, format, key epoch, update id and content hash; per-
  document keys wrapped for devices (and, later, collaborators); assets and snapshots encrypted too.
- Conflict copies disappear for decks.

### Step 3. PowerPoint reader in Rust, by feature family
Parity gates per family: semantic IR diff, normalised package structure, preserved graphs, pixel diffs of rendered
slides, repeated round trips, with and without fallback images, and "PowerPoint opens it" checks. The corpus grows
from 7 decks to several hundred licence-clean real decks first. What is **not** ported: the browser capture path
(most of its 11k lines; only CSS-to-DrawingML lowering for supported content), Playwright orchestration, fidelity
and capability tooling (they stay in Python as test oracles), CLI wrappers. Pillow and fontTools replacements are
inventoried (image decode/crop/filters, WMF/EMF, font subsetting/embedding, WOFF2).

### Step 4. Writer and preservation in Rust; Pyodide removed (once migration has finished).

### Step 5. Live co-editing
Needs a topology decision: real-time collaboration requires at least a small relay (WebRTC needs signalling and
often TURN; provider push needs webhooks), plus a **shared** storage location (Google's appDataFolder can't be
shared). Proposed: an opt-in, stateless relay that only sees end-to-end-encrypted update bytes and presence
(self-hostable), with shared-folder sync as the slow path and Dropbox longpoll for near-live. Invitations and
membership use the per-document keys from step 2.

### Step 6. Native shells (decision R below decides how they render).

## Security (from step 0b on)
Limits on compressed/uncompressed bytes, part counts, XML nesting, relationship graphs, image pixels, fonts and
update sizes; no external resolution or implicit fetching; parsing in terminable workers; `cargo-fuzz` on ZIP/OPC/XML,
preserved graphs, CRDT imports and round trips (failures kept); `cargo-deny` for licences and advisories. Export-time
capture moves to a sandboxed frame on a separate origin with a narrow message protocol.

## Cost, honestly
Steps 1–4 are a new document model, editor core, sync protocol and engine: a multi-quarter effort for a small team.
Step 0b's measured porting rate gives the real estimate and a go/no-go. While step 1 is in progress, new features
that touch the document format are built model-first (or wait).

## Decisions for the user
1. **Direction**: approve steps 0a (speed now) and 0b (prove the risky parts), with a go/no-go after 0b on numbers?
2. **AI edits through typed tools** (precise, mergeable, undoable) instead of writing slide HTML, giving up raw
   freeform HTML layouts (they come back as layouts/components)?
3. **R. How native apps render slides**: (a) a WebView canvas inside native shells (identical to web on day one;
   native UI around it), or (b) Ream's own native renderer later (more work, true native; text and effects will
   differ slightly from web)? Recommended: (a) first, (b) only if needed.
4. **Where the core lives**: `core/` in this repo (recommended: one change can touch core and UI together), or its own
   repo like domOXML?

## Review triage (v1 → v2)
Accepted from both: model ≠ IR (deck-level schema with masters/layouts/themes; IR as adapter), AI and UI speak intents
(no HTML → model path; opaque objects for unsupported content), per-structure merge semantics + deterministic repair,
validate-before-mutate, text binding as its own spike, rewritten history contract, exactness defined with source
graphs outside the CRDT, single-writer sync files + durable inbox/outbox + full history first, identity separation,
authenticated encrypted envelopes, migration genesis + format gate + migrating through Pyodide, one document owner,
derived layout values not replicated, rendering decision made explicit, collaboration topology needs a relay and
shared storage, parser security and fuzzing, cheap Pyodide speed-up first, smaller and riskier-first spike, corpus and
parity gates, honest cost. Rejected: none. Kept from v1: Loro as the leading candidate, but now measured against a
custom register format in 0b.
