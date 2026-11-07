# Projects (spec)

Status: building v2 (chat-first), 2026-11-07. Replaces folders. v1 (files grid + docked chat) was built, captured and dropped.

## The idea (from the user)
Instead of folders you make **projects**. Each project has **a chat** and **files** under it; files open into the
same editors as now. Later: a memory per project.

## Model
- A project is the existing folder entry (`type: 'folder'` in storage and sync, so nothing migrates on disk or in
  the cloud), shown everywhere as "Project". Projects are flat: they live at the top of the library and hold decks.
- Decks can also sit outside any project ("Not in a project"), which is where Home's New deck and old loose decks go.
- **Migration**: a folder inside another folder moves to the top, becoming its own project with its decks. Nothing
  is deleted or merged; an old client syncing a nested folder later gets flattened the same way.
- The project chat is stored like a deck's chat (`chats[projectId]`, synced as `ream.c.<id>.json`), per account.
- Future (not built): project memory (notes the chat keeps), project instructions.

## Project chat (data/ai/projectAgent.ts)
Same models, keys, reasoning picker and usage as Ask in a deck. It sees the project's brief (every deck's name,
slide count, when changed, and its slide titles). Tools, each with a ≤4-word activity:
- `read_deck(deck)`: every slide's text and notes (fetches a cloud-only deck first).
- `edit_deck(deck, request)`: hands the request to the deck agent (the same one as Ask in the editor) on that deck;
  returns what it said and which slides changed.
- `create_deck(name, request)`: a new deck in the project, built by the deck agent from the request.
- `rename_deck`, `move_into_project(deck)` (a deck from outside the project), `rename_project`.
Turns record each deck they changed with its slides before, so each gets **Undo** (a created deck goes to Trash) and
**Open**. Stop aborts the run and any deck work inside it.

## Surfaces (v2, 2026-11-07: chat-first, after the user: "it'll just fully be like a chat")
References: Claude Projects (project title, then the reply box, knowledge files in a right column), NotebookLM
(sources column beside a centred chat, columns collapse to a rail when narrow), ChatGPT Projects (project chats
under the project; its 2026 redesign that hid the project page was widely disliked: keep a real project page),
Cosmos (one calm centred field as the entry). Ream's own Home prompt box is the composer's look.

### Desktop project page (`/projects/:id`)
```
┌ sidebar ┐┌──────────────────────── panel (Mica) ────────────────────────────┐
│         ││ [⌕ search]                                   [Import] [New deck] │
│ Projects││ Projects ›                                                        │
│ ▸ Finance││ Finance                                 ┌ Files · 4 ──────── + ┐│
│         ││ (empty: centred title, line, composer,   │ ▭ Q3 review     2h   ││
│         ││  grounded idea chips)                    │ ▭ Board update  Tue  ││
│         ││                                          │ ▭ Pricing v3    Oct  ││
│         ││  you ▸ bubble, right                     │ drop .pptx here      ││
│         ││  Ream ▸ prose, markdown, deck cards      └──────────────────────┘│
│         ││ ┌──────────── composer (paper, r=panel) ────────────┐            │
│         ││ │ Ask about Finance…               📎 model  ↑     │            │
└─────────┘└──────────────────────────────────────────────────────────────────┘
```
- **Conversation column**: centred, max 720px, in the space left of the files column. Header row: crumb
  "Projects ›", the editable title (button → input; Enter/blur commits, Esc reverts, blank ignored; Rename also in
  the sidebar/tile menu), and on the right "New chat" (icon, disabled when empty or running).
