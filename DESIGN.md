# DESIGN.md: office.daft.onl UI standards

This file holds the concrete standards: tokens, components, states, motion and copy. The *why* is in
[`docs/design/VISION.md`](docs/design/VISION.md), the references in
[`docs/design/moodboard/`](docs/design/moodboard/README.md), and the process in the `office-ui` skill.
Tokens live in code at `app/src/styles/tokens.css`; this file and that file must agree.
Storage: the library index is SQLite (official WASM) on OPFS in `app/src/storage/db.worker.ts`; the UI reads an
in-memory snapshot written behind (`app/src/data/library.ts`). One tab owns the library (Web Locks).

**Closest references** (the user's favourites): Superlist (frame + inset panel, big quiet titles, round
icon buttons), Proton Drive (file tiles: preview, hairline, name strip), Cosmos (one calm search, black pill
buttons), mymind (content carries the colour, chrome recedes).

## 0. Stack (decided 2026-11-05)

React 19 + TypeScript + Vite 8 in `app/`. Styling: CSS Modules driven by `app/src/styles/tokens.css` (no utility
framework). Motion (`motion/react`) for springs, layout and shared-element transitions. Phosphor icons (regular).
Instrument Sans Variable via Fontsource. Data layer: `app/src/data/library.ts` (UI phase: fixtures + localStorage +
simulated engine; the engine phase swaps in SQLite/OPFS + domOXML behind the same API).
Dev server: `cd app && npx vite` (port 5180), exposed over tailnet HTTPS with
`tailscale serve --bg --https=5443 http://127.0.0.1:5180` → https://leovm.tail53f5e9.ts.net:5443. HTTPS is required:
OPFS and Web Locks only exist in secure contexts, so the plain http://…:5180 address shows "Open Ream over a secure address".

## 0a. Identity
**Ream** (a ream is 500 sheets: your whole library). Mark: a lowercase *r* whose arm ends in a coral sheet of paper,
on an ink rounded square (inverts in dark mode). Wordmark: "Ream" in Instrument Sans 650. Never hard-code the name;
use `PRODUCT` from `app/src/ui/Brand.tsx`. Chosen 2026-11-05 over Foolscap, Sheaf, Octavo.

## 0b. Hard rule: never reinvent

The user's hard rule: **every element, structure and composition is built once, centrally, and reused.**
- `app/src/ui/`: domain-agnostic primitives (catalogue: `app/src/ui/README.md`).
- `app/src/compositions/`: domain structures built from primitives (catalogue: `app/src/compositions/README.md`).
- `app/src/desktop/`, `app/src/mobile/`: shells that only arrange compositions. A shell file never defines a
  button, menu, sheet, list row, title or empty state of its own.
- Missing something? Add it to `ui/` or `compositions/`, add a row to that catalogue, then use it.
- Two similar things are one component with a prop, not two components.

## 1. Principles

1. **The user's files are the only loud thing on screen.** Chrome is greyscale; colour comes from slides and file marks.
2. **Every element answers the five questions** (presentation, placement, reaction, naturalness, alignment) before it ships.
3. **Paper for content, glass for floating tools, solid for persistent chrome.** See *Materials*.
4. **Instant and honest.** Local actions are optimistic with Undo; engine work shows truthful progress.
5. **No dead UI.** Nothing appears that can't be used yet (no Write/Grid filters, no fake share links).
6. **Never vibecoded.** No gradient blobs, emoji-as-icons, centred marketing heroes, or random rounded cards.
   Every radius, shadow and colour comes from a token with a stated role.

## 2. Layout

### Desktop (≥ 760px wide, or ≥ 900px with a coarse pointer)
- **Frame**: the window background (`--frame`). Holds the sidebar.
- **Sidebar**: 240px, sits directly on the frame (no panel, no glass). 12px inner padding.
- **Panel**: the content area is one inset rounded panel (`--panel`), 8px from the frame edges, radius `--r-panel`,
  1px `--hair`, `--shadow-panel`. It scrolls internally; the frame never scrolls.
