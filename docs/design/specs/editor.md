# Spec: Deck editor (desktop)

Status: **v2**, after pre-build review round 1 (Claude subagent + Codex GPT 6.1 Sol `high`), 2026-11-06. Phase 1 is
specified in full; later phases are scoped only. Triage is at the end.

**Goal:** effective parity with the PowerPoint desktop app for what people actually do to slides, reached our own
way. There's no ribbon. Every PowerPoint command has a home: on the canvas, in the Format column, in the insert bar,
or in ⌘K (our "Search for commands").

## References
- **Keynote** (`support.apple.com/guide/keynote/tane0a9ddb35`): Format inspector on the right, contextual to the selection;
  insert buttons in the toolbar. Our Format column follows it.
- **Excalidraw** (`moodboard/editor-excalidraw-selected.jpg`): properties only for a selection, in short labelled sections.
- **tldraw** (`moodboard/editor-tldraw-selected.jpg`): crisp frame, square screen-sized handles.
- **Polotno** (`moodboard/editor-polotno.jpg`): contextual controls for the selection; zoom cluster.
- **PowerPoint**: the parity checklist, units (pt, in/cm), Selection Pane, F6 region cycling, shortcuts users' hands know.
- **Figma**: smart guides with distance labels, arithmetic in number fields, label scrubbing.

## Parity map and phases

| Phase | Covers (PowerPoint equivalents) |
|---|---|
| **1. Canvas core** | Select (click, ⇧, marquee, Tab, ⌘A, select-under, object list), move/resize/rotate, nudge, smart guides, X/Y/W/H/angle in PowerPoint units, align & distribute, group/ungroup, lock, order; edit text in place incl. text in groups and table cells; B/I/U, size (pt), colour, font, align, vertical align, bullets/numbering toggle and indent; insert text box, basic shapes, picture; fill, border, radius, opacity, shadow; cut/copy/paste/duplicate/delete; slides new (from current layout or blank)/duplicate/delete/reorder, background; undo/redo by transaction; zoom; Present mode; spelling (browser) |
| 2. Depth | Line spacing and paragraph spacing, autofit for imported boxes, full shape gallery, lines/arrows/connectors (endpoint handles), format painter, find & replace, gradients, picture crop (fill/fit/focal point) and adjustments, glow/soft edge/blur, alt text, per-shape export status ("native" / "picture"), duplicate-and-repeat, **light editing on phones and tablets** (text, reorder) |
| 3. Tables & charts | Insert tables, structure edits (rows, columns, merge, styles), insert and edit charts with a data grid |
| 4. Slide design | Themes (colours, fonts), layouts and placeholders, slide size, picture/gradient backgrounds, sections, hide slide, speaker notes |
| 5. Motion & presenting | Transitions, animations, presenter view (notes, next slide, timer) |
| 6. Review | Comments, local version history, accessibility checker |

Out of scope: co-editing (single-user, client-side).

## Architecture contract (decided in review round 1)

**1. Operations are the only write path.** User gestures, the AI agent and sync all produce operations on stable ids:
`setGeometry`, `setText`, `setStyle`, `setParagraph`, `insert`, `delete`, `reorder`, `group`, `ungroup`, `setLock`,
`setSlideBackground`, `slideInsert/Delete/Move`. Each op names its slide id and node ids. Ops are grouped into
**transactions** `{id, origin: 'user' | 'ai:<turn>' | 'remote', baseRevision, ops, inverse}`.

**2. Exactness is per node, not per slide.** An imported slide keeps its original IR. For each slide the store also keeps:
- `irOps`: the geometry, order, group and delete ops applied since import, in order (applied to the IR in one batch at export, in the worker, never during editing);
- `dirty`: node ids whose content or style changed.

