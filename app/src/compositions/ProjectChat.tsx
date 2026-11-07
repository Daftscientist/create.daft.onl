// A project's conversation (spec: projects v2, chat-first). State lives in data/projectRuns.ts, so a run keeps going
// while you open a deck; this only draws it. Empty: the project's title centred over the composer with ideas that
// fill it. With messages: the thread (your bubbles, Ream's markdown prose, a card per deck it touched) and the
// composer docked under it.
import { ArrowClockwise, ArrowDown, ArrowUp, ArrowUUpLeft, Check, Copy, Paperclip, Stop, X } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Attachment } from '../data/ai/agent'
import { useActiveModel } from '../data/ai/settings'
import { childrenOf, openDeck, useLibrary } from '../data/library'
import { chooseVision, getDraft, isRunning, retry, send, setDraft, stop, thread, undo, useRuns, type Item, type Turn, type Work } from '../data/projectRuns'
import { toast } from '../data/toasts'
import type { Deck } from '../data/types'
import { navigate } from '../lib/router'
import { Button, IconButton } from '../ui/Button'
import { VisionCard } from './AgentPanel'
import { DeckThumb } from './DeckThumb'
import { Markdown } from './Markdown'
import { ModelPicker, ReasoningPicker } from './ModelPicker'
import s from './ProjectChat.module.css'

export function ProjectConversation({ projectId, chatId, title, layout = 'desktop' }: { projectId: string; chatId: string; title: ReactNode; layout?: 'desktop' | 'phone' }) {
  useRuns()
  const lib = useLibrary()
  const t = thread(chatId)
  const running = isRunning(chatId)
  const ready = !!useActiveModel()
  const decks = childrenOf(lib, projectId).filter((e): e is Deck => e.type === 'deck').sort((a, b) => b.modifiedAt - a.modifiedAt)
  const name = lib.entries[projectId]?.name ?? 'this project'
  const composer = useRef<ComposerHandle>(null)
  const empty = !t.turns.length
  // Ideas name decks in full in what they put in the box; the chip itself may shorten them.
  const ideas: { label: string; prompt: string }[] = decks.length
    ? [
        { label: `Summarise ${short(decks[0].name)}${decks[1] ? ` and ${short(decks[1].name)}` : ''}`, prompt: `Summarise ${decks[0].name}${decks[1] ? ` and ${decks[1].name}` : ''}` },
        { label: `What’s missing across ${decks.length === 1 ? 'this deck' : `these ${decks.length} decks`}?`, prompt: `What’s missing or inconsistent across ${decks.length === 1 ? 'this deck' : `these ${decks.length} decks`}?` },
        { label: 'Make a one-page overview deck', prompt: `Make a one-page overview deck of ${name}` },
      ]
    : [
        { label: 'Make a pitch deck: problem, solution, market, ask', prompt: 'Make a pitch deck: problem, solution, market, ask' },
        { label: `Make a kickoff deck for ${short(name)}`, prompt: `Make a kickoff deck for ${name}` },
        { label: 'Make a weekly update I can reuse', prompt: 'Make a weekly update deck I can reuse' },
      ]
  const intro = (
    <div className={s.intro}>
      {layout === 'desktop' && <div className={s.heroTitle}>{title}</div>}
      <p className={s.heroLine}>
        {!ready ? 'Ream works with your own AI provider account. Add one to start.'
          : decks.length ? `Ream can read, change and add to the ${decks.length === 1 ? 'deck' : `${decks.length} decks`} in ${name}.`
          : 'Describe a deck and Ream will make it here.'}
      </p>
    </div>
  )
  const chips = ready
    ? <div className={s.ideas}>{ideas.map((x) => <button key={x.label} type="button" className={s.idea} onClick={() => composer.current?.fill(x.prompt)}>{x.label}</button>)}</div>
    : <div className={s.ideas}><Button variant="secondary" onClick={() => navigate({ name: 'settings', section: 'ai' })}>Set up AI</Button></div>
  // One composer for the whole life of the chat (it never remounts on the first send, so focus and the phone keyboard
  // stay). Desktop empty: centred under the title with ideas below. Phone empty: ideas above it, in the dock.
  return (
    <div className={s.convo} data-layout={layout} data-empty={empty || undefined}>
      {empty
        ? <div className={s.emptyBody}><div className={s.column}>{intro}{layout === 'phone' && chips}</div></div>
        : <ThreadView projectId={projectId} chatId={chatId} turns={t.turns} line={t.line} lineDeck={t.lineDeck} running={running} vision={t.vision} />}
      <div className={s.dock}>
        <div className={s.column}><Composer ref={composer} projectId={projectId} chatId={chatId} name={name} ready={ready} running={running} autoFocus={layout === 'desktop' && empty} /></div>
      </div>
      {empty && layout === 'desktop' && <div className={s.column}>{chips}</div>}
    </div>
  )
}
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce'
const short = (n: string) => (n.length > 24 ? `${n.slice(0, 23)}…` : n)

