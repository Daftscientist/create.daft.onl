---
name: office-ui
description: Design and build any UI in office.daft.onl (create.daft.onl repo): home, file browser, Deck editor, sheets, menus, motion. Runs the project's design loop: load the vision and moodboard, gather real references, answer the five placement questions per element and state, get adversarial review from a fresh Claude subagent and Codex (GPT 6.1 Sol) before and after building, capture screenshots, and fix. Use for every UI change in this repo, however small.
---

# office-ui

The design contract lives in the repo, not in this skill:
- `docs/design/VISION.md`: materials (ground / paper / glass), motion, desktop vs mobile, anti-references
- `docs/design/moodboard/README.md`: references with take/leave notes; images beside it
- `docs/architecture/ENGINE.md`: what the engine can do (domOXML on Pyodide, OPFS, rasters)
- `docs/design/specs/`: one spec per surface (create it as you go)
- `docs/design/review-log.md`: what each review found, to calibrate reviewers over time

Read VISION.md and the moodboard README at the start of every UI task. If the task conflicts with
them, raise it with the user instead of quietly diverging. The user's words beat the docs.

## Size the loop to the change

| Change | Research | Spec | Pre-build review | Post-build review |
|---|---|---|---|---|
| New surface or component (home, sidebar, editor panel) | yes | yes | Claude + Codex `high` | Codex with screenshots, escalate |
| New state or interaction on an existing component | if unsure | append to spec | Claude subagent | Codex `high` |
| Tweak (spacing, copy, colour token) | no | no | no | self-check screenshots only |

## 1. Research (new things only)
Find at least three real references for the specific thing being built, not the whole app. Use web search
and the live sites in the moodboard. Capture them with `scripts/shoot.py` (it can run steps like hover,
click and long-press, so capture *states*, not just heroes). Add the good ones to `docs/design/moodboard/`
with a take/leave row. Prefer shipped products over Dribbble shots; Dribbble is for spotting clichés.

## 2. Decide: the five questions, at the lowest level
Write `docs/design/specs/<surface>.md`. For **each element and each state** answer:
1. **Presentation**: material, size, type, icon, copy
2. **Placement**: exact location, and why not the alternatives
3. **Reaction**: hover, press, drag, focus, keyboard, loading, error, empty, disabled, data changing underneath
4. **Naturalness**: which convention it follows (name the app that taught users this)
5. **Alignment**: same materials, motion presets, spacing and voice as what's already built

Specify desktop and mobile separately; they are different compositions (VISION.md). A state you can't
answer is a state you haven't designed yet.

## 3. Pre-build adversarial review
Fill `references/adversarial-brief.md` into a file in the scratchpad, then run **both in parallel**:
- **Claude**: Agent tool, `general-purpose`, prompt = the filled brief. A fresh agent with no stake in the idea.
- **Codex**: run in the background with Bash `run_in_background`:
  `.claude/skills/office-ui/scripts/codex-review.sh high <brief.md> <out.md> [images…]`
  Attach the relevant moodboard images. Read `<out.md>` when it finishes (runs take minutes).

Then triage every finding yourself: **accept** (change the spec), **reject** (one line why), or **ask the
user** (genuine taste calls). Reviewers are evidence, not authority. Two reviewers agreeing raises
confidence; a finding that contradicts VISION.md loses unless it shows VISION.md is wrong.

## 4. Build
**Hard rule (user): never reinvent.** Before writing markup, read `app/src/ui/README.md` and
`app/src/compositions/README.md`. Use what exists; if something is missing, add it centrally (ui = primitives,
compositions = domain structures), add its catalogue row, then use it. Shell files (`desktop/`, `mobile/`) only
compose. Grep for an existing class or component before creating one; duplicated styling is a bug.
Match the existing code's tokens, components and motion presets. Glass only on tools, never on content.
Every interactive state from the spec gets built, including empty, error and reduced-motion.

## 5. Capture and post-build review
Write a shot plan (JSON, see `scripts/shoot.py` docstring) covering desktop and mobile, light and dark,
and the key states (hover, pressed, drag-over, menu open, empty, long-press). Then:
`uv run .claude/skills/office-ui/scripts/shoot.py plan.json <scratchpad>/shots`
Look at every image yourself first and fix what's obviously wrong, then send the shots to Codex.

**Escalation** (the user wants to learn whether more reasoning finds more):
1. Codex `high`. Fix the confirmed findings.
2. If `high` produced at least one confirmed finding, or the surface is a core one (home, editor canvas,
   mobile nav), re-capture and run `xhigh` on the new shots.
3. `max` only for final sign-off of a whole surface. `ultra` only when the user asks.
Stop escalating when a level yields no new confirmed finding. Append one row per run to
`docs/design/review-log.md`: date, surface, reviewer, effort, findings raised / confirmed / new vs previous level.

## 6. Show the user
The dev server runs at https://leovm.tail53f5e9.ts.net:5443 (`cd app && npx vite` on 5180, proxied over HTTPS by `tailscale serve --https=5443`; HTTPS is required for OPFS). Always send the https link. As each page
becomes viewable, send the user direct links to it (and to interesting states: `?empty`, `?reset`, a specific
folder or deck). Give the URL with a short note: what changed, which review
findings you accepted or rejected, and any taste calls they need to make.

## Codex rules
- Always `gpt-6.1-sol`, effort passed explicitly, `--sandbox read-only` (reviews never edit), never fast
  mode, never `--dangerously-bypass-approvals-and-sandbox`. The script enforces this.
- Codex sees nothing of the conversation; the brief must stand alone.
- `codex login status` fails → the user runs `codex login`. Rate limit → tell the user; don't retry in a loop.
- Codex can also build an isolated piece when the user asks: give it its own git worktree and
  `--sandbox workspace-write`, one task per launch, and review its diff yourself.

## Quality bar (check before showing anything)
- Glass text passes AA in light and dark; `prefers-reduced-transparency` gives solid surfaces.
- Springs are interruptible; `prefers-reduced-motion` gives fades.
- Local actions are instant with undo; no spinners or skeletons for OPFS data.
- Mobile targets ≥ 44px, thumb-reachable primary actions, sheets instead of menus.
- Keyboard: everything reachable, visible focus, ⌘K works from anywhere on desktop.
- No landing page. The first frame is the user's files.