- Panel content padding: 28px top, 36px sides. Max content width 1440px, left-aligned (not centred).
- **Page header** inside the panel: title (`--t-title`) with a quiet count beside it ("Home  12 decks"), then a toolbar row.

### Mobile (< 760px, or < 900px with a coarse pointer)
- No frame or panel: the screen is the ground. Large title header, content, floating tab bar.
- 16px side gutters plus safe-area insets. The tab bar floats 12px above the bottom safe area.
- Content gets bottom padding of tab bar height + 24px so nothing hides under it.

## 3. Tokens

### Colour (light / dark)
| Token | Light | Dark | Role |
|---|---|---|---|
| `--frame` | `#ECECEF` | `#08080A` | Window background behind sidebar and panel |
| `--panel` | `#F8F8FA` | `#111114` | Content panel |
| `--paper` | `#FFFFFF` | `#1A1A1E` | File tiles, menus' solid variant, inputs |
| `--ink` | `#17171C` | `#EDEDF0` | Primary text, primary button fill |
| `--ink-2` | `#5C5C66` | `#A3A3AD` | Secondary text |
| `--ink-3` | `#686872` | `#8D8D98` | Tertiary text, placeholders (≥ 4.5:1 on every solid surface) |
| `--ink-4` | `#A0A0AA` | `#55555E` | Disabled and decorative only, never readable text |
| `--hair` | `rgb(23 23 28 / .08)` | `rgb(255 255 255 / .08)` | 1px borders, dividers |
| `--fill` | `rgb(23 23 28 / .05)` | `rgb(255 255 255 / .06)` | Hover fill, round icon buttons, segmented track |
| `--fill-2` | `rgb(23 23 28 / .09)` | `rgb(255 255 255 / .10)` | Pressed fill, active nav item |
| `--select` | `#1D56E0` | `#5B8CFF` | Selection, focus ring, links. The one UI accent. |
| `--select-soft` | `rgb(47 107 255 / .10)` | `rgb(91 140 255 / .16)` | Selected tile fill |
| `--deck` | `#E8603C` | `#F07650` | Deck file type only |
| `--danger` | `#C42B2B` | `#FF6B6B` | Destructive actions |
| `--ok` | `#1E9E62` | `#4CC38A` | Success states |

The **file-type colour is never the UI accent.** Selection and focus are blue, so they never blend into coral Deck marks or slides.

### Type: Instrument Sans Variable (tabular figures on)
| Token | Size / line | Weight | Tracking | Use |
|---|---|---|---|---|
| `--t-title` | 26 / 32 | 650 | -0.02em | Page title (desktop) |
| `--t-large` | 32 / 38 | 680 | -0.025em | Large title (mobile) |
| `--t-heading` | 15 / 20 | 600 | -0.01em | Section headings |
| `--t-body` | 14 / 20 | 450 | 0 | Default UI text, file names |
| `--t-small` | 13 / 18 | 450 | 0 | Metadata, menu items |
| `--t-caption` | 12 / 16 | 500 | 0.01em | Badges, counts, hints |
| `--t-label` | 11 / 14 | 600 | 0.06em, uppercase | Sidebar section labels only |

Mobile body is 16/22 (iOS readability, and no zoom on inputs). Names truncate with a middle ellipsis and wrap to at most two lines in tiles.

### Space (4px grid)
`--s-1` 4 · `--s-2` 8 · `--s-3` 12 · `--s-4` 16 · `--s-5` 20 · `--s-6` 24 · `--s-7` 32 · `--s-8` 40 · `--s-9` 56

### Radius (each has one role)
| Token | px | Role |
|---|---|---|
| `--r-xs` | 6 | Kbd hints, tiny badges |
| `--r-sm` | 8 | Nav items, menu items, inputs |
| `--r-md` | 12 | File tiles, thumbnails' outer tile |
| `--r-lg` | 16 | Menus, popovers, toasts, ⌘K |
| `--r-panel` | 14 | The content panel |
| `--r-pill` | 999 | Buttons, segmented controls, search, tab bar |
| Thumbnail inner | `calc(--r-md - 4px)` | Slide preview inside a tile (concentric with the tile) |

