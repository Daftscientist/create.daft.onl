// Mobile viewer (VISION: view first, present easily). Swipe through slides, tap toggles controls,
// labelled Present, resumes at your last slide.
import { CaretLeft, DotsThree, Play } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { ActionSheet } from '../compositions/ActionSheet'
import { FolderSheet } from '../compositions/FolderSheet'
import { setLastSlide, useLibrary } from '../data/library'
import { back, navigate } from '../lib/router'
import { Slide } from '../slides/Slide'
import { Button, IconButton } from '../ui/Button'
import { EmptyState } from '../compositions/PageHeader'
import s from './Viewer.module.css'

export function MobileViewer({ deckId, slide }: { deckId: string; slide?: number }) {
  const lib = useLibrary()
  const deck = lib.entries[deckId]
  const strip = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(() => slide ?? (deck?.type === 'deck' ? deck.lastSlide : 0))
  const [chrome, setChrome] = useState(true)
  const [sheet, setSheet] = useState<'actions' | 'move' | null>(null)

  useEffect(() => {
    const el = strip.current
    if (el) el.scrollTo({ left: index * el.clientWidth, behavior: 'instant' as ScrollBehavior })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (deck?.type === 'deck') setLastSlide(deck.id, index) }, [index]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const present = () => strip.current?.parentElement?.requestFullscreen?.().catch(() => {})
    document.addEventListener('office:present', present)
    return () => document.removeEventListener('office:present', present)
  }, [])

  if (!deck || deck.type !== 'deck') {
    return <EmptyState icon={<CaretLeft size={24} />} title="This deck isn’t available" body="It may have been moved to Trash."><Button variant="secondary" onClick={() => navigate({ name: 'home' })}>Back to Recents</Button></EmptyState>
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
            <div className={s.slide}><Slide spec={sp} theme={deck.theme} /></div>
          </div>
        ))}
      </div>
      <AnimatePresence>
        {chrome && (
          <motion.footer className={s.bottom} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}>
            <div className={s.dots} aria-hidden>
              {deck.slides.map((_, i) => <i key={i} data-on={i === index || undefined} />)}
            </div>
            <Button variant="primary" size="lg" icon={<Play size={16} weight="fill" />} onClick={() => strip.current?.parentElement?.requestFullscreen?.().catch(() => {})}>Present</Button>
          </motion.footer>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {sheet === 'actions' && <ActionSheet ids={[deck.id]} ctx={{ open: () => setSheet(null), pickFolder: () => setSheet('move'), inTrash: false }} onClose={() => setSheet((x) => (x === 'actions' ? null : x))} />}
        {sheet === 'move' && <FolderSheet ids={[deck.id]} onClose={() => setSheet(null)} />}
      </AnimatePresence>
    </div>
  )
}
