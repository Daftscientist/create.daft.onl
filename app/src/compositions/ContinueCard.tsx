// Mobile Recents hero: the deck you were last in, resumed at your slide, with a labelled Present.
import { Play } from '@phosphor-icons/react'
import type { Deck } from '../data/types'
import { Button } from '../ui/Button'
import { DeckThumb } from './DeckThumb'
import s from './ContinueCard.module.css'

export function ContinueCard({ deck, onOpen, onPresent }: { deck: Deck; onOpen: () => void; onPresent: () => void }) {
  const at = Math.min(deck.lastSlide, deck.slides.length - 1)
  return (
    <article className={s.card}>
      <button type="button" className={s.media} onClick={onOpen} aria-label={`Continue ${deck.name} at slide ${at + 1}`}>
        <DeckThumb deck={deck} slide={at} />
      </button>
      <div className={s.foot}>
        <div className={s.text}>
          <span className={s.name}>{deck.name}</span>
          <span className={s.meta}>Slide {at + 1} of {deck.slides.length}</span>
        </div>
        <Button variant="primary" size="lg" icon={<Play size={16} weight="fill" />} onClick={onPresent}>Present</Button>
      </div>
    </article>
  )
}
