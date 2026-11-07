// Desktop sidebar (DESIGN.md §6 Sidebar): sits on the frame, no panel, no glass.
import { FolderSimple, GearSix, House, Plus, SquaresFour, Star, Trash } from '@phosphor-icons/react'
import { deckCount, isLive, isTrashRoot, isWithin, move, newProject, projects, useLibrary, getLibrary, importFiles } from '../data/library'
import { renameOnArrival } from '../lib/arrival'
import type { Folder } from '../data/types'
import { relTimeInline } from '../lib/format'
import { navigate, type Route } from '../lib/router'
import { dwellOn, endDrag, getDnd, hasFiles, hasIds, MIME, setOver, useDnd } from '../compositions/dnd'
import { AccountButton } from '../compositions/AccountSwitcher'
import { IconButton } from '../ui/Button'
import { SyncStatus } from '../compositions/SyncStatus'
import { modKey } from '../lib/shell'
import s from './Sidebar.module.css'

export function Sidebar({ route }: { route: Route }) {
  const lib = useLibrary()
  const starred = Object.values(lib.entries).filter((e) => e.starred && isLive(e)).length
  const trashed = Object.values(lib.entries).filter(isTrashRoot).length
  const list = projects(lib)

  const nav = [
    { route: { name: 'home' } as Route, label: 'Home', icon: <House size={18} />, active: route.name === 'home' },
    { route: { name: 'files', folderId: null } as Route, label: 'Projects', icon: <SquaresFour size={18} />, active: route.name === 'files' && !route.folderId, drop: '' },
    { route: { name: 'starred' } as Route, label: 'Starred', icon: <Star size={18} />, active: route.name === 'starred', count: starred },
    { route: { name: 'trash' } as Route, label: 'Trash', icon: <Trash size={18} />, active: route.name === 'trash', count: trashed },
  ]

  return (
    <aside className={s.sidebar} aria-label="Library">
      <div className={s.brand}>
        <AccountButton />
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
          <span>Projects</span>
          <IconButton label="New project" size="sm" tone="plain" side="right" className={s.add} onClick={() => {
            const id = newProject()
            renameOnArrival(id)
            navigate({ name: 'files', folderId: id })
          }}>
            <Plus size={14} />
          </IconButton>
        </div>
        <div className={s.tree} aria-label="Projects">
          {list.map((f) => <ProjectItem key={f.id} project={f} route={route} />)}
        </div>
      </div>

      <div className={s.footer}>
        <SyncStatus noticeShown={route.name === 'home'} sub={lib.lastBackupAt ? `Backed up ${relTimeInline(lib.lastBackupAt)}` : 'Not backed up yet'} />
      </div>
    </aside>
  )
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

/** Sidebar projects accept decks moved in and dropped files. '' (the Projects item) = out of any project. */
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

function ProjectItem({ project, route }: { project: Folder; route: Route }) {
  const dnd = useDnd()
  const active = route.name === 'files' && route.folderId === project.id
  const over = dnd.over === project.id && dnd.drag.kind !== 'none'
  const n = deckCount(useLibrary(), project.id)
  return (
    <button
      type="button"
      className={`${s.item} ${s.folderItem}`}
      aria-current={active ? 'page' : undefined}
      data-drop={over || undefined}
      onClick={() => navigate({ name: 'files', folderId: project.id })}
      {...dropHandlers(project.id)}
    >
      <span className={s.icon}><FolderSimple size={16} weight={active ? 'fill' : 'regular'} /></span>
      <span className={s.label}>{project.name}</span>
      {!!n && <span className={s.count}>{n}</span>}
    </button>
  )
}
