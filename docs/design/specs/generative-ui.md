# Interactive answers with OpenUI (proposal v2)

Status: **proposal, needs the user's approval before any build**, 2026-11-07. v1 of this proposal was reviewed by a
Claude subagent (21 findings) and Codex high (26); v2 below has every confirmed finding folded in (triage at the end).
From the user: "use https://www.openui.com/ … sort out the component list and how we can fit it with our UI really
nice, and work out how self-contained experiences (interactivity) can actually work: local state, conversational
actions, host actions … I'll have to approve first, this is a big moment."

## 1. What it is
Ream's answers (project chat first) can contain small **live pieces of interface** between the prose: a comparison you
can sort, a scenario with a slider, a chart of numbers from your decks with the slides it came from, a choice to make.
They're drawn with Ream's own components and keep working after the answer ends.

**OpenUI** (Thesys, MIT, `@openuidev/react-lang` + `@openuidev/lang-core` 1.1.0) supplies the language and the runtime;
we supply every component. The model writes **OpenUI Lang**, a compact one-statement-per-line language
(`root = Card([stat, chart], "Runway")`), inside ```` ```openui-lang ```` fences. It streams (frame first, then
contents), and it is an expression language over our components: literals, references, operators, ternaries,
`@Each`, `$state` and the functions/actions we allow. No JavaScript runs, no HTML is rendered, no iframe is needed.

## 2. Ground rules (the boundaries)
| Boundary | Rule |
|---|---|
| **Computation** | Everything a block does (sliders, tabs, sorting, totals) runs in the browser. No model call, no network. |
| **What reaches the AI provider** | Only what you send: a message you typed, or a button's message that you can read on the button before pressing it. The values in a block go with it only when you press one of its buttons, and the bubble shows them. |
| **What's saved and synced** | The answer (prose + block program) with the chat, as today. A block's current values (slider positions, picks) are saved per block, separately from the conversation, when you let go of a control (not on every movement), and sync with the account like the chat. |
| **Changes to your work** | Never directly from a block. A block can only *draft* a request into your message box (with the decks and data it concerns shown); you press Send. The agent then does it with its usual Open/Undo cards. |
| **Links** | One policy for every link Ream shows (prose and blocks): the "Open example.com?" sheet with the full address, http(s) only. (Or no links at all: decision 2.) |
| **Snapshots** | A block shows the data it was made with. It never silently updates while the prose next to it stays the same. (Refreshing from decks is phase 2, as an explicit button that shows what changed.) |

## 3. How it fits Ream
- **Material**: a block is content, on **paper** (`--paper`, `--shadow-tile`, hairline, `--r-md`) in the 720px reading
  column. One paper level (inner groups use hairlines). Never glass. A small 12px `--ink-3` line under each block,
  "Made in this answer", so it reads as Ream's output, not the app's own controls.
- **Charts** keep document colours: drawn on a white inner chip exactly like a slide (VISION: documents are paper and
  keep their colours in both themes), so labels pass contrast in dark mode, and a chart can later move onto a slide
  unchanged. "Show data" turns any chart into its table.
- **Type**: 15/24 prose, 13 labels, tabular figures. **Tones** always pair an icon with the colour (info, check,
  warning, x-circle) and use tested foreground tokens for small text (current `--ok` on white is 3.4:1: a darker text
  token gets added and measured).
- **Buttons** in blocks are never primary-styled, and always show what they do: a glyph and a verb ("Ask Ream",
  "Draft request", "Copy", "Download .csv", "Open deck", "Open link ↗").
- **Motion**: a block's first appearance uses the existing 160ms fade (not `gentle`, which is a layout spring); its card
  keeps the height of its first parse and grows once as content settles (no jumps under the follow-scroll). Reduced
  motion (system or in-app): 150ms cross-fade, no transforms anywhere inside blocks. No entrance replay on reload.
- **Phone**: every horizontal arrangement has a phone form: Columns stack; button rows wrap full-width; Tabs scroll as
  a bounded strip; source lists go vertical; tables scroll sideways inside the card, starting 16px in (edge swipe stays
  Back), with a visible fade; Select opens a sheet; sliders come with a number field; all targets ≥44px; inputs 16px
  and kept above the keyboard and composer.
- **Failure**: per node, never silent. If anything in a finished block couldn't be drawn, the block says so ("1 part
  couldn't be shown") and disables actions that depend on it. **Regenerate** for broken programs, **Retry** for sources
  that couldn't be read; code only under "Details". An unfinished block (stopped, reloaded mid-stream) stays inert with
  "Unfinished".

## 4. Component list (Ream library v1)
Required content first, optional presentation last (positional arguments). Shapes are typed so tables sort and align
correctly. All are `defineComponent`s; the prompt is generated from them.

**Structure**
| Component | Props | Notes |
|---|---|---|
| `Card` | children[], title?, actions[]? | Always the root of a block. `actions` = a footer row of Buttons |
| `Stack` | children[], direction?, gap? | down/across; across wraps on phones |
| `Columns` | children[] (2–3) | Stacks on phones |
| `Tabs` | tabs[] of `Tab(label, children[])` | Real tablist: arrow keys, linked panels; chosen tab saved |

**Content**
| `Text` | markdown | Our renderer; links go through the link policy |
| `Callout` | text, tone?, title? | Tone always with its icon |
| `KeyValues` | pairs[] of [label, value] | |
| `List` | items[] of [title, detail?] | |

**Data**
| `Stat` | label, value, change?, note?, goodWhen? ("up"/"down") | `change` is a number: ▲/▼ plus colour by `goodWhen` |
| `Table` | columns[] of {label, type: text/number/money/percent/date, unit?}, rows[][] of raw values, sortable? | Numbers right-aligned, `aria-sort`, first 8 rows then "Show all N" in place; ragged rows are an error, not padded |
| `Chart` | type (column/bar/line/pie), categories[], series[] of {name, values[]} | Validated (lengths match, one series for pie, no empty pie); white chip; "Show data"; `role=img` + summary |
| `Progress` | value, max, label | |

**Sources** (your work, by stable id, not by slide number)
| `SlideRef` | deckId, slideId | Opaque chip of that slide; opens Quick Look there. States: in Trash, not on this device (fetched on open), slide removed |
| `DeckRef` | deckId | Live cover, name, slide count; opens the deck |
| `Sources` | refs[] | "From: [chip] [chip] [chip]" under a claim or a chart. The model is told to cite the slides any number came from |

**Inputs** (two-way `$bindings`, all with a visible label, help/error text, and a restored value)
| `Slider` | label, $binding, min, max, step?, format? | Paired with a number field; `aria-valuetext` uses format |
| `NumberField` | label, $binding, min?, max?, step?, format? | Invalid drafts shown, not coerced |
| `Choice` | label, $binding, options[] of {id, label, detail?}, multi? | Readable radio/checkbox rows with explanations |
| `Select` | label, $binding, options[] of {id, label} | Listbox; a sheet on phones |
| `Segmented` | label, $binding, options[] of {id, label} | Radio semantics; 2–4 short options |
| `Toggle` | label, $binding | |
| `TextField` | label, $binding, placeholder?, multiline? | |

**Actions**
| `Button` | label, action, kind? ("ask"/"draft"/"copy"/"download"/"open"/"link") | `action` is required (no silent "send the label" default); `kind` sets the glyph/verb; never primary |

**Functions** (pure, our own; OpenUI's built-ins `@Sum @Avg @Min @Max @Round @Count` etc. are used as they are):
`@Money(n, currency, places?)`, `@Percent(part, total, places?)` (total 0 → "–"), `@Compact(n)` ("1.2k", "4.3m").

**Cut from v1** (decoration or not yet needed): headings beyond Card titles, dividers, badges, quotes, timelines,
images/anything loaded from a URL, HTML, video, maps, uploads, dates pickers, `Mutation`s.

## 5. Interactivity
### 5.1 Local state
`$variables`, `@Set`, `@Reset`, ternaries, `@Each`, functions, two-way bindings. Instant, in the browser.
```openui-lang
root = Card([seats, Columns([perSeat, usage]), Sources([s1])], "Seats vs. usage", [ask])
$seats = 40
seats = Slider("Seats", $seats, 5, 200, 5)
perSeat = Stat("Per-seat plan", @Money($seats * 12, "GBP"))
usage = Stat("Usage plan", @Money(300 + $seats * 7.5, "GBP"), null, $seats * 12 > 300 + $seats * 7.5 ? "Cheaper here" : "Dearer here")
s1 = SlideRef("d-pricing", "s-3")
ask = Button("Which plan suits a 60-seat customer?", @ToAssistant("Which plan suits a 60-seat customer?"), "ask")
```
Saved per block (keyed by block id = turn + hash of its program) when a control is released, in its own record (so it
never overwrites a conversation another device changed), and adopted from other devices unless you're touching it.

### 5.2 Conversational actions: Ask and Draft
- **Ask** (`@ToAssistant`): sends the button's message as your next message **only if the message is the label** (the
  gate enforces it; a mismatch makes the button do nothing and flags the block). The bubble shows "from Seats vs.
  usage" and, under Details, the block's current values *by label* ("Seats: 60"), and only the values that block uses.
  A turn started this way is **read-only**: the agent gets no tools that change decks for it, so a planted button in a
  third-party deck can't edit anything.
- **Draft** (custom `@Draft(message)`): puts the request in your message box with chips for the decks and the frozen
  data it refers to ("Chart: Seats vs. usage at 60 seats"), focused, for you to edit or send. Sending it is an ordinary
  turn with full tools and Undo. This is how "Add this chart to Q3 review" works.
- In the model's context, block-origin text is marked as coming from a button in Ream's own answer, and any deck text
  it carries is delimited as data, never as instructions.

### 5.3 Host actions (one gate for all)
Delivered to a Ream-owned **action gate** that checks the block (id, version, finished, not unfinished), validates the
arguments (zod), and allows **at most one effect per click** (any number of `@Set`/`@Reset` plus one of these), taking
the busy lock immediately so a double click can't fire twice:
| Action | Effect |
|---|---|
| `@OpenDeck(deckId)` | Opens the deck (decks in this project only) |
| `@OpenSlide(deckId, slideId)` | Quick Look at that slide |
| `@Copy(text)` | Copies; the toast shows what was copied (first 60 characters) |
| `@DownloadCsv(name, tableRef)` | Saves the table *as currently shown* (sort, filter); numbers stay numbers; text cells starting `= + - @` tab/CR are prefixed `'`; filename `[\w .-]{1,60}.csv` |
| built-in `open_url` | The link sheet (or "Links are off" if decision 2 says so; then the prompt never teaches links) |

