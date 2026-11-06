// A prompt waiting for a deck's Ask panel: Home's "make a presentation" creates the deck, opens it with Ask,
// and Ask takes the prompt from here when it mounts.
import type { Attachment } from './agent'

export type PendingAsk = { prompt: string; files: Attachment[]; fresh: boolean }
const waiting = new Map<string, PendingAsk>()
export const setPendingAsk = (deckId: string, ask: PendingAsk) => { waiting.set(deckId, ask) }
export function takePendingAsk(deckId: string): PendingAsk | null {
  const a = waiting.get(deckId) ?? null
  waiting.delete(deckId)
  return a
}
