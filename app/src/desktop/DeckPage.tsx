// Opened deck, UI phase: a viewer (slide rail + stage). The editor replaces the stage later; the
// frame, header and rail stay. Present goes full screen.
import { ArrowLeft, CaretLeft, CaretRight, ChatCircleText, Play } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { download, setLastSlide, useLibrary } from '../data/library'
import { count, relTimeInline } from '../lib/format'
import { back, navigate } from '../lib/router'
import { Slide } from '../slides/Slide'
import { Button, IconButton } from '../ui/Button'
import { HtmlMark, PptxMark } from '../ui/FileMarks'
import { Tooltip } from '../ui/Tooltip'
import { DeckThumb } from '../compositions/DeckThumb'
import { EmptyState } from '../compositions/PageHeader'
import { SyncInline } from '../compositions/SyncStatus'
import { AgentPanel } from '../compositions/AgentPanel'
import { isPreview } from '../lib/preview'
import { modKey } from '../lib/shell'
import { Toaster } from '../ui/Toaster'
import s from './DeckPage.module.css'

export function DeckPage({ deckId, slide }: { deckId: string; slide?: number }) {
  const lib = useLibrary()
  const deck = lib.entries[deckId]
  const [index, setIndex] = useState(() => slide ?? (deck?.type === 'deck' ? deck.lastSlide : 0))
  const stage = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLDivElement>(null)
  const n = deck?.type === 'deck' ? deck.slides.length : 0
  const ai = isPreview('ai')
  const [ask, setAsk] = useState(() => ai && localStorage.getItem('ream.ask.open') === '1')
  useEffect(() => { try { localStorage.setItem('ream.ask.open', ask ? '1' : '0') } catch { /* ok */ } }, [ask])

  useEffect(() => { if (deck?.type === 'deck') setLastSlide(deck.id, index) }, [deck?.id, index]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { rail.current?.querySelector(`[data-i="${index}"]`)?.scrollIntoView({ block: 'nearest' }) }, [index])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ai && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') { e.preventDefault(); setAsk((a) => !a); return }
      if ((e.target as HTMLElement).matches('input, textarea, [contenteditable]') || document.documentElement.dataset.overlay) return
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); setIndex((i) => Math.min(n - 1, i + 1)) }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)) }
      if (e.key === 'Escape' && !document.fullscreenElement) leave()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [n, ai]) // eslint-disable-line react-hooks/exhaustive-deps

  const leave = () => (history.length > 1 ? back() : navigate({ name: 'home' }))

  if (!deck || deck.type !== 'deck' || deck.trashedAt !== null) {
    return (
      <div className={s.missing}>
        <EmptyState icon={<ArrowLeft size={24} />} title="This deck isn’t available" body="It may have been moved to Trash or deleted.">
          <Button variant="secondary" onClick={() => navigate({ name: 'home' })}>Back to Recents</Button>
        </EmptyState>
      </div>
    )
  }

  return (
    <div className={s.page}>
      <header className={s.header}>
        <IconButton label="Back to library" hint="Esc" onClick={leave}><ArrowLeft size={16} /></IconButton>
        <div className={s.title}>
          <h1>{deck.name}</h1>
          <span>{count(n, 'slide')} · Edited {relTimeInline(deck.modifiedAt)} <SyncInline /></span>
        </div>
        <div className={s.actions}>
          <Tooltip label="Download PowerPoint (.pptx)"><Button variant="ghost" icon={<PptxMark />} onClick={() => download([deck.id], 'pptx')}>PowerPoint</Button></Tooltip>
          <Tooltip label="Download HTML"><Button variant="ghost" icon={<HtmlMark />} onClick={() => download([deck.id], 'html')}>HTML</Button></Tooltip>
          {ai && <Tooltip label="Ask Ream to change this deck" hint={`${modKey}J`}><Button variant={ask ? 'secondary' : 'ghost'} aria-pressed={ask} icon={<ChatCircleText size={15} />} onClick={() => setAsk((a) => !a)}>Ask</Button></Tooltip>}
          <Button variant="primary" icon={<Play size={14} weight="fill" />} onClick={() => stage.current?.requestFullscreen?.().catch(() => {})}>Present</Button>
        </div>
      </header>
      <div className={s.body} data-ask={ask || undefined}>
        <nav className={s.rail} ref={rail} aria-label="Slides">
          {deck.slides.map((_, i) => (
            <button key={i} type="button" data-i={i} className={s.railItem} aria-current={i === index ? 'true' : undefined} onClick={() => setIndex(i)}>
              <span className={s.num}>{i + 1}</span>
              <DeckThumb deck={deck} slide={i} className={s.railThumb} />
            </button>
          ))}
        </nav>
        <div className={s.stageWrap}>
          <div className={s.stage} ref={stage} data-stage tabIndex={-1}>
            <Slide spec={deck.slides[index]} theme={deck.theme} />
          </div>
          <div className={s.pager}>
            <IconButton label="Previous slide" hint="←" side="top" disabled={index === 0} onClick={() => setIndex(index - 1)}><CaretLeft size={16} /></IconButton>
            <span aria-live="polite">{index + 1} / {n}</span>
            <IconButton label="Next slide" hint="→" side="top" disabled={index >= n - 1} onClick={() => setIndex(index + 1)}><CaretRight size={16} /></IconButton>
          </div>
        </div>
        {ask && <AgentPanel deck={deck} slide={index} onClose={() => setAsk(false)} />}
      </div>
      <Toaster />
    </div>
  )
}
