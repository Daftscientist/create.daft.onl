// A deck's cover (or any slide) with its engine states. Every thumbnail in the app is this component.
import { Warning } from '@phosphor-icons/react'
import { motion } from 'motion/react'
import type { Deck } from '../data/types'
import { Slide } from '../slides/Slide'
import s from './DeckThumb.module.css'

const PHASE_LABEL = { queued: 'Waiting for engine', reading: 'Reading file', converting: 'Converting slides', saving: 'Saving' }

export function DeckThumb({ deck, slide = 0, layoutId, className }: { deck: Deck; slide?: number; layoutId?: string; className?: string }) {
  if (deck.status === 'importing') {
    return (
      <div className={`${s.thumb} ${s.state} ${className ?? ''}`}>
        <span className={s.phase}>{PHASE_LABEL[deck.phase ?? 'queued']}…</span>
        <span className={s.track}><motion.i className={s.fill} animate={{ width: `${Math.max(6, (deck.progress ?? 0) * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 24 }} /></span>
      </div>
    )
  }
  if (deck.status === 'failed') {
    return (
      <div className={`${s.thumb} ${s.state} ${s.failed} ${className ?? ''}`}>
        <Warning size={18} weight="fill" />
        <span className={s.phase}>Couldn’t import</span>
      </div>
    )
  }
  const spec = deck.slides[Math.min(slide, deck.slides.length - 1)]
  return (
    <motion.div layoutId={layoutId} className={`${s.thumb} ${className ?? ''}`}>
      <Slide spec={spec} theme={deck.theme} />
    </motion.div>
  )
}
