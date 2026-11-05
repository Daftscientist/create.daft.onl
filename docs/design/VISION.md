# Design vision: office.daft.onl

Status: **v3**, after three adversarial rounds (Claude subagent; Codex GPT 6.1 Sol at `high` and `xhigh`), 2026-11-05.
Concrete standards live in [`/DESIGN.md`](../../DESIGN.md); where they differ, DESIGN.md wins.
Moodboard: [`moodboard/`](moodboard/README.md). Review triage: [`review-log.md`](review-log.md).

There is no landing page. `office.daft.onl` opens straight into the app.

## The idea in one line

**Your documents are paper. The tools are glass.**

Documents (slides, pages, sheets, thumbnails) are always opaque, crisp and faithful. Small *floating*
controls are glass and pick up colour from what passes beneath them. Glass may hold **handles** to content
(names, icons, commands) but never the content itself; previews inside glass sit on small opaque paper chips.

Glass only works when something moves behind it. A frosted panel over a static background is the
glassmorphism cliché, so persistent chrome is solid material, not glass.

## Materials

| Tier | Used for | Treatment |
|---|---|---|
| **Ground** | The page | Static soft neutral. A faint tint computed once per session from recent decks (≤ 8% chroma), cross-fading only on navigation. Never animated. Off in the editor. |
| **Mica** (solid) | Sidebar, Files header, editor chrome, list view, long menus, detailed errors, info sheets | Opaque, tinted slightly by the ground, 1px hairline. No `backdrop-filter`, ever. |
| **Paper** | Document thumbnails, slides, the canvas | Opaque. Contact + ambient shadow, 1px hairline (light hairline in dark mode so dark slides separate from the ground). Document colours are never altered in either theme. |
| **Acrylic** (glass) | Compact floating controls over scrolling paper: mobile tab bar, selection bar, toasts, ⌘K palette, short context menus | Blur, `saturate ≤ 1.4`, tint ≥ 72% light / 65% dark, 1px specular edge. |
| **Smoke** | Dim behind sheets and the long-press lift | Translucent ink, no blur. |

Contrast is measured, not asserted. Acrylic text must pass 4.5:1 and required icons and state cues 3:1, measured over
worst-case backdrops: white, black, `#FFD400`, coral, and a second acrylic surface. That becomes a visual test.
`prefers-reduced-transparency`, `prefers-contrast: more` or no `backdrop-filter` support → solid Mica.

At most two acrylic surfaces are visible at once. Liquid refraction (SVG displacement) is used only on the
moving selection pill of the mobile tab bar, as a Chromium-only enhancement.

## Colour and type

- Neutrals lean slightly cool. File-type colours carry meaning: **Deck** coral-amber, later **Write** blue, **Grid** green.
- **Focus** is a 2px coral ring with a 2px ground-coloured gap. **Selection** is a tinted card frame plus a check badge.
  Neither relies on colour alone, since coral also appears in Deck marks and thumbnails.
- One sans family with tabular figures (e.g. Geist, OFL; not Inter). No serif display. Richness comes from the user's slides.
- A foundations table (text roles, spacing scale, row and card sizes, icon sizes, state colours) is written before
  the first component and lives in `docs/design/specs/foundations.md`.

## Motion

- Movement marks a state change. Nothing decorative moves on its own.
- Springs are interruptible. Two presets, *snappy* (direct manipulation) and *gentle* (layout), defined as tokens.
  Hit areas never move during press feedback.
- Opening a deck grows the card into the viewer or editor (View Transitions). If the card's origin is gone, cut.
- **Reduced motion**: open/close become 150 ms cross-fades, no lifts, no folder animation, no refraction.

## Honest about time and storage

- Local metadata changes (rename, move, star, delete) are optimistic and instant, with rollback on failure and Undo.
- Anything that crosses the domOXML worker shows truthful states: *acknowledged* immediately, then
  *Preparing…* if the engine is cold (> 300 ms), *working*, *done*, *failed + retry*. Browsing never blocks on the engine.
  Import progress is per phase (read → convert → save) until the worker emits real per-slide events.
