// Quick Look (DESIGN.md §6): Space on a deck. The cover grows out of its tile; ←/→ page; Esc/Space close.
import { ArrowSquareOut, CaretLeft, CaretRight } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import { useEffect } from 'react'
import { getLibrary, openDeck } from '../data/library'
import { gentle } from '../lib/motion'
import { navigate } from '../lib/router'
import { SlideView } from '../slides/SlideView'
import { Button, IconButton } from '../ui/Button'
import { Overlay } from '../ui/Overlay'
import s from './QuickLook.module.css'

export function QuickLook({ deckId, slide, onSlide, onClose }: { deckId: string; slide: number; onSlide: (n: number) => void; onClose: () => void }) {
  const deck = getLibrary().entries[deckId]
  const n = deck?.type === 'deck' ? deck.slides.length : 0
  useEffect(() => {
    // React may flush this effect inside the keydown that opened Quick Look; ignore that same event.
    const since = performance.now()
    const onKey = (e: KeyboardEvent) => {
      if (e.timeStamp <= since) return
      if (e.key === 'ArrowRight') { e.preventDefault(); onSlide(Math.min(n - 1, slide + 1)) }
      if (e.key === 'ArrowLeft') { e.preventDefault(); onSlide(Math.max(0, slide - 1)) }
      if (e.key === ' ') { e.preventDefault(); onClose() }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [n, slide, onSlide, onClose])
  if (!deck || deck.type !== 'deck') return null
  const open = () => { onClose(); openDeck(deck.id); navigate({ name: 'deck', deckId: deck.id, slide }) }

  return (
    <Overlay label={`Quick Look: ${deck.name}`} onClose={onClose}>
      <div className={s.stage}>
        <motion.div layoutId={`ql-${deck.id}`} className={s.slide} transition={gentle}>
          <SlideView slide={deck.slides[slide]} interactive />
        </motion.div>
        <motion.div
          className={`${s.bar} glass`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0, transition: { ...gentle, delay: 0.05 } }}
          exit={{ opacity: 0, transition: { duration: 0.1 } }}
        >
          <span className={s.name}>{deck.name}</span>
          <span className={s.pos} aria-live="polite">Slide {slide + 1} of {n}</span>
          <div className={s.nav}>
            <IconButton label="Previous slide" hint="←" side="top" tone="plain" disabled={slide === 0} onClick={() => onSlide(slide - 1)}><CaretLeft size={16} /></IconButton>
            <IconButton label="Next slide" hint="→" side="top" tone="plain" disabled={slide >= n - 1} onClick={() => onSlide(slide + 1)}><CaretRight size={16} /></IconButton>
          </div>
          <Button variant="primary" icon={<ArrowSquareOut size={15} />} onClick={open}>Open</Button>
        </motion.div>
      </div>
    </Overlay>
  )
}
