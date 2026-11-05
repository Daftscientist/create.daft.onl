// The keyboard map, in one place: the Shortcuts settings page renders it and hints read from it.
// (Handlers live with their surfaces; keep this list in step with them.)
import { modKey } from './shell'

const mod = modKey === '⌘' ? '⌘' : 'Ctrl'

export type Shortcut = { keys: string[][]; label: string }
export type ShortcutGroup = { title: string; items: Shortcut[] }

export const KEYMAP: ShortcutGroup[] = [
  {
    title: 'Anywhere',
    items: [
      { keys: [[mod, 'K']], label: 'Search decks, slides and actions' },
      { keys: [[mod, ',']], label: 'Open Settings' },
      { keys: [['Esc']], label: 'Close, clear the selection, or go back' },
    ],
  },
  {
    title: 'In your library',
    items: [
      { keys: [['↑'], ['↓'], ['←'], ['→']], label: 'Move between items' },
      { keys: [['Enter']], label: 'Open' },
      { keys: [['Space']], label: 'Quick Look' },
      { keys: [[mod, 'A']], label: 'Select all' },
      { keys: [[mod, 'Space']], label: 'Add or remove the focused item' },
      { keys: [['Shift', '↑']], label: 'Extend the selection' },
      { keys: [['F2']], label: 'Rename' },
      { keys: [[mod, 'D']], label: 'Duplicate' },
      { keys: [['S']], label: 'Star or unstar' },
      { keys: [[mod, '⌫'], ['Delete']], label: 'Move to Trash' },
      { keys: [['Shift', 'F10']], label: 'Open the actions menu' },
    ],
  },
  {
    title: 'In a deck',
    items: [
      { keys: [['←'], ['→']], label: 'Previous or next slide' },
      { keys: [['Esc']], label: 'Back to your library' },
    ],
  },
]

export const shortcutFor = (label: string) => KEYMAP.flatMap((g) => g.items).find((i) => i.label === label)?.keys[0]