// ---------- thread ----------

function ThreadView({ projectId, chatId, turns, line, lineDeck, running, vision }: { projectId: string; chatId: string; turns: Turn[]; line: string | null; lineDeck: string | null; running: boolean; vision: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [behind, setBehind] = useState(false)
  // Follows new words only while you're at the bottom; otherwise a pill brings you back.
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    if (follow.current) el.scrollTop = el.scrollHeight
    else setBehind(true)
  }, [turns, line])
  useLayoutEffect(() => { const el = box.current; if (el) el.scrollTop = el.scrollHeight; follow.current = true }, [chatId])
  // The keyboard opening or the draft growing shrinks the thread: stay at the bottom if you were there.
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => { if (follow.current) el.scrollTop = el.scrollHeight })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const last = turns[turns.length - 1]
  return (
    <div className={s.threadWrap}>
      <div className={s.thread} ref={box} role="log" aria-label="Conversation" onScroll={(e) => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; if (follow.current) setBehind(false) }}>
        <div className={s.column}>
          {turns.map((t, i) => <TurnView key={t.startedAt} turn={t} chatId={chatId} last={i === turns.length - 1} line={line} lineDeck={lineDeck} onRetry={() => retry(projectId, chatId)} />)}
          {vision && <VisionCard onChoice={(c) => chooseVision(chatId, c)} />}
        </div>
      </div>
      <AnimatePresence>
        {behind && (
          <motion.button type="button" className={s.newActivity} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
            onClick={() => { const el = box.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduced() ? 'auto' : 'smooth' }); follow.current = true; setBehind(false) }}>
            <ArrowDown size={13} weight="bold" />{running ? 'Ream is working' : 'New activity'}
          </motion.button>
        )}
      </AnimatePresence>
      <span className="sr-only" role="status" aria-live="polite">{running ? 'Ream is working' : last?.state === 'stopped' ? 'Stopped' : last?.error ? `Problem: ${last.error}` : last ? `Ream finished${last.decks?.length ? `, ${last.decks.length === 1 ? 'one deck' : `${last.decks.length} decks`} changed` : ''}` : ''}</span>
    </div>
  )
}

function TurnView({ turn: t, chatId, last, line, lineDeck, onRetry }: { turn: Turn; chatId: string; last: boolean; line: string | null; lineDeck: string | null; onRetry: () => void }) {
  const running = t.state === 'running'
  const [copied, setCopied] = useState(false)
  // The model's words between its steps, in order; each run of steps folds into one quiet line.
  const groups: ({ kind: 'text'; text: string } | { kind: 'steps'; items: Item[] })[] = []
  for (const it of t.log) {
    const g = groups[groups.length - 1]
    if (it.kind === 'step') { if (g?.kind === 'steps') g.items.push(it); else groups.push({ kind: 'steps', items: [it] }) }
    else if (it.text.trim()) groups.push({ kind: 'text', text: it.text })
  }
  const copy = async () => { try { await navigator.clipboard.writeText(t.text.trim()); setCopied(true); setTimeout(() => setCopied(false), 1400) } catch { toast({ message: 'Couldn’t copy. Select the text and copy it instead.' }) } }
  return (
    <section className={s.turn} aria-label="Message">
      <div className={s.you}>
        <p>{t.prompt}</p>
        {!!t.files?.length && <small>{t.files.join(' · ')}</small>}
      </div>
      <div className={s.ream}>
        {groups.map((g, j) => g.kind === 'text'
          ? <Markdown key={j} text={g.text.trim()} className={s.prose} />
          : (running && j === groups.length - 1) ? null : <Steps key={j} items={g.items} />)}
        {running && <Activity line={line} deck={lineDeck} />}
        {t.thought && <details className={s.steps}><summary>Thought it through</summary><p className={s.thought}>{t.thought}</p></details>}
        {!!t.decks?.length && <div className={s.cards}>{t.decks.map((w) => <WorkCard key={w.deckId} work={w} running={running} onUndo={() => undo(chatId, t.startedAt, w.deckId)} />)}</div>}
        {t.error && (
          <div className={s.error} role="alert">
            <p>{t.error}</p>
            {last && <Button variant="secondary" size="sm" icon={<ArrowClockwise size={14} />} onClick={onRetry}>Try again</Button>}
          </div>
        )}
        {!running && (
          <div className={s.actions}>
            {t.text.trim() && <IconButton label={copied ? 'Copied' : 'Copy'} size="sm" tone="plain" onClick={copy}>{copied ? <Check size={15} /> : <Copy size={15} />}</IconButton>}
            {last && !t.error && <IconButton label="Ask again" size="sm" tone="plain" onClick={onRetry}><ArrowClockwise size={15} /></IconButton>}
            <span className={s.meta}>{t.ms !== undefined ? `${Math.max(1, Math.round(t.ms / 1000))}s` : ''}{t.state === 'stopped' ? ' · Stopped' : ''}</span>
          </div>
        )}
      </div>
    </section>
  )
}

