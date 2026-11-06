# ui/: primitives

Domain-agnostic building blocks. They know nothing about decks or folders. **Check this list before
writing any markup with its own styling; if what you need is missing, add it here, never inline it in a screen.**

| Primitive | Use for | Notes |
|---|---|---|
| `Button` | Every labelled button | `variant`: primary · secondary · ghost · danger; `size`: md (34) · lg (44, mobile) |
| `IconButton` | Every icon-only button | Required `label` (aria + tooltip); `size` sm/md/lg; `tone` fill/plain/glass |
| `TextButton` | Mobile header text actions ("Select", "Done") | iOS style, 44px tall |
| `BackButton` | Mobile back | Always visible alongside edge-swipe |
| `Kbd` | Shortcut hints | |
| `Tooltip` | Desktop hints on any control | 450ms delay, instant on keyboard focus, never on touch |
| `Menu` | Context and ⋯ menus, sort menus, Move to…, pickers (desktop) | Glass; arrow keys, type-ahead, returns focus; `search` adds a filter field for long lists; items take `selected` (check) |
| `Segmented` | 2–4 mutually exclusive options | Sliding thumb (`layoutId`) |
| `Overlay` | Any modal surface | Smoke, focus trap, Esc, focus return |
| `Sheet` / `SheetActions` / `SheetTitle` | Every mobile bottom sheet | Drag-to-dismiss from grabber, velocity-aware |
| `LargeTitle` | Every mobile screen header | Collapses into a solid bar |
| `SearchTrigger` | Desktop search pill | Opens the palette; not a second search |
| `Toaster` | Toast region (one per shell) | Use `toast()` from `data/toasts`, never a custom banner |
| `FileMarks` (`PptxMark`, `HtmlMark`, `DeckGlyph`) | Format marks | Faithful format badges |
| `Brand` (`BrandLockup`, `BrandMark`, `PRODUCT`) | The product name (Ream) and mark | Never hard-code the name; use `PRODUCT` |

Styling lives only in each primitive's `.module.css`, using tokens from `styles/tokens.css`.

Added for Settings and sync (2026-11-05):

| Primitive | Use for | Notes |
|---|---|---|
| `Notice` | In-flow notices (reconnect, storage permission, storage full) | Paper, scrolls with content, ≤2 actions, optional dismiss |
| `Dialog` / `Modal` / `Confirm` / `confirm()` | Modal decisions; every irreversible action | `Modal` = Dialog on desktop, Sheet on mobile. `await confirm({...})` from anywhere (one `ConfirmHost` per shell); focuses Cancel; names exactly what happens |
| `Switch`, `TextField` | Settings controls | 44px+ on mobile |
| `SettingGroup` / `SettingRow` | Every settings screen | Label + description left, control right; stacks on mobile |

Added for the deck editor (2026-11-06):

| Primitive | Use for | Notes |
|---|---|---|
| `Inspector` (`Section`, `Row`, `NumberField`, `ColorWell`, `KeptChip`) | Properties panels (the editor's Format column) | `NumberField`: units and arithmetic via `parse`, Enter/blur commit, Esc revert, arrows step, label scrubbing. `ColorWell`: solid paper popover (deck colours, recent, picker, hex). `KeptChip`: a value the controls can't show, with Replace |

Added for the v3 editor layout (2026-11-06):

| Primitive | Use for | Notes |
|---|---|---|
| `Popover` | Property forms and galleries anchored to a button | Solid paper, viewport-clamped; Esc returns focus to the button; any outside click closes it after committing a half-typed field; child layers (`data-ream-layer`: colour popover, menus, dialogs) don't dismiss it |
| `Toolbar` | Any horizontal strip of controls | ARIA toolbar: one tab stop, ←/→/Home/End between controls (not inside text fields); `ref.focus()` returns to the last control |
| `Slider` (in `Inspector`) | Bounded values: opacity, widths, radii, durations, angles | Native range (keyboard and screen readers); live `onPreview`, one `onCommit` on release; readout in the value's unit |
| `FlatSections` (in `Inspector`) | Sections inside a popover or dialog | `true`: heading + rows, always open; `'bare'`: rows only |