### 5.4 Live data
None in v1 (blocks are snapshots, §2). Phase 2: a revision-aware Query adapter that subscribes to the decks a block
cites, marks the block "Sources changed", and offers **Refresh** showing what changed; scoped to the chat's project.

## 6. Model side
- Prompt: `library.prompt({ preamble: <Ream's prose-first preamble>, bindings: true, builtinFunctions: true,
  inlineMode: false, additionalRules })` plus our own fence section: prose first; a block only when it does something
  prose can't (numbers to explore, a comparison, a choice, sources); at most one block per answer unless asked; small (a
  card, not a dashboard); every block self-contained (no patches); cite slides for any number; never invent data. The
  generated prompt is snapshot-tested and its size measured before shipping (budget ≤2.5k tokens).
- `read_deck` returns stable slide ids so the model can cite them.
- History: older blocks go to the model as a one-line summary with their current values ("[block 'Seats vs. usage':
  Seats 60]"); only the latest block's full program is sent. So "what about 120 seats?" uses what you actually set.
- Not offered to the in-browser model (too small). A model that writes broken blocks gets the visible failure line.
- Transcript adapter (ours, not OpenUI's merging extractor): the turn's text is joined across tool steps, then split
  into prose and exact ```` ```openui-lang ```` fences; each fence gets a stable id and its own state:
  streaming → finished (as soon as its closing fence arrives, even while the turn keeps working) → valid/invalid;
  unclosed after Stop or reload → Unfinished (inert). Other fence tags stay code blocks. Copy gives the prose plus a
  plain-text version of each block.

## 7. Privacy, safety, performance
- **No network from OpenUI in the app**: lang-core's runtime telemetry returns before sending in a browser (verified in
  source). react-lang auto-mounts devtools in development and that loads an unpinned script from jsDelivr into our
  origin: we alias `@openuidev/devtools` to an empty stub in Vite, set its auto-mount flag before load, pass
  `publishObservability={false}`, add a dev CSP without jsDelivr, and test that dev and prod make no OpenUI requests.
- **Installing**: lang-core's postinstall sends PostHog a pseudonymous project id (a salted hash of the public repo
  origin, reversible), Node/OS details and the IP, and writes `~/.config/openui/telemetry.json`. `.npmrc` can't set the
  env vars that stop it. Recommended: **vendor** the pinned `dist/` of both packages into `app/vendor/openui/` (no
  install scripts ever run; versions pinned and auditable), imported through a Vite alias. (Decision 1.)
- **Versioning**: each block stores its library version and program hash. Props are append-only (new ones optional, at
  the end; breaking changes get a new component name). A golden corpus of saved programs renders on every library
  change. A block from an unsupported version shows as an inert saved result with Regenerate.
- **Limits, enforced before and during rendering**: 16 KB of program per block, strings ≤2k characters, ≤400 rendered
  nodes after `@Each` expansion, ≤200 table rows, ≤500 chart points, nesting ≤4, ≤3 blocks per answer. Over a limit,
  the block is refused with a reason (never quietly cut, which could change a result).
- **Performance**: OpenUI loads with `import()` the first time a fence appears; turns and blocks are memoised (a
  streaming token doesn't re-render old blocks); streaming parses are throttled to ~10/s; off-screen blocks use
  `content-visibility: auto`.
- **Accessibility**: per-component keyboard/semantics contract (tablist, listbox, radio rows, slider keys and value
  text, `aria-sort`, labelled scroll regions, chart summaries with data tables); one polite live region per block that
  announces changed results ("Per-seat plan £720, Usage plan £750") at most every 750ms, separate from the chat's log;
  streaming never moves focus.

## 8. Phases
1. Everything above: components, local state, Ask/Draft, the action gate and host actions, links policy, sources,
   saved values, versioning, limits, failure states, phone forms. Project chat only. A dev gallery
   (`?preview=genui`) with every component in every state, light/dark/phone, reviewed before the model ever sees it.
2. Refresh from decks (live data), "Put on a slide" for charts/tables (direct, with Undo), blocks in deck Ask.
3. Pin a block to the project (a saved view beside Chats/Files): the start of project memory.

## 9. Decisions for the user
1. **Dependency**: vendor OpenUI's pinned files into the repo (recommended: nothing runs at install, no telemetry), or
   install from npm with install scripts disabled?
2. **Links**: allow links out of answers and blocks behind the "Open example.com?" sheet (recommended), or no links?
3. **Changes from blocks**: always drafted into your message box for you to send (recommended), or allow direct
   actions like "Put on a slide" with Undo early (phase 1 instead of 2)?
4. **Block values** (slider positions, picks): saved with the chat and synced (recommended, matches "everything per
   account"), or kept on this device only?
5. **On by default** for capable models (recommended), or a switch in Settings → AI?

## Review triage (v1 → v2)
Accepted from both reviewers: built-in name collisions removed; prompt options and preamble corrected; devtools
remote-script blocked; install telemetry handled by vendoring; Ask label must equal message + read-only button turns +
Draft for changes (prompt-injection defence, and Undo doesn't yet cover renames/moves); one link policy for all
Markdown; versioning and append-only props; current values (not defaults) in history; per-fence streaming state and
our own transcript adapter; snapshot blocks with sources (no silent live data); action gate with one effect per click;
CSV formula escaping; failure shown per node; limits enforced before rendering; chart types/validation/dark contrast
via the white chip; typed table columns and Stat; Choice for options; tablist/listbox semantics; phone forms per
component; per-block state records with commit-on-release; motion tokens; no primary buttons in blocks; tone icons and
tested text tokens. Rejected: none. Deferred (phase 2+): Query/live data, direct writes, deck Ask, pinning.