function Steps({ items }: { items: Item[] }) {
  const decks = new Set(items.map((i) => (i.kind === 'step' ? i.deck : undefined)).filter(Boolean))
  return (
    <details className={s.steps}>
      <summary>{items.length === 1 && items[0].kind === 'step' ? items[0].label : `${items.length} steps${decks.size > 1 ? ` · ${decks.size} decks` : ''}`}</summary>
      <ol>{items.map((it, k) => it.kind === 'step' && <li key={k}><Check size={12} weight="bold" />{it.deck && <b>{it.deck}</b>}<span>{it.label}</span></li>)}</ol>
    </details>
  )
}

function Activity({ line, deck }: { line: string | null; deck: string | null }) {
  return (
    <div className={s.activity} aria-hidden>
      <span className={s.dot} />
      <span className={s.activityText}>
        {deck && <small>{deck}</small>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={line ?? 'Working'} className={s.line} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.16 }}>{line ?? 'Working'}</motion.span>
        </AnimatePresence>
      </span>
    </div>
  )
}

/** A deck a turn worked on: its live cover, what happened, Open and Undo. Open works while Ream is still at it. */
function WorkCard({ work: w, running, onUndo }: { work: Work; running: boolean; onUndo: () => void }) {
  const d = useLibrary().entries[w.deckId] as Deck | undefined
  const gone = !d || d.type !== 'deck' || d.trashedAt !== null
  const status = w.undone ? (w.created ? 'Undone · moved to Trash' : 'Undone · slides put back')
    : running ? (w.created ? 'Making…' : 'Changing…')
    : w.created ? (gone ? 'In Trash' : `Made · ${d!.slides.length} ${d!.slides.length === 1 ? 'slide' : 'slides'}`)
    : changed(w)
  const open = () => { if (!d || gone) return; openDeck(d.id); navigate({ name: 'deck', deckId: d.id }) }
  return (
    <div className={s.card} data-live={running || undefined}>
      <button type="button" className={s.cardCover} onClick={open} disabled={gone} aria-label={`Open ${d?.name ?? w.name}`} tabIndex={-1}>
        {d && d.type === 'deck' && !d.remote ? <DeckThumb deck={d} /> : <span className={s.coverBlank} />}
      </button>
      <div className={s.cardText}>
        <b title={d?.name ?? w.name}>{d?.name ?? w.name}</b>
        <span className={s.cardStatus}>{w.undone && <ArrowUUpLeft size={12} weight="bold" />}{status}</span>
        <div className={s.cardActions}>
          {!gone && <Button variant="secondary" size="sm" onClick={open}>Open</Button>}
          {!w.undone && !running && !(w.created && gone) && <Button variant="ghost" size="sm" onClick={onUndo}>Undo</Button>}
        </div>
      </div>
    </div>
  )
}