- **Empty project chat**: vertically centred block: title is already above, so: one line ("Ream knows the 4 decks
  in Finance. Ask about them, change them, or make new ones." / no decks: "Make the first deck by describing it.")
  then the composer in the middle (not at the bottom), then idea chips (pill, `--fill`, like Home's ideas). Ideas are
  grounded: with decks, they name them ("Summarise Q3 review and Board update"); without, they're creation prompts.
  No model: the line says Ream uses your own AI account, with "Set up AI" (link to Settings → AI) in place of chips.
- **With messages**: composer docks to the bottom of the column (sticky, with a fade of the panel colour above it);
  the thread scrolls with the page. You: right-aligned bubble (`--fill-2`, radius 18/18/6/18, 15px/22px), attached file
  names under it. Ream: no bubble, prose at 15px/24px with markdown (paragraphs, **bold**, *italic*, `code`, lists,
  headings as 15px semibold, links open in a new tab), streaming as it arrives. Steps fold into one quiet line
  ("Read 2 decks · 4 steps", expandable), the live activity line as in Ask (≥1.6s per line, deck name on its own small
  line above the activity when the work is inside a deck). Turn meta (time, stopped) in 12px `--ink-3`.
- **Deck cards** (what a turn did): paper card per deck, 16:9 cover 132px wide (live), name (15px semibold), what
  happened ("Made · 8 slides", "Slides: 2 edited, 1 added"), "Open" (secondary button) and "Undo" (ghost). While
  the turn runs: cover updates live, "Making…/Changing…", Open disabled with tooltip "Opens when Ream is done";
  undone → 60% with "Moved to Trash"/"Undid these changes". Undo refuses (toast) when the deck changed since.
- **Files column**: 300px Mica card on the right, full height (sticky), header "Files · 4" with + (New deck) and
  upload (Import) icon buttons. Compact rows: 64px cover, name, "2h ago · 6 slides"; click opens (single click: this is
  a list of links, like Claude's knowledge list), ⋯/right-click gives the usual deck menu (Rename, Duplicate, Move to
  project, Download, Star, Trash). Drop .pptx or drag decks from the sidebar/Projects onto it. Empty: "No decks yet.
  Drop .pptx here or ask Ream to make one." Grid view of the files lives on nothing else: the column is the file list.
- **Narrow (< 1100px)**: the files column folds into a "Files · 4" button in the header row that opens it as a
  right-hand sheet over Smoke (Esc/outside closes). The conversation takes the full width.
- **Keyboard**: the composer has focus on arrival when there are no messages; ⌘J focuses the composer; Esc in an empty
  composer blurs. ↵ sends, ⇧↵ newline. Stop replaces Send while running (and Esc while running in the composer stops).
- **Leaving while running**: the run stops and the turn is kept as "Stopped" with what it changed (Undo still works).

### Projects page (`/projects`)
Grid of project tiles (folder art, newest-changed deck as the peek cover, name, "4 decks"). "Not in a project"
follows directly below as its own section (no dead space between them). "New project" in the header.

### Mobile
- Tab "Projects". Projects screen: Starred, Trash, storage card, "Projects" list, "Not in a project" list.
- **Project screen = the chat**, full screen of its own (tab bar hidden): top bar Back · project name (tap to rename
  sheet) · "Files" pill with the count (opens a bottom sheet of the project's decks: tap opens, ⋯ actions, Import).
  Thread as desktop at 16px/24px; composer pinned above the home indicator (safe area), 16px input (no zoom on focus),
  attach + model chip ≥44px hit areas, Send 44px. Empty state centred like desktop with ideas as full-width rows.
- Keyboard open: the composer stays on top of the keyboard (`interactive-widget=resizes-content` and `100dvh`), the
  thread keeps its bottom anchored.

## States (binding, replaces the v1 list)
| | Line under the title | Ideas (fill the composer, never send) | Files list |
|---|---|---|---|
| Decks, model set | "Ream can read, change and add to the N decks in X." | Summarise the 2 newest (names cut at 24), what's missing across them, one-page overview | Rows |
| No decks, model set | "Describe a deck and Ream will make it here." | Creation prompts | "No decks yet. Drop .pptx files here, use Import, or ask Ream to make one." |
| No model | "Ream works with your own AI provider account. Add one to start." | "Set up AI" button | as above |
Project trashed while open: "This project isn't here any more" + Go to Projects. Remote-only deck: fetched on read/edit;
offline → the tool says so and the model reports it. Leaving the page never stops a run (Stop, or the project going).

## Review v2 (2026-11-07): Claude subagent (22) + Codex high (16), pre-build
Accepted and built: runs live in data/projectRuns.ts (survive navigation; Open and file rows work mid-run); several
chats per project (`chats["<projectId>~<id>"]`, titled by the first message; New chat keeps the old); drafts kept
per account and project; ideas fill the composer; one empty-state table; the title centred over the composer when
empty, in the header once the chat starts; fixed header (the thread scrolls, not the page); files list with arrows,
Enter, Space (Quick Look), F2, ⋯ / right-click menu; order frozen while a run is going; side column folds below 1280px
into a "Files" sheet; markdown answers with Copy and Ask again; inline error with Try again; "New activity" pill; a
polite status region (start, finish, stopped, problem); undone cards keep full contrast with a label; no duplicate
creation buttons (top bar New deck / Import target the project); phone: the chat is the screen, composer always at the
bottom, sized by visualViewport (iOS), 16px text, 44px targets, name menu (Rename, New chat, Chats and files);
`--r-bubble` tokens. Deferred: undoing renames/moves, per-slide revert on Undo, per-deck queued/failed receipts and
"continue unfinished work", coverage disclosure and slide citations, a "show as grid" view of a project's files with
batch selection, one-rule .pptx drop veil on the conversation, a model-can't-use-tools state, model catalogue on solid
material (contrast). Rejected: none.
