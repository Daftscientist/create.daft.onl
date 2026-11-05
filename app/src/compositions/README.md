# compositions/: reusable assemblies

Domain-aware structures built from `ui/` primitives. Shells (`desktop/`, `mobile/`) only arrange these.
**Before building anything in a shell, look here. If two places need the same structure, it belongs here.**

| Composition | What it is | Used by |
|---|---|---|
| `Collection` | THE desktop file browser: selection, keyboard map, context menu, rename, Move to…, drag-to-folder, selection bar | Recents, Files, Starred, Trash |
| `EntryTile` | Grid tile for a deck or folder (all states) | Collection (grid) |
| `EntryRow` | Desktop list row | Collection (list) |
| `DeckThumb` | Any slide or cover, with importing/failed states | Everywhere a slide is shown |
| `PageHeader` / `SectionHeader` / `EmptyState` | Desktop page title, section title, designed empty states | All desktop views; EmptyState on mobile too |
| `ViewTools` | Sort menu + grid/list toggle | Every collection header |
| `SelectionBar` | Floating batch bar (desktop) | Collection |
| `CommandPalette` | ⌘K | Desktop |
| `search` (`useSearch`) | The search model: decks, slides, folders, actions | CommandPalette, mobile SearchSheet |
| `commands` (`commandsFor`) | The one command inventory | Context menus (desktop), ActionSheet (mobile) |
| `ActionSheet` | The command inventory as a mobile sheet | Mobile rows, viewer |
| `FolderSheet` | Move to… on mobile | Mobile |
| `QuickLook` | Space preview | Desktop |
| `DropVeil` | External .pptx drops | Desktop |
| `importPicker` (`pickPptx`) | The one way to pick files to import | Every Import button |
| `dnd` | Shared drag state + spring-loaded dwell | Collection, Sidebar, DropVeil |
| `MobileList` / `MobileSection` / `MobileRow` | Mobile lists (tap, long-press, swipe, select) | Every mobile screen |
| `ContinueCard` | Resume-where-you-were hero | Mobile Recents |
| `LibraryGate` | Startup states: opening, open in another tab, moved, storage unavailable | App root |

Added for AI (2026-11-05):

| Composition | Use for | Notes |
|---|---|---|
| `AiMark` | Every AI provider logo (settings rows, pickers, chips) | Tile like `ProviderMark`; `bare` for inline. Covers the browser's built-in model |
| `ModelPicker` | Choosing the Ask Ream model, anywhere | `chip` (panel header) or `field` (settings). Lists the built-in model and every connected provider's models |