function changed(w: Work): string {
  if (!w.before || !w.after) return 'Changed'
  const was = new Map(w.before.map((x) => [x.id, x.html]))
  const now = new Set(w.after.map((x) => x.id))
  const added = w.after.filter((x) => !was.has(x.id)).length
  const edited = w.after.filter((x) => was.has(x.id) && was.get(x.id) !== x.html).length
  const removed = w.before.filter((x) => !now.has(x.id)).length
  const n = (k: number) => `${k} ${k === 1 ? 'slide' : 'slides'}`
  const parts = [edited && `${n(edited)} edited`, added && `${n(added)} added`, removed && `${n(removed)} removed`].filter(Boolean) as string[]
  if (parts.length > 1) parts.splice(1, parts.length - 1, ...parts.slice(1).map((p) => p.replace(/ slides?/, '')))
  return parts.length ? parts.join(', ') : 'No slide changes'
}

// ---------- composer ----------

type ComposerHandle = { fill: (text: string) => void }

const Composer = forwardRef<ComposerHandle, { projectId: string; chatId: string; name: string; ready: boolean; running: boolean; autoFocus?: boolean }>(function Composer({ projectId, chatId, name, ready, running, autoFocus }, ref) {
  const [draft, setText] = useState(() => getDraft(projectId))
  const [files, setFiles] = useState<Attachment[]>([])
  const [reading, setReading] = useState(0)
  const area = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)
  const grow = () => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(220, el.scrollHeight)}px` }
  const set = (v: string) => { setText(v); setDraft(projectId, v) }
  useImperativeHandle(ref, () => ({ fill: (v) => { set(v); requestAnimationFrame(() => { const el = area.current; if (!el) return; el.focus(); el.setSelectionRange(v.length, v.length); grow() }) } }))
  useEffect(() => { grow(); if (autoFocus) area.current?.focus({ preventScroll: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘J puts you in the composer from anywhere on the project page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); area.current?.focus() } }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])
  const submit = () => {
    if (!draft.trim() || running || !ready || reading) return
    void send(projectId, chatId, draft, files)
    set('')
    setFiles([])
    requestAnimationFrame(grow)
  }
  const attach = async (list: FileList) => {
    const out: Attachment[] = []
    const all = [...list]
    if (all.length > 8) toast({ message: `Up to 8 files at a time: ${all.length - 8} weren’t attached.` })
    setReading((n) => n + 1)
    try {
    for (const f of all.slice(0, 8)) {
      if (f.size > 20 * 1024 * 1024) { toast({ message: `${f.name} is over 20 MB, so it wasn’t attached.` }); continue }
      const type = f.type || (/\.(md|txt|csv|json)$/i.test(f.name) ? 'text/plain' : 'application/octet-stream')
      try {
        const data = type.startsWith('text/') || /json|xml/.test(type) ? await f.text() : await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(f) })
        out.push({ name: f.name, mediaType: type, data })
      } catch { toast({ message: `Couldn’t read ${f.name}.` }) }
    }
    } finally { setReading((n) => n - 1) }
    setFiles((x) => [...x, ...out])
  }
  return (
    <form className={s.composer} onSubmit={(e) => { e.preventDefault(); submit() }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.stopPropagation() } }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void attach(e.dataTransfer.files) } }}
      onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); void attach(e.clipboardData.files) } }}>
      {(!!files.length || !!reading) && (
        <div className={s.files}>
          {!!reading && <span className={s.file} data-reading>Reading…</span>}
          {files.map((f, i) => <span key={i} className={s.file}>{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={11} weight="bold" /></button></span>)}
        </div>
      )}
      <textarea
        ref={area}
        rows={1}
        value={draft}
        placeholder={ready ? `Ask about ${name}…` : 'Set up AI in Settings to chat'}
        aria-label="Message"
        onChange={(e) => { set(e.target.value); grow() }}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
          if (e.key === 'Escape') { if (running) stop(chatId); else if (!draft) area.current?.blur() }
        }}
      />
      <div className={s.row}>
        <IconButton label="Attach files" size="sm" tone="plain" onClick={() => picker.current?.click()}><Paperclip size={16} /></IconButton>
        <input ref={picker} type="file" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.json,.html,.xml" onChange={(e) => { if (e.target.files) void attach(e.target.files); e.target.value = '' }} />
        <ModelPicker variant="chip" /><ReasoningPicker />
        <span className={s.spacer} />
        {running
          ? <IconButton label="Stop" hint="Esc" size="md" tone="fill" className={s.go} onClick={() => stop(chatId)}><Stop size={14} weight="fill" /></IconButton>
          : <IconButton label="Send" hint="↵" size="md" tone="fill" type="submit" className={s.go} disabled={!draft.trim() || !ready || !!reading}><ArrowUp size={16} weight="bold" /></IconButton>}
      </div>
    </form>
  )
})
