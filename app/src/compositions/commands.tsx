// One command inventory for every layout (VISION.md "Commands"). Desktop renders it as a context
// menu; mobile renders the same list as an action sheet.
import {
  ArrowCounterClockwise, ArrowSquareOut, Copy, DownloadSimple, Eye, FolderSimple, PencilSimple, Star, Trash, X,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import {
  deleteForever, download, duplicate, getLibrary, restore, toggleStar, trash,
} from '../data/library'
import type { Entry } from '../data/types'
import { modKey } from '../lib/shell'
import { HtmlMark, PptxMark } from '../ui/FileMarks'
import type { MenuItem } from '../ui/Menu'

export type CommandContext = {
  open: (e: Entry) => void
  preview?: (deckId: string) => void
  startRename?: (id: string) => void
  pickFolder: (ids: string[]) => void
  inTrash: boolean
  touch?: boolean
}

export function commandsFor(ids: string[], ctx: CommandContext, header?: ReactNode): MenuItem[] {
  const lib = getLibrary()
  const entries = ids.map((i) => lib.entries[i]).filter(Boolean)
  if (!entries.length) return []
  const single = entries.length === 1 ? entries[0] : null
  const readyDecks = entries.filter((e) => e.type === 'deck' && e.status === 'ready').map((e) => e.id)
  const k = (key: string) => (ctx.touch ? undefined : key)
  const items: MenuItem[] = []
  if (header) items.push({ kind: 'header', content: header }, { kind: 'sep' })

  if (ctx.inTrash) {
    items.push(
      { label: 'Restore', icon: <ArrowCounterClockwise size={16} />, run: () => restore(ids) },
      { kind: 'sep' },
      { label: 'Delete permanently', icon: <X size={16} />, danger: true, run: () => deleteForever(ids) },
    )
    return items
  }

  if (single) {
    items.push({ label: 'Open', icon: <ArrowSquareOut size={16} />, hint: k('↵'), run: () => ctx.open(single) })
    if (single.type === 'deck' && ctx.preview && single.status === 'ready')
      items.push({ label: 'Quick Look', icon: <Eye size={16} />, hint: k('Space'), run: () => ctx.preview!(single.id) })
    items.push({ kind: 'sep' })
  }
  if (readyDecks.length) {
    items.push(
      { label: readyDecks.length > 1 ? `Download ${readyDecks.length} as PowerPoint` : 'Download PowerPoint', icon: <PptxMark width={16} height={16} />, run: () => download(readyDecks, 'pptx') },
      { label: readyDecks.length > 1 ? `Download ${readyDecks.length} as HTML` : 'Download HTML', icon: <HtmlMark width={16} height={16} />, run: () => download(readyDecks, 'html') },
    )
    if (single?.type === 'deck' && single.simplified)
      items.push({ label: 'Download original', icon: <DownloadSimple size={16} />, run: () => download([single.id], 'pptx') })
    items.push({ kind: 'sep' })
  }
  if (single && ctx.startRename) items.push({ label: 'Rename', icon: <PencilSimple size={16} />, hint: k('F2'), run: () => ctx.startRename!(single.id) })
  if (single?.type === 'deck' && single.status === 'ready')
    items.push({ label: 'Duplicate', icon: <Copy size={16} />, hint: k(`${modKey}D`), run: () => duplicate(single.id) })
  items.push(
    { label: 'Move to…', icon: <FolderSimple size={16} />, run: () => ctx.pickFolder(ids) },
    {
      label: entries.every((e) => e.starred) ? 'Remove star' : 'Star',
      icon: <Star size={16} weight={entries.every((e) => e.starred) ? 'fill' : 'regular'} />,
      run: () => toggleStar(ids),
    },
    { kind: 'sep' },
    { label: 'Move to Trash', icon: <Trash size={16} />, hint: k(`${modKey}⌫`), danger: true, run: () => trash(ids) },
  )
  return items
}
