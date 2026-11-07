// One interactive block in an answer (spec: generative-ui.md). Renders the program with Ream's library, keeps what
// only changes the view on this device, sends every click through the gate (host.tsx), and records anything with an
// effect in the chat (with Undo). Loaded lazily the first time an answer contains a block.
import { Renderer, type ActionEvent, type OpenUIError } from '@openuidev/react-lang'
import { useEffect, useMemo, useRef, useState } from 'react'
import { scoped } from '../data/accounts'
import { getLibrary, openDeck } from '../data/library'
import { draftInto, isRunning, recordWork, send, useRuns } from '../data/projectRuns'
import { toast } from '../data/toasts'
import { openLink } from '../lib/links'
import { navigate } from '../lib/router'
import { Button } from '../ui/Button'
import { BlockHostProvider, csvName, newDeckFrom, parseSlide, putOnSlide, toCsv, type BlockHost } from './host'
import { library, LIBRARY_VERSION } from './library'
import s from './genui.module.css'

const MAX_PROGRAM = 16_000
const stateKey = (id: string) => scoped(`ream.block.${id}`)
const loadState = (id: string): Record<string, unknown> | undefined => { try { const v = localStorage.getItem(stateKey(id)); return v ? JSON.parse(v) : undefined } catch { return undefined } }

export type BlockProps = {
  id: string
  program: string
  /** The fence is still arriving. */
  streaming: boolean
  /** The fence never closed (stopped or interrupted): shown, never usable. */
  unfinished: boolean
  projectId: string
  chatId: string
  turnAt: number
  /** Open a slide large (Quick Look on desktop; the deck on phones). */
  onPreview?: (deckId: string, slide: number) => void
}

