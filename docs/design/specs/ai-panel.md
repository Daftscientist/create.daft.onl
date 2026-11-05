# Spec: AI co-editing panel (UI only, inference deferred)

Status: draft for review, 2026-11-05. Inference is deferred (docs/architecture/AI.md); this builds the UI with a
scripted mock agent so the presentation of agent work can be designed and reviewed now.

## Placement
- Desktop deck page: a right-hand panel, 380px, resizable 320–520px, toggled by an "Ask" button in the deck header
  (icon + label) and ⌘J. It pushes the stage rather than overlapping it, so the slide stays fully visible while the
  agent works on it. Remembered open/closed per user.
- Mobile: not in this phase (VISION: mobile edits are light). Later a sheet from the viewer.

## Anatomy
1. **Header**: model chip (provider · model, opens a menu) and a "New chat" icon button.
2. **Thread**: user messages right-aligned on `--fill-2`; assistant text left, no bubble.
3. **Run block** (one per assistant turn while working):
   - A single **activity line**: shimmering text of at most 4 words, from the tool call's `activity` param
     ("Reading slide 4", "Drafting a timeline", "Checking contrast"). Never tool names.
   - Each activity stays at least 1.6 s (target 1.5–2 s) before the next replaces it, cross-fading upward. If calls finish
     faster, queue them; if the queue grows past 3, show only the newest (never fall seconds behind real work).
   - **Thinking**: when the model reasons, the line reads "Thinking" with the same shimmer; its summary is available
     under a "Thought for 6s" disclosure afterwards.
   - When the turn finishes, the run collapses to "6 steps · 14s" (expandable list of activity lines with ✓) above the answer.
4. **Changes**: edits made to the deck appear as a compact card "Edited slides 4–5" with thumbnails, **Undo** and
   "Show". Edits apply immediately (optimistic, like the rest of the app); Undo reverts the whole turn.
5. **Composer**: autosizing textarea, placeholder "Ask Ream to change this deck", context chip "Slide 4" (current
   slide, removable; ⌘-click slides in the rail to add more), Send (↵) / Stop while running. ⇧↵ newline.
6. **Empty state**: three example prompts grounded in the open deck ("Tighten the wording on slide 3",
   "Make a summary slide", "Turn slide 5 into a chart") and, if no model is connected, "Connect a model in Settings → AI".

## States
idle · running (activity) · thinking · streaming answer · stopped (shows "Stopped" + partial changes kept with Undo) ·
error (inline, with Retry) · no model connected · offline.

## Motion
Activity line: 160 ms cross-fade with 6px upward travel, shimmer 1.6 s linear loop; reduced motion → no shimmer, plain fade.
Run collapse uses `gentle`.

## References
Cursor and Claude agent panels (activity lines, collapsed step lists), Linear's AI, Raycast AI chat (composer), Figma
Make (edits applied with undo).

## Review round 1 (Claude subagent): decisions now binding
- Behind `?preview=ai` (and ⌘J/"Ask" only then) until a real provider works: no dead UI in production.
- Material: Mica (`--panel`), 1px `--hair` left edge, no blur; header height = deck header. Below 1100px the rail collapses
  to numbers when the panel opens; below 900px the panel overlays from the right over Smoke.
- Activity queue capped at 1 (after the hold, jump to the newest). Flush on answer streaming, Stop and error. Thinking
  uses the same 1.6s minimum and reasoning under 1s isn't a separate step. `activity` is trimmed to 4 words; a missing
  one falls back to a per-tool default label, never the tool name.
- Agent turns go on the editor's undo stack as one named step ("Undo AI edit"). If a touched slide changed since, Undo
  offers per-slide revert with a reason. While running, the slide being written shows an activity ring in the rail.
- Context follows rail selection ("Slides 4–6"), plus "+" on the chip row and "@" in the composer. ⌘-click stays selection.
- Keyboard: ⌘J opens and focuses the composer; ⌘J again or Esc from an empty composer returns to the stage. Esc never
  leaves the deck while focus is in the panel. The splitter is `role="separator"` (←/→ 20px, double-click resets).
  DeckPage key handling must ignore `input, textarea, [contenteditable]`.
- Accessibility: the shimmer is a highlight sweep with its darkest stop at `--ink-2`; the run block is `role="status"` and
  announces only start and finish; changing activity lines are aria-hidden; reduced motion = static text.
- One thread per deck, stored locally; "New chat" clears with Undo; offline blocks only cloud providers; when the run
  collapses, scroll anchors to the answer.
