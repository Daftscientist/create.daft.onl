// Desktop sidebar (DESIGN.md §6 Sidebar): sits on the frame, no panel, no glass.
import {
  CaretRight, ClockCounterClockwise, FolderSimple, GearSix, Plus, Star, Trash,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { childrenOf, folders, isLive, isTrashRoot, isWithin, move, newFolder, useLibrary, getLibrary, importFiles } from '../data/library'
import type { Folder } from '../data/types'
import { relTimeInline } from '../lib/format'
import { navigate, type Route } from '../lib/router'
import { dwellOn, endDrag, getDnd, hasFiles, hasIds, MIME, setOver, useDnd } from '../compositions/dnd'
import { BrandLockup } from '../ui/Brand'
import { IconButton } from '../ui/Button'
import { SyncStatus } from '../compositions/SyncStatus'
import { modKey } from '../lib/shell'
import s from './Sidebar.module.css'

export function Sidebar({ route }: { route: Route }) {
  const lib = useLibrary()
  const starred = Object.values(lib.entries).filter((e) => e.starred && isLive(e)).length
  const trashed = Object.values(lib.entries).filter(isTrashRoot).length
  const top = folders(lib).filter((f) => f.parentId === null && isLive(f)).sort((a, b) => a.name.localeCompare(b.name))
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(route.name === 'files' && route.folderId ? ancestors(route.folderId) : []))

  const nav = [
    { route: { name: 'home' } as Route, label: 'Recents', icon: <ClockCounterClockwise size={18} />, active: route.name === 'home' },
    { route: { name: 'files', folderId: null } as Route, label: 'Files', icon: <FolderSimple size={18} />, active: route.name === 'files' && !route.folderId, drop: '' },
    { route: { name: 'starred' } as Route, label: 'Starred', icon: <Star size={18} />, active: route.name === 'starred', count: starred },
    { route: { name: 'trash' } as Route, label: 'Trash', icon: <Trash size={18} />, active: route.name === 'trash', count: trashed },
  ]

  return (
    <aside className={s.sidebar} aria-label="Library">
      <div className={s.brand}>
        <BrandLockup />
        <IconButton label="Settings" hint={`${modKey},`} size="sm" tone="plain" onClick={() => navigate({ name: 'settings', section: null })}>
          <GearSix size={17} />
        </IconButton>
      </div>

      <nav className={s.nav}>
        {nav.map((n) => (
          <NavItem key={n.label} {...n} onClick={() => navigate(n.route)} />
        ))}
      </nav>

      <div className={s.section}>
        <div className={s.sectionHead}>
          <span>Folders</span>
          <IconButton label="New folder" size="sm" tone="plain" side="right" className={s.add} onClick={() => {
            const id = newFolder(null)
            navigate({ name: 'files', folderId: id })
          }}>
            <Plus size={14} />
          </IconButton>
        </div>
        <div className={s.tree} role="tree" aria-label="Folders">
          {top.map((f) => (
            <FolderNode key={f.id} folder={f} depth={0} route={route} expanded={expanded} setExpanded={setExpanded} />
          ))}
        </div>
      </div>

      <div className={s.footer}>
        <SyncStatus noticeShown={route.name === 'home'} sub={lib.lastBackupAt ? `Backed up ${relTimeInline(lib.lastBackupAt)}` : 'Not backed up yet'} />
      </div>
    </aside>
  )
}

function ancestors(id: string): string[] {
  const out: string[] = []
  let cur = getLibrary().entries[id]
  while (cur?.parentId) { out.push(cur.parentId); cur = getLibrary().entries[cur.parentId] }
  return out
}

export function NavItem({ label, icon, active, count, onClick, drop }: { label: string; icon: React.ReactNode; active: boolean; count?: number; onClick: () => void; drop?: string }) {
  const dnd = useDnd()
  const over = drop !== undefined && dnd.over === drop && dnd.drag.kind !== 'none'
  return (
    <button
      type="button"
      className={s.item}
      aria-current={active ? 'page' : undefined}
      data-drop={over || undefined}
      onClick={onClick}
      {...(drop !== undefined ? dropHandlers(drop) : {})}
    >
      <span className={s.icon}>{icon}</span>
      <span className={s.label}>{label}</span>
      {!!count && <span className={s.count}>{count}</span>}
    </button>
  )
}

/** Sidebar folders accept internal moves and external files. '' = Files root. */
function dropHandlers(folderId: string) {
  const target = folderId || null
  return {
    onDragOver: (e: React.DragEvent) => {
      const drag = getDnd().drag
      const internalOk = hasIds(e) && drag.kind === 'internal' && !drag.ids.includes(folderId) && !(target && drag.ids.some((i) => isWithin(getLibrary(), target, i)))
      if (internalOk || hasFiles(e)) {
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = internalOk ? 'move' : 'copy'
        setOver(folderId)
        if (target) dwellOn(target, (id) => navigate({ name: 'files', folderId: id }))
      }
    },
    onDragLeave: () => { setOver(null); dwellOn(null, () => {}) },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (hasIds(e)) move(JSON.parse(e.dataTransfer.getData(MIME) || '[]'), target)
      else if (hasFiles(e)) {
        const files = [...e.dataTransfer.files]
        const pptx = files.filter((f) => /\.pptx$/i.test(f.name))
        if (pptx.length) importFiles(pptx, target)
      }
      dwellOn(null, () => {})
      endDrag()
    },
  }
}

function FolderNode({ folder, depth, route, expanded, setExpanded }: {
  folder: Folder
  depth: number
  route: Route
  expanded: Set<string>
  setExpanded: (fn: (s: Set<string>) => Set<string>) => void
}) {
  const lib = useLibrary()
  const dnd = useDnd()
  const kids = childrenOf(lib, folder.id).filter((e): e is Folder => e.type === 'folder').sort((a, b) => a.name.localeCompare(b.name))
  const open = expanded.has(folder.id)
  const active = route.name === 'files' && route.folderId === folder.id
  const over = dnd.over === folder.id && dnd.drag.kind !== 'none'
  return (
    <div role="treeitem" aria-expanded={kids.length ? open : undefined} aria-selected={active}>
      <div className={s.folderRow} style={{ paddingLeft: 4 + depth * 14 }}>
        <button
          type="button"
          className={s.caret}
          aria-label={open ? `Collapse ${folder.name}` : `Expand ${folder.name}`}
          data-open={open || undefined}
          style={{ visibility: kids.length ? 'visible' : 'hidden' }}
          onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(folder.id)) n.delete(folder.id); else n.add(folder.id); return n })}
        >
          <CaretRight size={10} weight="bold" />
        </button>
        <button
          type="button"
          className={`${s.item} ${s.folderItem}`}
          aria-current={active ? 'page' : undefined}
          data-drop={over || undefined}
          onClick={() => navigate({ name: 'files', folderId: folder.id })}
          {...dropHandlers(folder.id)}
        >
          <span className={s.icon}><FolderSimple size={16} weight={active ? 'fill' : 'regular'} /></span>
          <span className={s.label}>{folder.name}</span>
        </button>
      </div>
      {open && kids.map((k) => <FolderNode key={k.id} folder={k} depth={depth + 1} route={route} expanded={expanded} setExpanded={setExpanded} />)}
    </div>
  )
}