- **Storage is part of the UI.** The library footer reads "Stored in this browser · Backed up 2 days ago". Then:
  - **Back up** downloads a workspace archive (folders, decks, assets); **Restore** reads one back.
  - On Chromium, offer **Automatic PPTX copies** (File System Access): one-way copies of every deck into a folder you
    choose, never overwriting a file changed outside the app, with pending/failed/permission states. Not called "sync".
  - Persistence denied, or Safari not installed to the Home Screen → a dismissable paper notice explaining the risk.
  - Quota exceeded → the write is refused cleanly, nothing is lost, and the notice offers Back up / Empty trash.
- **One tab owns the library** (SQLite's OPFS pool is exclusive). Another tab shows "Open in another tab" with
  **Use here**, which hands over via Web Locks + BroadcastChannel.

## Information architecture

- **Recents** = recent work only, bounded (last 12 opened). (Named "Recents" in both shells.) Hidden "Jump back in" row when the library has < 8 files.
- **Files** = the authoritative folder browser: breadcrumbs, current location, New/Import go into the current folder.
- **Starred**, **Trash** (30-day retention, Restore, Empty trash).
- One name per thing everywhere ("Files", not "All decks" in one place and "All files" in another).
  Write/Grid filters do not exist until those types ship.

## Commands (one inventory, every layout)

Open · Preview · Download PPTX · Download HTML · Send a copy (mobile share sheet, desktop download) · Rename ·
Duplicate · Move to… · Star · Delete · New folder · New deck · Import.

Desktop exposes them via context menu, a visible **⋯** in each card's name row, shortcuts and ⌘K
(Ctrl on Windows/Linux). Mobile exposes them via row **⋯** sheets and Select mode. Batch versions apply
to selections and report partial failures per file.

## Desktop: the workstation

```
┌─ Mica sidebar ──┐┌──────────────────────────── ground ───────────────────────────────┐
│ ⌂ Home          ││ [⌕ Search files and slides…  ⌘K ]            [Import] [New deck]  │
│ ▤ Files         ││                                                                    │
│ ☆ Starred       ││ Jump back in                                                       │
│ ⌫ Trash         ││ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐                                 │
│                 ││ │ 16:9 │ │ 16:9 │ │ 16:9 │ │ 16:9 │                                 │
│ FOLDERS         ││ └──────┘ └──────┘ └──────┘ └──────┘                                 │
│  ▸ Clients      ││ Q3 review   [P][H] ⋯   Keynote  [P][H] ⋯                            │
│  ▸ Talks        ││                                                                    │
│                 ││ Recent                                   Sort: Last opened ▾  ▦ ☰  │
│ Stored in this  ││ ...                                                                │
│ browser · Backed││                                ╭ 3 selected · Move · ↓ · Delete ╮  │
│ up 2 days ago   ││                                ╰────────── acrylic ─────────────╯  │
└─────────────────┘└────────────────────────────────────────────────────────────────────┘
```

**Activation (Finder / Drive convention):** click selects · double-click or Enter opens · ⇧/⌘/Ctrl-click
extends · arrows move focus · Space opens **Quick Look** (full slide preview over Home, ←/→ through slides,
slide number shown, Esc closes) · ⌘A selects all in the current view · Esc clears · F2 / Enter-while-selected renames ·
⌘D duplicates · ⌘⇧M Move to… · middle-click opens in a new tab. Hover only lifts the card a little; the cover never changes on hover.

**Download:** two small, always-visible format buttons in each card's name row, with the real marks: **P**
(PowerPoint) and **HTML**. One click each, no remembered hidden default. On batch: one archive, per-file failures listed.

**Folders** have their own silhouette (folder tab, name, "12 decks") with one small inset peek of the top cover,
never a fanned stack of 16:9 cards. While dragging: the target lifts with an accent ring and a "Move to Clients" label,
dwelling 700 ms opens it (spring-loaded), edges auto-scroll, a folder can't be moved into itself, Esc cancels,
and a failed move rolls back. Sidebar folders are drop targets too.

**Import:** the Import button is always there. External files dropped on empty ground show a veil reading "Drop .pptx to
import into Clients". Over a folder, only that folder highlights. Internal drags never show the veil.
Cards appear at once in a *queued* state, then importing, then done. A failed import stays as a card with the reason
("Password-protected"), **Try again** and **Remove**. A partly supported deck gets a badge ("3 slides simplified")
that lists what changed. Non-.pptx files: "Only .pptx for now".

**Search (⌘K):** files *and* slides. A slide hit shows a paper chip of that slide, the matched text highlighted,
deck name and slide number, and opens the deck *at that slide*. Commands live in their own section of the
palette. Indexing and no-results states are designed. Trash is excluded unless you're in Trash.

**Lists at scale:** sort by Name / Modified / Last opened (direction + stable tie-break) persists per view.
Grid and list both virtualise and mount only visible thumbnails. Long names wrap to two lines with a middle ellipsis,
plus the full name on hover/focus. Same-name decks show their folder. Reordering is deferred while a menu, selection
or drag is active.

**Bottom stack:** the selection bar is the base layer. Toasts stack 8px above it. A bulk delete dismisses the bar and its
pill morphs into the "Deleted 3 · Undo" toast. Toasts stay ≥ 5 s and pause on hover or focus. Trash keeps recovery after the toast.

## Mobile: the companion

```
┌──────────────────────────┐
│ Recents        [Select][+]│  large title → Mica bar on scroll
│ ┌──────────────────────┐ │
│ │ Q3 review   slide 4  │ │  pinned / last opened
│ │       [ Present ]    │ │
│ └──────────────────────┘ │
│ ▭ Q3 review       2h  ⋯  │  rows ≥ 56px, ⋯ = 44×44
│ ▭ Keynote talk   Tue  ⋯  │
│ ▭ Hiring plan    Oct  ⋯  │
│                          │  scroll clearance above the bar
│ ╭───────────────────╮ ╭─╮│  acrylic: two destinations + search
│ │ ◷ Recents ▤ Browse│ │⌕││
│ ╰───────────────────╯ ╰─╯│
└──────────────────────────┘
```

- Tabs are destinations only: **Recents** and **Browse** (the iOS Files convention), plus search split off.
  **+** (New deck / Import from Files) and **Select** live in the large-title header.
- **Select mode**: checkboxes, then an acrylic batch bar replaces the tab bar.
- **⋯ on each row** is the explicit route to actions (a sheet). Long-press is a shortcut to the same sheet.
  Swipe reveals actions but never deletes on a full swipe; delete goes to Trash with Undo.
- **Gesture arbitration**: horizontal swipe on a row = reveal actions; from the screen edge = back (and a visible Back
  button too); the recents card doesn't scroll horizontally.
- **Sheets**: focus moves in and returns to the trigger, Close + Esc work, drag-to-dismiss only from the grabber or
  top of the content, and a sheet with a rename in progress asks before dismissing.
- **Opening**: browsing opens a **viewer** (swipe slides, tap toggles controls, a labelled **Present** button, resume at
  the last slide). A newly created deck opens straight in the editor. Back returns to the same scroll position.
- Storage line and Back up live under Browse.

## Layout selection

Two compositions, one set of semantics. Commands, navigation state and operation states are shared; only composition
and density differ. The shell is chosen by available width with input as a hint (tablet + keyboard gets desktop).
Switching shells on resize keeps the current location, selection and open sheet/menu equivalent. The full editor is
reachable from both, but mobile treats it as a deliberate step.

## Engine-phase contracts (from the xhigh review, not built in the UI phase)

- **Storage full**: a persistent "Not saved · Browser storage full" state that keeps pending work and offers a rescue download; "Saved" only after persistence succeeds.
- **Originals**: imported .pptx files are kept; "Download original" sits beside the generated exports, including on failed imports.
- **Restore**: preview the result, keep both on conflict by default, replacing needs explicit approval, the current library survives any failure. Entry points: beside Back up, and on the empty first-run screen.
- **Tabs**: a new tab opens a read-only viewer mediated by the owning tab; taking ownership is a separate, explicit action.
- **Offline**: browsing works offline; import/export show "Connect once to enable import and export offline" until the engine is cached.

## Anti-references

- Glass panels over a static gradient; data on glass; purple-blue gradient dashboards.
- Marketing heroes. The first frame is your files.
- Spinners or skeletons for local metadata. (The engine is different: it gets truthful progress.)
- A shrunken desktop UI on phones.
- Changing a file's cover on hover.

## Per-decision protocol (every UI change)

For each element and each state, answer:
1. **Presentation**: material, size, type, icon, copy
2. **Placement**: where exactly, and why not the alternatives
3. **Reaction**: hover, press, drag, focus, keyboard, loading, error, empty, disabled, data changing underneath
4. **Naturalness**: which convention it follows; name the app that taught users this
5. **Alignment**: same materials, motion, spacing and voice as what's already built

Enforced by the project skill `.claude/skills/office-ui`.