export default function Block(p: BlockProps) {
  useRuns()
  const running = isRunning(p.chatId)
  const [errors, setErrors] = useState<OpenUIError[]>([])
  const [code, setCode] = useState(false)
  const lock = useRef(false)
  const [locked, setLocked] = useState(false)
  const initial = useMemo(() => loadState(p.id), [p.id])
  const saveTimer = useRef(0)
  useEffect(() => () => clearTimeout(saveTimer.current), [])
  const title = /Card\([^\n]*?,\s*"([^"]{1,80})"/.exec(p.program)?.[1] ?? 'this block'

  const release = () => { lock.current = false; setLocked(false) }
  const host: BlockHost = {
    busy: locked || running,
    inert: p.unfinished,
    claim: () => { if (lock.current || running || p.unfinished) return false; lock.current = true; setLocked(true); setTimeout(() => { if (lock.current) release() }, 1500); return true },
    footer: <p className={s.madeIn}>Made in this answer</p>,
    preview: (deckId, slide) => { if (p.onPreview) p.onPreview(deckId, slide); else { openDeck(deckId); navigate({ name: 'deck', deckId, slide }) } },
    openDeck: (deckId) => { openDeck(deckId); navigate({ name: 'deck', deckId }) },
  }

  // The gate: every effect lands here, already checked by the button (checkPlan); checked again against the project.
  const onAction = async (e: ActionEvent) => {
    try {
      const params = (e.params ?? {}) as Record<string, unknown>
      const inProject = (deckId: unknown) => { const d = getLibrary().entries[String(deckId)]; return d?.type === 'deck' && d.parentId === p.projectId && d.trashedAt === null }
      switch (e.type) {
        case 'continue_conversation':
          await send(p.projectId, p.chatId, e.humanFriendlyMessage, [], { from: title, readOnly: true })
          break
        case 'open_url': await openLink(String(params.url ?? '')); break
        case 'Draft': draftInto(p.projectId, String(params.message ?? '')); break
        case 'Copy': {
          const text = String(params.text ?? '')
          await navigator.clipboard.writeText(text)
          toast({ message: `Copied “${text.length > 60 ? `${text.slice(0, 59)}…` : text}”` })
          break
        }
        case 'DownloadCsv': {
          const blob = new Blob([toCsv(params.columns as string[], params.rows as (string | number | null)[][])], { type: 'text/csv' })
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob); a.download = csvName(String(params.name ?? 'table'))
          document.body.appendChild(a); a.click(); a.remove()
          setTimeout(() => URL.revokeObjectURL(a.href), 30_000)
          break
        }
        case 'OpenDeck': if (inProject(params.deckId)) host.openDeck(String(params.deckId)); break
        case 'OpenSlide': {
          if (!inProject(params.deckId)) break
          const d = getLibrary().entries[String(params.deckId)]
          const i = d?.type === 'deck' ? d.slides.findIndex((x) => x.id === params.slideId) : -1
          if (i >= 0) host.preview(String(params.deckId), i)
          break
        }
        case 'PutOnSlide': {
          if (!inProject(params.deckId)) { toast({ message: 'That deck isn’t in this project.' }); break }
          const slide = parseSlide(params.slide)
          if (!slide) { toast({ message: 'That slide’s content wasn’t valid, so nothing was added.' }); break }
          const r = putOnSlide(p.projectId, String(params.deckId), slide)
          if (!r) { toast({ message: 'That deck couldn’t be changed (it may only be in the cloud right now).' }); break }
          recordWork(p.chatId, p.turnAt, { deckId: r.deck.id, name: r.deck.name, created: false, before: r.before, after: r.after, summary: `From “${title}”` })
          toast({ message: `Added a slide to ${r.deck.name}` })
          break
        }
        case 'NewDeckFrom': {
          const slide = parseSlide(params.slide)
          if (!slide) { toast({ message: 'That deck’s content wasn’t valid, so nothing was made.' }); break }
          const d = newDeckFrom(p.projectId, String(params.name ?? 'New deck'), slide)
          recordWork(p.chatId, p.turnAt, { deckId: d.id, name: d.name, created: true, after: d.slides, summary: `From “${title}”` })
          toast({ message: `Made ${d.name}` })
          break
        }
      }
    } catch (err) {
      toast({ message: `That didn’t work: ${(err as Error).message}`, tone: 'danger' })
    } finally { release() }
  }

  if (p.program.length > MAX_PROGRAM) return <Failed title={title} reason="This block is too big to show." program={p.program} projectId={p.projectId} chatId={p.chatId} />
  const broken = !p.streaming && errors.length > 0
  return (
    <div className={s.block} data-unfinished={p.unfinished || undefined} data-version={LIBRARY_VERSION}>
      <BlockHostProvider value={host}>
        <Renderer
          library={library}
          response={p.program}
          isStreaming={p.streaming}
          initialState={initial}
          publishObservability={false}
          queryLoader={null}
          onAction={(e) => void onAction(e)}
          onError={setErrors}
          onStateUpdate={(st) => { clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(() => { try { localStorage.setItem(stateKey(p.id), JSON.stringify(st)) } catch { /* this visit only */ } }, 500) }}
        />
      </BlockHostProvider>
      {p.unfinished && <p className={s.notice}>Unfinished: Ream stopped before this block was complete.</p>}
      {broken && (
        <div className={s.notice} role="status">
          <span>{errors.length === 1 ? '1 part' : `${errors.length} parts`} couldn’t be shown.</span>
          <button type="button" className={s.linkButton} onClick={() => setCode(!code)}>{code ? 'Hide details' : 'Details'}</button>
          {!running && <button type="button" className={s.linkButton} onClick={() => void send(p.projectId, p.chatId, `The interactive block “${title}” couldn’t be shown in full (${errors.slice(0, 3).map((x) => x.message).join('; ')}). Please write it again.`)}>Ask Ream to fix it</button>}
        </div>
      )}
      {broken && code && <pre className={s.code}>{errors.map((x) => `• ${x.message}`).join('\n')}{'\n\n'}{p.program}</pre>}
    </div>
  )
}

function Failed({ title, reason, program, projectId, chatId }: { title: string; reason: string; program: string; projectId: string; chatId: string }) {
  const [code, setCode] = useState(false)
  return (
    <div className={s.block}>
      <div className={s.notice} role="status">
        <span>{reason}</span>
        <button type="button" className={s.linkButton} onClick={() => setCode(!code)}>{code ? 'Hide details' : 'Details'}</button>
        <Button variant="ghost" size="sm" onClick={() => void send(projectId, chatId, `The interactive block “${title}” was too big to show. Please make a smaller one.`)}>Ask Ream to fix it</Button>
      </div>
      {code && <pre className={s.code}>{program.slice(0, 4000)}</pre>}
    </div>
  )
}
