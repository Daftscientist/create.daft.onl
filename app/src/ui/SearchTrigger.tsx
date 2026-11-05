// Desktop search pill. It is the command palette's trigger, not a second search box.
import { MagnifyingGlass } from '@phosphor-icons/react'
import { modKey } from '../lib/shell'
import { Keys } from './Button'
import s from './SearchTrigger.module.css'

export function SearchTrigger({ onOpen, placeholder = 'Search decks and slides' }: { onOpen: () => void; placeholder?: string }) {
  return (
    <button type="button" className={s.trigger} onClick={onOpen} aria-keyshortcuts={`${modKey === '⌘' ? 'Meta' : 'Control'}+K`}>
      <MagnifyingGlass size={16} />
      <span className={s.text}>{placeholder}</span>
      <Keys keys={[modKey, 'K']} />
    </button>
  )
}
