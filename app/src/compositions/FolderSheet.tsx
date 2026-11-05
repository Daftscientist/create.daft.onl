// Mobile "Move to…": a sheet listing every valid destination. Desktop uses the same rules via a menu.
import { FolderSimple } from '@phosphor-icons/react'
import { folders, getLibrary, isWithin, move, pathTo } from '../data/library'
import { Sheet, SheetActions, SheetTitle } from '../ui/Sheet'

export function FolderSheet({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const lib = getLibrary()
  const options = folders(lib)
    .filter((f) => f.trashedAt === null && !ids.some((m) => isWithin(lib, f.id, m)))
    .map((f) => ({ f, path: pathTo(lib, f.id).map((x) => x.name) }))
    .sort((a, b) => a.path.join('/').localeCompare(b.path.join('/')))
  return (
    <Sheet label="Move to" onClose={onClose} header={<SheetTitle>Move {ids.length === 1 ? `“${lib.entries[ids[0]]?.name}”` : `${ids.length} items`} to</SheetTitle>}>
      <SheetActions
        onDone={onClose}
        groups={[[
          { label: 'Files', icon: <FolderSimple size={20} />, run: () => move(ids, null) },
          ...options.map(({ f, path }) => ({ label: path.join(' / '), icon: <FolderSimple size={20} />, run: () => move(ids, f.id) })),
        ]]}
      />
    </Sheet>
  )
}
