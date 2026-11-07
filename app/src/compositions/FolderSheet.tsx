// Mobile "Move to project": a sheet of projects (and out of one). Desktop uses the same rules via a menu.
import { FolderSimple, FolderSimpleDashed } from '@phosphor-icons/react'
import { getLibrary, move, projects } from '../data/library'
import { Sheet, SheetActions, SheetTitle } from '../ui/Sheet'

export function FolderSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const lib = getLibrary()
  const decks = ids.filter((i) => lib.entries[i]?.type === 'deck')
  const here = decks.length === 1 ? lib.entries[decks[0]]?.parentId ?? null : undefined
  return (
    <Sheet label="Move to" onClose={onClose} header={<SheetTitle>Move {decks.length === 1 ? `“${lib.entries[decks[0]]?.name}”` : `${decks.length} decks`} to</SheetTitle>}>
      <SheetActions
        onDone={onClose}
        groups={[[
          ...projects(lib).filter((f) => f.id !== here).map((f) => ({ label: f.name, icon: <FolderSimple size={20} />, run: () => move(decks, f.id) })),
          ...(here !== null ? [{ label: 'Not in a project', icon: <FolderSimpleDashed size={20} />, run: () => move(decks, null) }] : []),
        ]]}
      />
    </Sheet>
  )
}
