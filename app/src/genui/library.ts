// The library the model writes against, and the prompt section that teaches it (spec: generative-ui.md §6). Built
// once at module scope (OpenUI memoises parsers by library identity).
import { createLibrary } from '@openuidev/react-lang'
import { COMPONENTS } from './components'
import { ACTIONS, FUNCTIONS } from './host'
import { FENCE } from './transcript'

/** Bumped when a component's meaning changes (props are append-only; a breaking change gets a new component name). */
export const LIBRARY_VERSION = 1

export const library = createLibrary({ id: 'ream', root: 'Card', components: COMPONENTS, actions: ACTIONS, functions: FUNCTIONS })

const PREAMBLE = `Ream can show small interactive blocks inside your answers, written in OpenUI Lang (described below).
Answer in prose (Markdown) first. Add a block only when it does something prose can't: numbers to explore (a slider that
recomputes a total), a comparison to sort or switch between, a choice for the person to make, a chart of figures, or the
slides a claim comes from. Most answers need no block.`

const RULES = [
  `Put each block in its own fenced code block tagged ${FENCE}: three backticks, then ${FENCE}, the program, then three backticks. Text outside the fence is shown as normal chat.`,
  'Every block is a complete, self-contained program whose root is a Card. Never write a partial update of an earlier block; to change one, write a new complete block.',
  'At most one block per answer unless the person asks for more. Keep it small: a card, not a dashboard (usually under 25 statements).',
  'Never invent numbers. Use figures from the decks (read them first) or from the person, and cite where they came from with Sources([SlideRef(deckId, slideId), ...]) using ids from read_deck.',
  'Buttons: the label says what happens. For @ToAssistant the label must be exactly the message. Use @Draft for requests that need you to rewrite or restyle; @PutOnSlide(deckId, {title, chart|table|bullets}) / @NewDeckFrom(name, {...}) only when the person would want that straight away, and the label must name the deck ("Put on a slide in Q3 review"). One effect per button.',
  'Inputs ($variables) are for exploring. Don’t ask the person to type information into a block that they could just tell you.',
  'No images, no links unless the person needs to go somewhere outside Ream (and then @OpenUrl with the full https address).',
]

/** Lines in OpenUI's generated prompt that contradict Ream's rules (or only waste tokens), removed exactly. If OpenUI's
 *  wording changes, development warns so the list gets updated rather than silently teaching the wrong thing. */
const CUT: (string | RegExp)[] = [
  'Buttons without an action automatically send their label to the assistant (equivalent to @ToAssistant(label)).', // our Button requires an action
  /Put several steps in Action\(\[\.\.\.\]\), e\.g\. Button\("Read", Action\(\[@OpenUrl[^\n]*?Steps execute in order\./, // a two-effect example; we allow one effect
  'Example — simple nav:', '```\nviewBtn = Button("View", @OpenUrl("https://example.com"))\n```',
  '- Choose components that best represent the content (tables for comparisons, charts for trends, forms for input, etc.)', // pushes towards blocks
  /^@(First|Last|Sort|Filter|Abs|Floor|Ceil)\(.*$/gm,
  /Builtins compose — output of one is input to the next:\n[^\n]*\nArray pluck:[^\n]*\n/,
  'During streaming, the output is re-parsed on every chunk. Undefined references are temporarily unresolved and appear once their definitions stream in. This creates a progressive top-down reveal — structure first, then data fills in.',
]
const REPLACE: [string | RegExp, string][] = [
  ['e.g. Button("Ask", @ToAssistant("Tell me more"))', 'e.g. Button("Tell me more", @ToAssistant("Tell me more"))'], // the label must be the message
  [/The optional context is any value \(object, array, string, number\) passed to the assistant as hidden data, e\.g\. @ToAssistant\("Show details", \{orderId: 42\}\)/, 'Ream sends it as the person\'s own visible message, so the label must be exactly the message; don\'t pass context.'],
]

let cached: string | null = null
/** The prompt section for the project chat (generated from the components, so it never drifts from them). */
export function blockPrompt(): string {
  if (cached) return cached
  let p = library.prompt({ preamble: PREAMBLE, bindings: true, builtinFunctions: true, inlineMode: false, toolCalls: false, additionalRules: RULES })
  const edit = (from: string | RegExp, to: string) => {
    const before = p
    p = typeof from === 'string' ? p.split(from).join(to) : p.replace(from, to)
    if (before === p && import.meta.env.DEV) console.warn('[genui] prompt edit no longer matches OpenUI’s text:', from)
  }
  for (const c of CUT) edit(c, '')
  for (const [from, to] of REPLACE) edit(from, to)
  p += '\n- Combine @Set/@Reset with at most one other step in Action([...]).'
  cached = p.replace(/\n{3,}/g, '\n\n')
  return cached
}