Nested radii are always concentric: inner = outer − padding.

### Elevation
| Token | Use |
|---|---|
| `--shadow-panel` | `0 1px 2px rgb(0 0 0 / .04)` content panel |
| `--shadow-tile` | `0 0 0 1px var(--hair), 0 1px 2px rgb(0 0 0 / .04)` tile at rest |
| `--shadow-tile-hover` | adds `0 8px 24px -8px rgb(0 0 0 / .14)` plus a -2px lift |
| `--shadow-float` | `0 12px 40px -8px rgb(0 0 0 / .22), 0 2px 6px rgb(0 0 0 / .06)` glass surfaces |

### Icons
Phosphor, **regular** weight. 18px in nav and toolbars, 16px inline and in menus, 22px on mobile tab bar and headers.
Icon-only buttons always have an `aria-label` and a tooltip on desktop.

## 4. Materials
| Material | Where | Recipe |
|---|---|---|
| Frame / Panel | Persistent chrome | Solid tokens. Never `backdrop-filter`. |
| Paper | File tiles, slides | `--paper`, `--shadow-tile`. Slides keep their own colours in both themes. |
| Glass | Selection bar, context menus, mobile tab bar (only where it floats over document previews) | `--glass` tint (light `rgb(250 250 252 / .92)`, dark `rgb(28 28 32 / .92)`); text on glass only `--ink`, `--ink-2`, `--danger` (measured ≥ 4.5:1 over white, black, `#FFD400`, coral), `blur(24px) saturate(1.4)`, 1px `--glass-edge` border, `--shadow-float`. |
| Smoke | Behind sheets, Quick Look, ⌘K | `rgb(10 10 14 / .32)` light, `.5` dark. No blur. |

- At most two glass surfaces visible at once. Toasts, ⌘K and sheets are **solid** `--paper` with `--shadow-float` (budget rule, xhigh review).
- `prefers-reduced-transparency` / `prefers-contrast: more` / no `backdrop-filter`: glass becomes `--paper`.
- Text on glass must pass 4.5:1 over white, black, `#FFD400` and `--deck` backdrops (visual test before ship).

## 5. Motion
| Token | Spec | Use |
|---|---|---|
| `spring.snappy` | stiffness 560, damping 40, mass 0.9 | Press, toggles, selection pill, menus |
| `spring.gentle` | stiffness 280, damping 34 | Layout changes, panels, sheets, Quick Look |
| `--ease-out` | `cubic-bezier(.2, .8, .2, 1)` | CSS fades and colour |
| `--dur-1/2/3` | 120 / 180 / 260ms | Hover colour / fade-in / overlay fades |

- Press: `scale(.97)` on buttons, `scale(.985)` on tiles, applied within one frame. Hit area unchanged.
- Hover: colour/fill change at `--dur-1`. Tiles lift 2px with `--shadow-tile-hover`. Covers never change on hover.
- Menus and popovers scale from 0.96 at their anchor with `spring.snappy`. Exit is a 120ms fade.
- Quick Look grows from the tile (`layoutId`) with `spring.gentle`.
- **Reduced motion**: no transforms or layout animation; fades only.

## 6. Components

Each component lists its states. A state missing here is a state not designed yet.

### Button
- **Primary**: `--ink` fill, `--paper` text, pill, 34px tall desktop (44 mobile), 14px horizontal padding, icon 16 + label.
  One per view. Hover: 8% lighter. Press: scale .97. Disabled: 40% opacity, no hover.
- **Secondary**: `--paper` fill + `--shadow-tile`, `--ink` text. Same metrics.
- **Round icon**: 32px circle, `--fill`, `--ink-2` icon; hover `--fill-2` and `--ink`. Mobile 40px (44 hit area).
- **Focus** (all): 2px `--select` ring, 2px offset, keyboard focus only (`:focus-visible`).

