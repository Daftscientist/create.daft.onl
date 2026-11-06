// Search model shared by the desktop palette and the mobile search screen (one implementation).
import { ArrowSquareOut, Command, ClockCounterClockwise, CloudArrowUp, FolderSimple, GearSix, Plus, Star, Trash, UploadSimple } from '@phosphor-icons/react'
import { useMemo, type ReactNode } from 'react'
import { editorCommands } from '../editor/commandList'
import { backUp, decks, folders, getLibrary, isLive, newDeck, openDeck, pathTo, recents, slideText } from '../data/library'
import type { Deck } from '../data/types'
import { count, relTimeInline } from '../lib/format'
import { navigate } from '../lib/router'

export type SearchItem = { id: string; section: 'Decks' | 'Slides' | 'Folders' | 'Go to' | 'Actions' | 'Commands'; icon: ReactNode; deck?: Deck; slide?: number; title: ReactNode; sub?: ReactNode; run: () => void }

export function highlight(text: string, q: string): ReactNode {
  if (!q) return text
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return text
  const start = Math.max(0, i - 28)
  return <>{start > 0 ? '…' : ''}{text.slice(start, i)}<mark>{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length, i + q.length + 60)}</>
}

/** `onDone` closes the surface before navigating. `pickFiles` opens the import picker. */
export function useSearch(q: string, onDone: () => void, pickFiles: () => void): SearchItem[] {
  return useMemo<SearchItem[]>(() => {
    const lib = getLibrary()
    const go = (fn: () => void) => () => { onDone(); fn() }
    const openAt = (d: Deck, slide?: number) => go(() => { openDeck(d.id); navigate({ name: 'deck', deckId: d.id, slide }) })
    const where = (d: Deck) => (d.parentId ? pathTo(lib, d.parentId).map((f) => f.name).join(' / ') : 'Files')
    const query = q.trim().toLowerCase()
    const actions: SearchItem[] = [
      { id: 'a-new', section: 'Actions', icon: <Plus size={16} />, title: 'New deck', run: go(() => { const id = newDeck(null); openDeck(id); navigate({ name: 'deck', deckId: id }) }) },
      { id: 'a-import', section: 'Actions', icon: <UploadSimple size={16} />, title: 'Import .pptx…', run: go(pickFiles) },
      { id: 'a-backup', section: 'Actions', icon: <CloudArrowUp size={16} />, title: 'Back up now', run: go(() => void backUp()) },
      { id: 'g-settings', section: 'Go to', icon: <GearSix size={16} />, title: 'Settings', run: go(() => navigate({ name: 'settings', section: null })) },
      { id: 'g-recents', section: 'Go to', icon: <ClockCounterClockwise size={16} />, title: 'Home', run: go(() => navigate({ name: 'home' })) },
      { id: 'g-files', section: 'Go to', icon: <FolderSimple size={16} />, title: 'Files', run: go(() => navigate({ name: 'files', folderId: null })) },
      { id: 'g-starred', section: 'Go to', icon: <Star size={16} />, title: 'Starred', run: go(() => navigate({ name: 'starred' })) },
      { id: 'g-trash', section: 'Go to', icon: <Trash size={16} />, title: 'Trash', run: go(() => navigate({ name: 'trash' })) },
    ]
    // The open deck's editor commands come first while a deck is open.
    const commands: SearchItem[] = editorCommands().map((c) => ({ id: c.id, section: 'Commands', icon: <Command size={16} />, title: c.title, sub: c.hint, run: go(c.run), keywords: c.keywords } as SearchItem & { keywords?: string }))
    if (!query) {
      if (commands.length) return [...commands.slice(0, 8), ...actions]
      return [
        ...recents(lib, 5).map<SearchItem>((d) => ({ id: d.id, section: 'Decks', icon: <ArrowSquareOut size={16} />, deck: d, title: d.name, sub: `${where(d)} · opened ${relTimeInline(d.openedAt ?? d.modifiedAt)}`, run: openAt(d) })),
        ...actions,
      ]
    }
    const live = decks(lib).filter((d) => isLive(d) && d.status === 'ready')
    const deckHits = live.filter((d) => d.name.toLowerCase().includes(query)).slice(0, 6)
      .map<SearchItem>((d) => ({ id: d.id, section: 'Decks', icon: null, deck: d, title: highlight(d.name, q.trim()), sub: `${where(d)} · ${count(d.slides.length, 'slide')}`, run: openAt(d) }))
    const slideHits: SearchItem[] = []
    for (const d of live) {
      slideText(d).forEach((text, i) => {
        if (slideHits.length < 8 && text.toLowerCase().includes(query)) {
          slideHits.push({ id: `${d.id}:${i}`, section: 'Slides', icon: null, deck: d, slide: i, title: highlight(text, q.trim()), sub: `${d.name} · Slide ${i + 1}`, run: openAt(d, i) })
        }
      })
    }
    const folderHits = folders(lib).filter((f) => isLive(f) && f.name.toLowerCase().includes(query)).slice(0, 4)
      .map<SearchItem>((f) => ({ id: f.id, section: 'Folders', icon: <FolderSimple size={16} />, title: highlight(f.name, q.trim()), run: go(() => navigate({ name: 'files', folderId: f.id })) }))
    const actionHits = actions.filter((a) => String(a.title).toLowerCase().includes(query))
    const commandHits = commands.filter((c) => `${String(c.title)} ${(c as { keywords?: string }).keywords ?? ''}`.toLowerCase().includes(query)).map((c) => ({ ...c, title: highlight(String(c.title), q.trim()) }))
    return [...commandHits, ...deckHits, ...slideHits, ...folderHits, ...actionHits]
  }, [q, onDone, pickFiles])
}
