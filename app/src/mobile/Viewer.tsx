// Mobile viewer (VISION: view first, present easily). Swipe through slides, tap toggles controls,
// labelled Present, resumes at your last slide. Ask (typing or voice) changes the deck from the phone; its edits
// land in the slides behind the sheet.
import { CaretLeft, ChatCircleText, DotsThree, Play } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ActionSheet } from '../compositions/ActionSheet'
import { FolderSheet } from '../compositions/FolderSheet'
import { setLastSlide, useLibrary } from '../data/library'
import { back, navigate } from '../lib/router'
import { SlideView } from '../slides/SlideView'
import { Present } from '../editor/Present'
import { Button, IconButton } from '../ui/Button'
import { EmptyState } from '../compositions/PageHeader'
import { AgentPanel } from '../compositions/AgentPanel'
import { useActiveModel } from '../data/ai/settings'
import { Sheet } from '../ui/Sheet'
import s from './Viewer.module.css'

export function MobileViewer({ deckId, slide }: { deckId: string; slide?: number }) {
  const lib = useLibrary()
  const deck = lib.entries[deckId]
  const strip = useRef<HTMLDivElement>(null)
  // Present is the same show as on desktop (animations, transitions, Exit, contained slide).
  const [presenting, setPresenting] = useState(false)
  const [index, setIndex] = useState(() => slide ?? (deck?.type === 'deck' ? deck.lastSlide : 0))
  const [chrome, setChrome] = useState(true)
  const [sheet, setSheet] = useState<'actions' | 'move' | 'ask' | null>(null)
  const ai = !!useActiveModel()

  useEffect(() => {
    const el = strip.current
    if (el) el.scrollTo({ left: index * el.clientWidth, behavior: 'instant' as ScrollBehavior })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void import('../engine').then((m) => m.warmEngine()) }, []) // a deck is open: have the engine ready for export
  useEffect(() => { if (deck?.type === 'deck') setLastSlide(deck.id, index) }, [index]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const present = () => setPresenting(true)
    document.addEventListener('office:present', present)
    return () => document.removeEventListener('office:present', present)
  }, [])

  if (!deck || deck.type !== 'deck') {
    return <EmptyState icon={<CaretLeft size={24} />} title="This deck isn’t available" body="It may have been moved to Trash."><Button variant="secondary" onClick={() => navigate({ name: 'home' })}>Back to Home</Button></EmptyState>
  }
  const leave = () => (history.length > 1 ? back() : navigate({ name: 'home' }))

  return (
    <div className={s.viewer}>
      <AnimatePresence>
        {chrome && (
          <motion.header className={s.top} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <IconButton label="Back" size="lg" tone="plain" tooltip={false} onClick={leave}><CaretLeft size={22} /></IconButton>
            <div className={s.title}>
              <span className={s.name}>{deck.name}</span>
              <span className={s.pos}>Slide {index + 1} of {deck.slides.length}</span>
            </div>
            <IconButton label="More actions" size="lg" tone="plain" tooltip={false} onClick={() => setSheet('actions')}><DotsThree size={22} weight="bold" /></IconButton>
          </motion.header>
        )}
      </AnimatePresence>
      <div
        className={s.strip}
        ref={strip}
        onScroll={(e) => {
          const el = e.currentTarget
          const i = Math.round(el.scrollLeft / el.clientWidth)
          if (i !== index) setIndex(i)
        }}
        onClick={() => setChrome((c) => !c)}
      >
        {deck.slides.map((sp, i) => (
          <div key={i} className={s.page} aria-hidden={i !== index}>
            <div className={s.slide}><SlideView slide={sp} size={deck.size} css={deck.css} interactive={i === index} /></div>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {chrome && (
          <motion.footer className={s.bottom} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            <div className={s.dots} aria-hidden>
              {deck.slides.map((_, i) => <i key={i} data-on={i === index || undefined} />)}
            </div>
            <div className={s.actions}>
              {ai && <Button variant="secondary" size="lg" icon={<ChatCircleText size={16} />} onClick={() => setSheet('ask')}>Ask</Button>}
              <Button variant="primary" size="lg" icon={<Play size={16} weight="fill" />} onClick={() => setPresenting(true)}>Present</Button>
            </div>
          </motion.footer>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sheet === 'actions' && <ActionSheet ids={[deck.id]} ctx={{ open: () => setSheet(null), pickFolder: () => setSheet('move'), inTrash: false }} onClose={() => setSheet((x) => (x === 'actions' ? null : x))} />}
        {sheet === 'move' && <FolderSheet ids={[deck.id]} onClose={() => setSheet(null)} />}
        {sheet === 'ask' && <Sheet label="Ask Ream" full onClose={() => setSheet(null)}><div className={s.askSheet}><AgentPanel deck={deck} slide={index} onClose={() => setSheet(null)} /></div></Sheet>}
        {presenting && <Present deck={deck} start={index} onExit={(i) => { setPresenting(false); setIndex(i) }} />}
      </AnimatePresence>
    </div>
  )
}
