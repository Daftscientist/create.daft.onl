// Splits an answer into prose and interactive blocks (spec: generative-ui.md §6). Only exact ```openui-lang fences
// become blocks; any other fence stays a code block in the prose. A block is "finished" as soon as its closing fence
// arrives (even while the turn keeps working); one still open when the turn ends (Stop, a closed tab) is unfinished
// and stays inert.
/** The fence tag that marks an interactive block (kept here so the chat can split answers without loading OpenUI). */
export const FENCE = 'openui-lang'

/** `key`: stable while the block streams (its place in the turn); `id`: its saved-state id (place + program hash). */
export type Part = { kind: 'prose'; text: string } | { kind: 'block'; key: string; id: string; program: string; closed: boolean }

/** A stable id per block: where it sits in the turn plus a hash of its program. */
export function blockId(turnAt: number, index: number, program: string): string {
  let h = 5381
  for (let i = 0; i < program.length; i++) h = (h * 33 + program.charCodeAt(i)) | 0
  return `${turnAt.toString(36)}.${index}.${(h >>> 0).toString(36)}`
}

export function splitAnswer(text: string, turnAt: number): Part[] {
  const out: Part[] = []
  const lines = text.split('\n')
  let prose: string[] = []
  let i = 0, n = 0
  const flush = () => { if (prose.join('\n').trim()) out.push({ kind: 'prose', text: prose.join('\n') }); prose = [] }
  while (i < lines.length) {
    const open = /^\s{0,3}(`{3,})\s*([\w-]*)\s*$/.exec(lines[i])
    if (open && open[2] === FENCE) {
      const ticks = open[1]
      const body: string[] = []
      i++
      let closed = false
      while (i < lines.length) {
        if (new RegExp(`^\\s{0,3}${ticks}\\s*$`).test(lines[i])) { closed = true; i++; break }
        body.push(lines[i++])
      }
      flush()
      const program = body.join('\n')
      out.push({ kind: 'block', key: `${turnAt.toString(36)}.${n}`, id: blockId(turnAt, n, program), program, closed })
      n++
      continue
    }
    prose.push(lines[i++])
  }
  flush()
  return out
}

/** How a finished turn's blocks are shown to the model in later turns: a one-line note instead of the program
 *  (only the newest block's program is sent in full; see projectRuns history). */
export function summariseBlocks(text: string, keepFull: boolean): string {
  if (keepFull) return text
  return splitAnswer(text, 0).map((p) => {
    if (p.kind === 'prose') return p.text
    const title = /Card\([^\n]*?,\s*"([^"]{1,80})"/.exec(p.program)?.[1]
    return `[interactive block${title ? ` "${title}"` : ''}, shown to the person]`
  }).join('\n\n')
}
