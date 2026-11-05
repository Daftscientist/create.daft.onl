// Demo agent for the AI panel preview (docs/design/specs/ai-panel.md). Inference is deferred
// (docs/architecture/AI.md); this scripts realistic event streams so the presentation can be designed.
// A real provider will emit the same events: thinking, tool (with a ≤4-word activity), text, edit, done.
import type { Deck, SlideSpec } from './types'

export type AgentEvent =
  | { type: 'thinking'; ms: number }
  | { type: 'tool'; activity: string; ms: number }
  | { type: 'text'; chunk: string }
  | { type: 'edit'; slideIds: number[] }
  | { type: 'done'; summary: string }

/** Trims an activity to four words; a missing one falls back to a per-tool label, never the tool name. */
export function activityLabel(activity: string | undefined, fallback = 'Working on it'): string {
  const words = (activity ?? '').trim().split(/\s+/).filter(Boolean)
  return words.length ? words.slice(0, 4).join(' ') : fallback
}

function shorten(t: string) {
  const cut = t.split(/[,;–—(]/)[0].trim()
  return cut.length < t.length ? cut : t.split(' ').slice(0, Math.max(3, Math.ceil(t.split(' ').length * 0.6))).join(' ')
}

/** The demo's actual change to the deck: tightens wording on the target slide. */
export function demoEdit(spec: SlideSpec): SlideSpec {
  switch (spec.kind) {
    case 'bullets': return { ...spec, items: spec.items.map(shorten) }
    case 'title': return { ...spec, title: shorten(spec.title), subtitle: spec.subtitle }
    case 'split': return { ...spec, body: shorten(spec.body) + '.' }
    case 'stat': return { ...spec, label: shorten(spec.label) }
    case 'quote': return { ...spec, text: shorten(spec.text) }
    default: return { ...spec, title: shorten(spec.title) }
  }
}

export function script(deck: Deck, slide: number, prompt: string): AgentEvent[] {
  const n = slide + 1
  return [
    { type: 'thinking', ms: 1900 },
    { type: 'tool', activity: `Reading slide ${n}`, ms: 700 },
    { type: 'tool', activity: 'Checking the deck’s tone', ms: 900 },
    { type: 'tool', activity: `Rewriting slide ${n}`, ms: 1500 },
    { type: 'edit', slideIds: [slide] },
    { type: 'tool', activity: 'Checking text fits', ms: 600 },
    ...`I tightened the wording on slide ${n} of “${deck.name}” so each line reads in one glance. ${/chart|summary/i.test(prompt) ? 'I kept the structure as it was. ' : ''}Undo puts the original back.`
      .split(/(?<= )/).map((chunk) => ({ type: 'text' as const, chunk })),
    { type: 'done', summary: `Edited slide ${n}` },
  ]
}