On export, untouched slides go straight from IR (with `irOps`). Touched slides are captured by the web backend, and
then every captured node whose id is **not** dirty is replaced by its original IR node (with `irOps` applied), matched by
`data-domoxml-node-id` (domOXML's capture already carries the id into the IR). A chart next to an edited title therefore
stays a native chart. Python never runs on the interaction path (ENGINE.md D2).

**3. Pictures are blobs, not data URIs.** Inserted and imported pictures are stored once in OPFS `/blobs/<sha256>`
and referenced as `ream-blob:<sha256>`. They resolve to object URLs at render and are inlined only at export.
Sync uploads blobs as `ream-blob-<hash>` files (content-addressed, so they never conflict). The AI sees short refs, not
megabytes. Existing data-URI slides are migrated lazily when a slide is next saved.

**4. Working copy and honest saving.** The editor edits a working copy of the open deck and commits to the library
at gesture end, after 600 ms of typing idle, on blur, on slide switch and before leaving. Sync stamps happen per
commit, never per frame. The header shows **Saving…** until the matching revision is written to SQLite, then
**Saved in this browser**. Sync status stays separate. On a write failure the working copy is kept (never reloaded
from disk), and a persistent **Not saved** state offers Retry and a rescue download (VISION engine contract).

**5. History is transactions.** ⌘Z undoes the newest local `user` transaction on the open deck; ⌘⇧Z redoes it.
The AI card's **Undo** reverts only its own `ai:<turn>` transaction. If a slide it touched has changed since, that
slide is skipped and the card offers "Revert slide 4 anyway". Remote transactions are barriers: they are never undone,
and they invalidate overlapping local undo entries (which then report "Can't undo: changed on another device").
History lasts for the session, capped at 200 transactions.

**6. Concurrency.**
- While the agent's run targets a slide, that slide is read-only on the canvas. A slim stage notice reads "Ream is
  editing this slide · Stop", and the rail thumbnail shows the activity ring. Agent tools write against the revision
  they read and fail on a stale one (they re-read and retry once).
- A remote change to the open deck is applied at once when it touches other slides. When it touches the slide being
  edited, it waits until the gesture or text edit ends. If both sides changed the same nodes, local wins, and a notice
  offers "Changed on another device · Use theirs" (which keeps the local version as a conflict copy).
- Runs, drafts and threads live in an agent store outside the panel, so switching the column to Format never stops or
  loses them.

## Phase 1: desktop

### Layout

```
┌ Mica header ───────────────────────────────────────────────────────────────────────────────┐
│ ← Q3 review          [T Text] [◇ Shape ▾] [▢ Picture]   ↶ ↷     [Download ▾] [Format|Ask] [▶ Present] │
│   Saved in this browser · Synced                                                            │
├ rail ┬──────────────────────── ground (untinted) ──────────────────┬ column (Format / Ask) ┤
│ 1 ▭  │                                                             │ Text box           ✕ │
│ 2 ▭  │      ┌──────────── paper slide (contained, 48px clear) ┐    │ ▾ Text               │
│ 3 ▭  │      │  ┌──────────┐                                   │    │ ▾ Fill · Border      │
│ + New│      │  │  Title   │                                   │    │ ▸ Arrange            │
│      │      │  └──────────┘                                   │    │                      │
│      │      └─────────────────────────────────────────────────┘    │                      │
│      │                                       [⊖ 76% ⊕]            │                      │
└──────┴─────────────────────────────────────────────────────────────┴──────────────────────┘
```

**Widths.** The column is one shared, resizable width (300–520px, the AI panel's splitter, remembered) for both
modes, so switching modes never reflows the stage. Opening or closing the column keeps the slide's centre fixed.
- ≥ 1280px: column open by default (Format).
- 1100–1279px: column open, insert buttons icon-only (with tooltips).
- 900–1099px: the column overlays the stage instead of pushing it; PowerPoint/HTML collapse into **Download ▾**.
- 760–899px: as above, plus undo/redo move into ⌘K and the ⋯ menu. Present never collapses.
- Long deck titles truncate with the full name on hover; browser zoom is treated as a narrower width.

**Coarse pointers** (tablets that get the desktop shell) get the **viewer** in phase 1, with "Editing on tablets
comes soon" in the ⋯ menu. Phones keep the viewer, and phone **New deck** is hidden until mobile editing ships
(phase 2). If the shell switches while editing (window resize), the active edit is committed first, and the
selection and viewport are restored on return.

### Canvas and slide
- *Presentation*: the slide is paper on an untinted ground. The editor draws its selection, guides and handles in an overlay
  layer above the slide's shadow root, so they never touch the slide's HTML or export.
- *Placement*: **Fit** = the slide contained within the stage with 48px clearance on all sides (room for handles).
  Objects off the slide stay visible on the ground, are selectable, and are clipped only at export.
- *Hit testing*: the topmost painted object under the pointer wins. A full-slide shape counts as an object. Clicking the
  ground outside the slide clears the selection. **⌥-click** selects the next object underneath, cycling.
  Clicking a group selects the group; double-click enters it (selects the child), Esc exits. Locked objects aren't
  hit-testable on the canvas; they're selectable in the object list, which shows a lock icon to unlock.
- *Reaction*:
  - Hover draws a 1px hover outline.
  - Drag on empty slide or ground draws a marquee; it selects objects it touches, and ⇧ adds.
  - Double-click a text object, or press Enter, to edit its text.
  - Wheel scrolls when zoomed; ⌘/Ctrl+wheel or pinch zooms around the cursor; Space-drag pans.
- *Data changing underneath*: see the concurrency rules above. The selection keeps ids that still exist.

### Selection frame and handles
- *Presentation*:
  - 1px `--select` frame on the rotated bounds, with a 1px white outer halo, which becomes dark when sampled over a
    light background. That gives 3:1 contrast over white, black, `#FFD400`, coral and navy (a visual test).
  - 8 square handles: 8×8 drawn, 16×16 hit area, white fill with a 1px `--select` border and halo.
  - Rotate handle 20px above the top-centre, with a 24×24 hit area.
  - Under 24px on screen, side handles hide. Under 12px, only the bottom-right corner remains, and the Arrange fields
    remain the precise route.
  - Multi-selection: one union frame plus thin member outlines.
- *Transform rules*:
  - X/Y and W/H refer to the **unrotated** box, as in PowerPoint.
  - Corner drags scale both axes and side drags scale one. ⇧ keeps aspect (pictures keep aspect by default, and ⇧
    frees it). ⌥ scales from the centre.
  - Minimum 1px; dragging through zero flips nothing and stops at the minimum.
  - Text boxes reflow on resize (the font size is unchanged). Text boxes inserted in Ream grow in height with their
    text (PowerPoint's "resize shape to fit text"). Imported fixed-size boxes keep their size and show an overflow marker.
  - Multi-selection scales proportionally from the union's anchor.
  - Rotate snaps to 15° with ⇧.
  - Arrows nudge 1px, ⇧ 10px; this applies only while the stage is focused and something is selected.
  - Esc during a drag cancels it and restores the shape.
  - Cursors follow handle direction, rotated with the shape.
- *Readout*: a small **solid** chip (`--paper`, `--shadow-float`, not glass, since it shows data) 10px below the
  cursor. It shows X, Y while moving, W × H while resizing and the angle while rotating, in the user's units.
- *Motion*: none on geometry. The shape tracks the pointer exactly.

### Smart guides
- *Presentation*: 1px `--guide` lines (magenta `#E8178A`, with the same halo; never red, which reads as an error and
  clashes with the Deck coral) and distance pills between neighbours (solid paper).
- *Targets, in priority order*: slide centre lines, slide edges, other objects' edges, other objects' centres, and
  equal spacing (Figma convention). Threshold 6 screen px; snapping releases after the pointer moves 4px past it.
  ⌘/Ctrl while dragging disables snapping. Guides fade in at `--dur-1` and appear only during a drag.

### Text editing
- *Entering*: double-click or Enter. The frame turns dashed and handles stay. Native browser `spellcheck` is on.
- *Three formatting targets* (Codex finding 8):
  - **Object selected, not editing**: formatting applies to all the text in the box(es).
  - **Caret only**: formatting sets the style for the next characters typed, the way Word and Keynote do.
  - **Text range selected**: formatting applies to the range.
- *Model*: on commit, the edited content is normalized back to domOXML's text model: paragraphs (with alignment,
  list type, level and indent), runs (spans with inline style) and line breaks. It is never left as browser markup
  (`<b>`, `<font>`, nested divs). Paragraph properties the editor doesn't expose (line spacing, spacing before or after)
  are preserved untouched.
- *Lists*:
  - Enter continues the paragraph's bullet or number.
  - Enter on an empty bullet ends the list.
  - Tab / ⇧Tab change the level inside a list.
  - Text bar and Format column have Bullets and Numbering toggles.
- *History*: while editing, ⌘Z/⌘⇧Z use the editor's own text history. Ending the edit records one transaction.
- *IME*: no normalization or re-render while `isComposing`.
- *Paste*: plain text is inserted with the caret's styling; pasting rich content keeps paragraph breaks only.
- *Leaving*: Esc or a click outside ends editing and keeps the object selected. An empty text box Ream inserted is
  deleted when editing ends.

### Floating text bar (only while editing text)
- *Presentation*: the editor's **only** glass surface. Acrylic, 36px tall: size (pt), B, I, U, colour, align ▾, bullets,
  numbering. Reduced transparency, increased contrast or no `backdrop-filter` → solid `--paper`. Text passes 4.5:1 and
  icons 3:1 over the VISION backdrops.
- *Placement*: 10px above the text frame, flipping below; never covers the line with the caret.
- *Focus*:
  - Clicks don't take focus from the text (mousedown is prevented).
  - The size field and the colour popover take focus, keep a **selection bookmark**, and return to the exact caret
    or range on Enter or Esc.
  - Keyboard route into the bar: ⌥F10 (Office's "go to toolbar"); Esc returns to the text.

### Insert bar (header)
- **Text**, **Shape ▾** (Rectangle, Rounded rectangle, Ellipse, Triangle, Star; lines and arrows come in phase 2 with
  endpoint handles), **Picture** (Office's word).
- Click inserts a default-sized object centred in the visible part of the slide, selected (text goes straight into
  editing). Dragging from a button onto the slide places it where dropped.
- Pictures:
  - They come from the file picker, paste or drop.
  - They're stored as blobs at full resolution; the slide shows a decoded preview sized to the slide.
  - Unsupported files: "That file isn't a picture Ream can use (PNG, JPEG, GIF, WebP, SVG)."
  - Decode failure: "Couldn't read that picture."
- New objects take the deck's dominant text colour and font, not hard-coded black.

### Format column
- *Presentation*: Mica, labelled sections. Sections can collapse and remember their state per object kind. The scroll
  position is kept across selections.
- *Header*: the selection's name ("Text box", "Picture", "3 objects", "Slide 4") and an explicit **✕** to close the
  column. Format | Ask is a persistent two-way segmented control (the existing Segmented component). Without AI set up,
  it is a plain **Format** toggle button. ⌥⌘I opens Format; ⌘J opens Ask.
- *With Ask open*, selecting objects adds a context chip ("Title box") to the composer instead of switching modes.
  The floating text bar still works while editing text, and Format is one click away.
- *Section order follows the selection* (Codex finding 20):
  - **Text object**: **Text** (font, size pt, weight, B/I/U, colour, align, vertical align, bullets, numbering, indent),
    then **Fill · Border**, then **Arrange**.
  - **Shape**: **Fill · Border** (fill colour/none; border colour/width/none; corner radius for rectangles), **Effects**
    (opacity; shadow off/soft/hard), **Text** (if it has text), **Arrange**.
  - **Picture**: **Picture** (Replace, which keeps the frame), Border, Effects, Arrange.
  - **Multiple**: **Arrange** shows the **union** bounds (typing W resizes the union proportionally). Align and
    distribute: left, centre, right, top, middle, bottom; distribute horizontally/vertically. Group (⌘G),
    Ungroup (⌘⇧G). Shared style sections show "Mixed" for member properties that differ.
  - **Nothing selected → Slide**: background colour, missing fonts ("Calibri isn't available here; showing a similar
    font. Exports keep Calibri."), and **Objects on this slide**: the object list (PowerPoint's Selection Pane), with
    names, order by drag, lock and hide toggles.
- *Arrange* (every object): X, Y, W, H in the locale's unit (in for en-US, cm elsewhere); typing "px", "pt", "cm" or "in"
  also works. Angle in °. Arithmetic is accepted (`120+40`, `*2`); invalid input reverts with a shake-free red underline
  and the hint "Use a number like 2.5cm". Bring forward / Send backward (⌘] / ⌘[, ⌥ for to front/back). Align to
  slide. Lock (⌘⇧L).
- *Values the controls can't represent* (imported gradients, picture fills, custom shadows, glow): a read-only chip
  ("Gradient", "Custom shadow") with **Replace**. The original stays untouched until the user picks something.
- *Reaction*: fields commit on Enter or blur and Esc reverts. Arrows step by 1 (⇧ 10) in the field's unit. Label scrubbing
  changes the value with live preview. **One transaction per completed scrub or picker session.** The colour popover is
  solid paper: deck colours, recent colours, a picker and hex input.
- *Motion*: none when content swaps on selection change.
- *Preserved object* (chart, SmartArt or another payload domOXML keeps): Arrange only, plus "Kept exactly as in PowerPoint.
  You can move, resize and reorder it." Thanks to per-node IR (contract 2) that stays true whatever else on the slide
  changes.

### Slide rail
- **States**: the *displayed* slide (on the stage), the *selected set* (highlight) with its range *anchor*, and keyboard
  *focus* are separate. Click sets all three. ⇧-click extends from the anchor and ⌘-click toggles; neither changes
  the displayed slide unless it's the clicked one.
- **Reorder**: dragging moves the selected block (contiguous result) with an insertion line and edge auto-scroll; Esc cancels.
- **New slide** (button under the last thumbnail, ⌘↵, context menu): duplicates the current slide's layout. That means
  its title box empty with a "Click to add title" placeholder, its body box empty if it has one, and the same
  background. A ▾ beside it offers **Blank**.
- **Delete** (Delete/Backspace when the rail is focused, or the context menu) removes the selection, with Undo. Focus
  moves to the next slide, or the previous one at the end. Deleting the last remaining slide leaves one blank slide.
- **Context menu**: New slide, Duplicate, Delete, Move up/down.

### Keyboard and focus
- **Regions**: header, rail, stage, column (Format or Ask). F6 / ⇧F6 cycles them, as in Office. Tab / ⇧Tab
  move between controls inside a region. On the stage, Tab cycles objects in z-order.
- **Esc ladder**:
  1. cancel drag
  2. end text editing
  3. exit group
  4. clear selection
  5. nothing

  Leaving the deck is only the ← button or ⌘[ with nothing selected. Esc never leaves.
- **Arrows**: nudge when the stage is focused with a selection. They change slides when the rail is focused, or when
  the stage has no selection. PageUp/PageDown always change slides.
- Editor shortcuts are matched on the composed event path, so a key inside a slide's shadow-root text editor is handled
  as text first.
- **Accessibility**:
  - The stage is a `group` labelled "Slide 4 of 12". Each object is a focusable item announced by its kind and text
    ("Text box: Q3 review"), replacing the viewer's `role="img"`.
  - Selection changes are announced politely.
  - The focus ring sits outside the selection frame.

### Undo/redo, zoom, clipboard, Present
- **Undo/redo**: ↶ ↷ in the header (disabled when there's nothing to undo or redo). Behaviour follows contract 5.
  Undo restores the selection the transaction had.
- **Zoom**: a solid Mica cluster at the stage's bottom-right: ⊖, percentage (menu: 50, 100, 200, Fit), ⊕. Range
  10–400%. ⌘= / ⌘- zoom around the stage centre; ⌘0 fits and ⌘1 goes to 100%. A slide switch keeps the zoom level and
  re-centres. Opening the column keeps the slide centre fixed. Zoom isn't persisted.
- **Clipboard**:
  - Copy writes `text/html` holding a versioned fragment, marked with `data-ream-clip="1"`. The fragment carries the
    objects' HTML, their source slide size, blob refs and their original IR nodes, so a preserved chart pastes as a chart.
    A `text/plain` fallback is written too.
  - Paste gives pasted objects new ids. On the same slide it offsets by 12px; on another slide it keeps the position.
    Text-edit paste takes precedence.
  - External pictures paste as pictures and plain text pastes as a text box.
  - Cut deletes only after the copy succeeded. If clipboard access is refused: "Ream can't use the clipboard here.
    Use ⌘C / ⌘V."
  - ⌘D duplicates in place with a 12px offset.
- **Present** (button, ⌘↵ in the header, F5): commits any edit, then enters a dedicated presentation mode. That means
  fullscreen, editor chrome and overlays hidden, the slide fitted, and presentation keys (→ Space click next, ← back,
  Home/End, number+Enter). Esc returns to the editor with the same slide, selection and zoom. If fullscreen is refused,
  it fills the window instead, with a small Exit control.

### States
- **Empty deck**: one slide built from the default layout (title placeholder), never an empty page.
- **Engine cold**: editing never waits for the engine. Only export, and paste from PowerPoint (phase 2), wait for it.
- **Importing or failed deck**: not editable; the existing deck card states apply.
- **Another tab owns the library**: the existing "Open in another tab" screen.
- **Reduced motion**: guide fades become instant; no zoom easing.

### Alignment
- Materials: header, rail, column, zoom cluster: Mica. Floating text bar: the only acrylic. Readout chip, distance pills and
  colour popover: solid paper. Slide: paper. Toasts: solid (DESIGN.md).
- Motion: no motion on content or geometry; guide and readout fades only.
- Copy: sentence case, verbs on buttons, PowerPoint's nouns where users know them ("Picture", "Bring forward", "Group").

## Review round 1 triage (Claude subagent "C", Codex `high` "X")

Accepted and folded in above:
- **C1/X1** per-node exactness → contract 2.
- **C2** no Python on the interaction path → contract 2 (export-time batch).
- **C3/X4** transactional history → contract 5.
- **C4/X3/C13** concurrency → contract 6.
- **C5/X2** working copy and honest saving → contract 4.
- **C6/X6/C18** focus regions, Esc ladder, arrows → Keyboard.
- **C7/X12/X23** one shared column, explicit close, no hidden third state, width rules → Layout, Format column.
- **X5** agent state outside the panel → contract 6.
- **C8/X7** bullets kept and toggled, groups and table text, lines and arrows removed from phase 1, New slide from layout,
  spelling → phase 1.
- **X9** group/ungroup, lock, align/distribute → phase 1.
- **C9/X17/X19** coarse pointers → viewer; handle hit areas; shell switching.
- **C10** units → Arrange.
- **C11** unrepresentable values → read-only chip.
- **C12** blobs → contract 3.
- **C14/X8** text history, IME, auto-grow, three formatting targets → Text editing.
- **C15/X17** halo and magenta guides → Selection, Smart guides.
- **C16/X21** solid readout and popover; one glass surface; toast is solid.
- **C17/X22** no geometry motion, snap priority and release.
- **C19/X12** header collapse order.
- **C20/X13** contain fit; zoom rules.
- **X14** hit testing, select-under, object list.
- **C21/X15** clipboard format, ids, failures.
- **X16** rail states.
- **X18** Present mode.
- **X20** section order by selection.
- **C22** missing fonts.
- **X11** union geometry and transform rules.

Deferred or rejected:
- **X10 picture crop in phase 1 → deferred to phase 2.** Phase 1 keeps the frame on Replace and stores originals at full
  resolution (the other half of X10). Crop needs domOXML's crop mapping in the UI, which is its own design.
- **C9 "move light mobile editing to phase 2" → accepted.** It's in phase 2.
- **Bolder: "Ask about this shape" field in Format (C) → deferred.** The context chip covers the need now; revisit after
  real use.
- **Bolder: live export status per shape (C, X) → phase 2**, together with the capability checker.
- **Bolder: formatting dock above the stage while Ask is open (X) → rejected.** It duplicates the floating text bar and
  the Format column. A third formatting surface breaks "one place for each thing".
- **Bolder: duplicate-and-repeat (X) → phase 2.**