### Search field (desktop)
Pill, 36px, `--paper`, `--shadow-tile`, magnifier icon, placeholder "Search decks and slides", `⌘K` kbd hint on the
right. Click or ⌘K opens the command palette in place (the field *is* the palette's trigger, not a second search).

### Sidebar
- Brand row: mark + "Office" (36px tall).
- Nav items: 32px tall, `--r-sm`, icon 18 + label + right-aligned count in `--ink-3`.
  Hover `--fill`; current `--fill-2` + `--ink` text + 600 weight. No accent bar.
- Section label "Folders" (`--t-label`) with a round "+" (New folder) that appears on section hover/focus.
- Folder items: indented 8px, folder icon, name; drop targets (accent ring + `--select-soft` while dragging over).
- **Storage footer**: "Stored in this browser" (`--t-small`, `--ink-2`), "Backed up 2 days ago" (`--t-caption`, `--ink-3`),
  and a small secondary **Back up** button. Never-backed-up shows "Not backed up yet" in `--ink-2`.

### Deck tile (desktop)
- Paper tile, `--r-md`, 4px inner padding around the thumbnail (concentric radius), then a 1px hairline, then the
  name strip (10px 12px): name (`--t-body` 550, two lines max), meta line (`--t-small`, `--ink-3`): "Edited 2h ago · 18 slides".
- **Format marks** at the right of the meta line: PowerPoint mark and HTML mark (18px), always visible at 72% opacity,
  100% on tile hover or focus. Each is a button: one click downloads that format. Tooltip: "Download PowerPoint (.pptx)".
- **⋯** round button (28px) top-right of the name strip, visible on hover, focus or selection (always on touch).
- States: rest · hover (lift) · pressed · focused (ring) · selected (`--select` 2px ring + `--select-soft` strip + check
  badge on thumbnail top-left) · dragging (0.9 opacity, follows pointer, others don't reflow) · drop-target (n/a) ·
  importing (thumbnail replaced by a phase label + thin progress bar) · failed (paper with reason + Try again / Remove) ·
  renaming (name becomes an input, Enter saves, Esc cancels, empty name rejected).
- **Click opens** (user decision, overriding the Finder model). Selection is explicit: the tile's checkbox (on hover,
  always on touch), ⌘/Ctrl-click toggles, ⇧-click ranges, and **once anything is selected, plain clicks toggle**.
- **Keyboard map (collection-scoped, suspended while typing or in a dialog):** arrows move focus · **Enter opens** · **F2 renames** · **Space** Quick Look · ⌘/Ctrl-Space toggles
  the focused item · ⇧-arrows extend the selection · ⌘/Ctrl-A selects all · ⌘/Ctrl-⌫ or Delete → Trash ·
  ⌘/Ctrl-D duplicates · S stars/unstars · Esc clears selection · right-click opens the context menu · drag onto a folder moves.

### Folder tile (Files view)
Paper tile, 4:3-ish, folder glyph area tinted `--fill` with a peek of the most recent deck cover inset bottom-right;
name + "12 decks". Drop target state: `--select` ring, lift, label "Move to Clients". Dwell 700ms opens.

### List row (desktop list view)
44px, thumbnail 48×27, name, location (when mixed), modified, size, format marks, ⋯. Sortable headers.

### Segmented control
Pill track `--fill`, 30px; selected segment `--paper` + `--shadow-tile`, sliding with `spring.snappy` (`layoutId`).

### Menu (context menu and ⋯)
Glass, `--r-lg`, 6px padding, min-width 220px. Items 32px, `--r-sm`, icon 16 + label + shortcut hint (`--ink-3`).
Hover/keyboard highlight `--fill-2`. Groups separated by a 1px `--hair` with 4px margin. Destructive items `--danger`.
Arrow keys move, Enter activates, Esc closes and returns focus to the trigger. Type-ahead jumps to items.

### Command palette (⌘K)
Solid `--paper` sheet, 640px wide, top at 18vh, Smoke behind. Input 52px (`--t-heading` size). Sections: **Decks**,
**Slides** (paper chip of the slide, matched text highlighted, "Q3 review · Slide 4"), **Actions**. Arrow keys,
Enter opens (a slide hit opens the deck at that slide), Esc closes. Empty query shows recent decks and common actions.
No results: "No decks or slides match “query”".

### Quick Look
Space on a focused tile. Smoke backdrop; the slide grows from the tile to fit the viewport at 16:9 with 48px margins.
Bottom glass bar: deck name, "Slide 4 of 18", ← →, Open. ←/→ change slides, Esc/Space close back into the tile.

### Selection bar
Glass pill, bottom centre, 12px above the panel edge. "3 selected" · Download · Move · Delete · ✕ (Esc).
Rises with `spring.gentle` when selection ≥ 1, morphs into the Undo toast after a bulk delete.

### Toast
Solid `--paper` card with `--shadow-float`, bottom centre, above the selection bar. Message + optional action ("Undo"). 5s, pauses on hover/focus.
Stack max 3; older ones compress behind (Sonner pattern), expand on hover.

### Drop veil
For external files anywhere over the content area, cards included (xhigh review): glass veil inset 12px, dashed `--select` border, icon +
"Drop .pptx to import into Files" (the current destination). Over a folder tile or sidebar folder, that folder highlights and becomes the destination. Non-pptx: "Only .pptx files for now".

### Mobile: tab bar
Glass pill (56px) with two destinations (**Recents**, **Files**: icon 22 + label 11), plus a separate 56px glass
circle for **Search**. The selected tab has a `--fill-2` pill sliding with `spring.snappy`. In Select mode the bar is
replaced by the batch bar (Download · Move · Delete), disabled at zero selected; the header shows the count, **Select all** and **Done**; Back leaves Select mode first.

### Mobile: list row
64px: thumbnail 80×45 (`--r-sm`), name (16/22 550), meta (13/18 `--ink-3`), ⋯ (44×44 hit). Tap opens the viewer;
long-press opens the action sheet; swipe left reveals Download/Delete (no full-swipe delete).

### Mobile: action sheet
Bottom sheet over Smoke, `--paper`, top radius 20, grabber, deck header (thumbnail + **full, wrapping name** + location + meta, outside the scrolling list), actions as 52px rows
with icons, Cancel. Drag down to dismiss (velocity-aware), focus trapped, Esc closes.

## 6b. Naming and destinations
- The two library views are **Recents** and **Files** in both shells (plus Starred, Trash).
- New deck / Import / New folder create in the current folder in Files; from Recents or Starred they go to the
  Files root, and the button's tooltip and the toast say so ("New deck in Files").
- Imported decks keep their original: the menu offers **Download original** beside PowerPoint and HTML exports.
- Sidebar storage footer offers **Back up** and, in its menu, **Restore…**.

## 7. Copy
- Sentence case everywhere. Verbs on buttons: "New deck", "Import", "Back up", "Move to…", "Delete".
- Results say what happened: "Moved 3 decks to Trash", with Undo.
- Errors say what failed and what to do: "Couldn't read “Q3.pptx”. It's password-protected. Remove the password in PowerPoint and import again."
- Relative times: "Just now", "5m ago", "2h ago", "Yesterday", "Tue", "Oct 28", "Oct 28, 2025".
- Counts: "1 deck", "12 decks". Never "deck(s)".

## 8. Accessibility checklist (per component, before ship)
Keyboard path · visible focus · `aria-*` roles (grid, menu, dialog, tablist) · 44px touch targets · 4.5:1 text ·
3:1 icons/state · reduced motion · reduced transparency · screen-reader labels on icon buttons and file marks.

## 9. Changelog
- 2026-11-05: v1.2, user feedback: click opens + explicit selection; deeper dark palette; contrast fixes measured (ink-3, select, danger, glass tint .92).
- 2026-11-05: v1.1, xhigh review: keyboard map, names, destinations, solid toasts/⌘K, drops over cards, mobile Select mode, full names in sheets, originals, Restore.
- 2026-11-05: v1, from VISION v2 and both review rounds; Proton/Superlist/Cosmos/mymind steer; blue selection
  accent split from Deck coral; Instrument Sans (has `tnum`; Inter and Geist avoided).
