// The one file browser (desktop). Recents, Files, Starred and Trash are all this component with
// different entries. Owns: selection, the keyboard map (DESIGN.md §6 Deck tile), context menu,
// rename, Move to…, drag-to-folder, and the selection bar.
import { DownloadSimple, FolderSimple, Trash as TrashIcon, ArrowCounterClockwise, X } from '@phosphor-icons/react'
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  deleteForever, download, duplicate, folders as allFolders, getLibrary, isWithin, move, pathTo, rename, restore,
  retryImport, toggleStar, trash, useLibrary,
} from '../data/library'
import type { Entry } from '../data/types'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { commandsFor } from './commands'
import { dwellOn, endDrag, getDnd, hasFiles, hasIds, MIME, setOver, startInternal, useDnd } from './dnd'
import { EntryRow } from './EntryRow'
import { EntryTile } from './EntryTile'
import { SelectionBar } from './SelectionBar'
import s from './Collection.module.css'

export type CollectionProps = {
  entries: Entry[]
  view: 'grid' | 'list'
  label: string
  inTrash?: boolean
  meta?: (e: Entry) => string | undefined
  onOpen: (e: Entry) => void
  onPreview: (deckId: string) => void
  onOpenFolder: (folderId: string) => void
  empty?: ReactNode
  /** Grid only: larger tiles (Jump back in row). */
  size?: 'md' | 'lg'
  /** Shared-element ids for Quick Look. */
  layoutPrefix?: string
}

// Only one collection on screen holds a selection at a time (Recents shows two collections).
let activeCollection: string | null = null
const activeListeners = new Set<() => void>()
const setActiveCollection = (id: string | null) => { activeCollection = id; activeListeners.forEach((l) => l()) }
const useActiveCollection = () => useSyncExternalStore((l) => (activeListeners.add(l), () => activeListeners.delete(l)), () => activeCollection)

export function Collection(p: CollectionProps) {
  const self = useId()
  const active = useActiveCollection()
  useLibrary() // re-render on library changes (folder counts, names)
  const { entries, inTrash = false } = p
  const ids = useMemo(() => entries.map((e) => e.id), [entries])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [focus, setFocus] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[]; label: string } | null>(null)
  const dnd = useDnd()
  const root = useRef<HTMLDivElement>(null)

  // Keep selection and focus valid when entries change underneath (delete, move, import).
  useEffect(() => {
    setSelected((prev) => {
      const next = new Set([...prev].filter((i) => ids.includes(i)))
      return next.size === prev.size ? prev : next
    })
    setFocus((f) => (f && ids.includes(f) ? f : null))
  }, [ids])

  useEffect(() => { if (active !== self) setSelected((prev) => (prev.size ? new Set() : prev)) }, [active, self])
  useEffect(() => { if (selected.size) setActiveCollection(self) }, [selected, self])

  const selectOnly = (id: string) => { setSelected(new Set([id])); setAnchor(id); setFocus(id) }
  const toggle = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
    setAnchor(id); setFocus(id)
  }
  const range = (to: string, additive = false) => {
    const a = ids.indexOf(anchor ?? to), b = ids.indexOf(to)
    const [lo, hi] = a < b ? [a, b] : [b, a]
    setSelected((prev) => new Set([...(additive ? prev : []), ...ids.slice(lo, hi + 1)]))
    setFocus(to)
  }
  const clear = useCallback(() => setSelected(new Set()), [])

  const pickFolder = useCallback((moveIds: string[]) => {
    const lib = getLibrary()
    const r = root.current?.querySelector(`[data-id="${moveIds[0]}"]`)?.getBoundingClientRect()
    const options = allFolders(lib)
      .filter((f) => f.trashedAt === null && !moveIds.some((m) => isWithin(lib, f.id, m)))
      .map((f) => ({ f, path: pathTo(lib, f.id) }))
      .sort((a, b) => a.path.map((x) => x.name).join('/').localeCompare(b.path.map((x) => x.name).join('/')))
    setMenu({
      label: 'Move to',
      anchor: r ? { x: r.left + 12, y: r.top + 40 } : { x: innerWidth / 2 - 120, y: innerHeight / 3 },
      items: [
        { kind: 'header', content: <span className={s.menuTitle}>Move {moveIds.length === 1 ? `“${lib.entries[moveIds[0]]?.name}”` : `${moveIds.length} items`} to</span> },
        { label: 'Files', icon: <FolderSimple size={16} />, run: () => move(moveIds, null) },
        ...options.map(({ f, path }) => ({
          label: `${' '.repeat(path.length - 1)}${f.name}`,
          icon: <FolderSimple size={16} />,
          run: () => move(moveIds, f.id),
        })),
      ],
    })
  }, [])

  const ctx = useMemo(() => ({
    open: p.onOpen, preview: p.onPreview, startRename: (i: string) => setRenaming(i), pickFolder, inTrash,
  }), [p.onOpen, p.onPreview, pickFolder, inTrash])

  const openMenu = (forIds: string[], at: MenuAnchor) => setMenu({ anchor: at, items: commandsFor(forIds, ctx), label: 'Actions' })

  const activate = (e: Entry) => (e.type === 'folder' ? p.onOpenFolder(e.id) : p.onOpen(e))

  // ---------- pointer ----------
  const idFrom = (t: EventTarget) => (t as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id ?? null

  const onClick = (e: React.MouseEvent) => {
    const id = idFrom(e.target)
    if (!id) { if (!e.shiftKey && !e.metaKey && !e.ctrlKey) clear(); return }
    if (e.shiftKey) range(id, e.metaKey || e.ctrlKey)
    else if (e.metaKey || e.ctrlKey) toggle(id)
    else selectOnly(id)
  }
  const onDoubleClick = (e: React.MouseEvent) => {
    const id = idFrom(e.target)
    const entry = id ? getLibrary().entries[id] : null
    if (entry && !(entry.type === 'deck' && entry.status !== 'ready')) activate(entry)
  }
  const onContextMenu = (e: React.MouseEvent) => {
    const id = idFrom(e.target)
    if (!id) return
    e.preventDefault()
    const forIds = selected.has(id) ? [...selected] : [id]
    if (!selected.has(id)) selectOnly(id)
    openMenu(forIds, { x: e.clientX, y: e.clientY })
  }

  // ---------- keyboard ----------
  const neighbour = (from: string, dir: 'left' | 'right' | 'up' | 'down') => {
    if (p.view === 'list' || dir === 'left' || dir === 'right') {
      const i = ids.indexOf(from)
      const step = dir === 'left' || dir === 'up' ? -1 : 1
      return ids[Math.min(ids.length - 1, Math.max(0, i + step))]
    }
    const el = root.current?.querySelector<HTMLElement>(`[data-id="${from}"]`)
    if (!el) return from
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width / 2
    let best: { id: string; d: number } | null = null
    for (const c of root.current!.querySelectorAll<HTMLElement>('[data-id]')) {
      const cr = c.getBoundingClientRect()
      const ok = dir === 'down' ? cr.top > r.bottom - 4 : cr.bottom < r.top + 4
      if (!ok) continue
      const d = Math.abs(cr.top - r.top) * 4 + Math.abs(cr.left + cr.width / 2 - cx)
      if (!best || d < best.d) best = { id: c.dataset.id!, d }
    }
    return best?.id ?? from
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).matches('input, textarea')) return
    const mod = e.metaKey || e.ctrlKey
    const cur = focus ?? ids[0]
    if (!cur) return
    const arrows: Record<string, 'left' | 'right' | 'up' | 'down'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }
    const lib = getLibrary()
    const sel = selected.size ? [...selected] : [cur]
    if (arrows[e.key]) {
      e.preventDefault()
      const next = focus ? neighbour(cur, arrows[e.key]) : cur
      if (e.shiftKey) range(next)
      else if (mod) setFocus(next)
      else selectOnly(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const entry = lib.entries[cur]
      if (entry && !inTrash) activate(entry)
    } else if (e.key === 'F2' && !inTrash) {
      e.preventDefault(); setRenaming(cur)
    } else if (e.key === ' ') {
      e.preventDefault()
      if (mod) toggle(cur)
      else if (lib.entries[cur]?.type === 'deck' && !inTrash) p.onPreview(cur)
    } else if (e.key === 'Escape') {
      if (selected.size) { e.preventDefault(); e.stopPropagation(); clear() }
    } else if (mod && e.key.toLowerCase() === 'a') {
      e.preventDefault(); setSelected(new Set(ids))
    } else if ((mod && e.key === 'Backspace') || e.key === 'Delete') {
      e.preventDefault()
      if (inTrash) deleteForever(sel); else trash(sel)
    } else if (!mod && e.key.toLowerCase() === 's' && !inTrash) {
      e.preventDefault(); toggleStar(sel)
    } else if (mod && e.key.toLowerCase() === 'd' && !inTrash) {
      e.preventDefault(); if (lib.entries[cur]?.type === 'deck') duplicate(cur)
    }
  }

  // ---------- drag ----------
  const onDragStart = (e: React.DragEvent) => {
    const id = idFrom(e.target)
    if (!id || inTrash) return e.preventDefault()
    const dragIds = selected.has(id) ? [...selected] : [id]
    if (!selected.has(id)) selectOnly(id)
    e.dataTransfer.setData(MIME, JSON.stringify(dragIds))
    e.dataTransfer.effectAllowed = 'move'
    startInternal(dragIds)
  }
  const onDragOver = (e: React.DragEvent) => {
    const folder = (e.target as HTMLElement).closest<HTMLElement>('[data-drop-folder]')?.dataset.dropFolder ?? null
    if (hasIds(e)) {
      const drag = getDnd().drag
      const valid = folder && drag.kind === 'internal' && !drag.ids.includes(folder) && !drag.ids.some((i) => isWithin(getLibrary(), folder, i))
      if (valid) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
      setOver(valid ? folder : null)
      dwellOn(valid ? folder : null, (fid) => { endDrag(); p.onOpenFolder(fid) })
    } else if (hasFiles(e)) {
      setOver(folder)
      dwellOn(null, () => {})
    }
  }
  const onDrop = (e: React.DragEvent) => {
    if (!hasIds(e)) return
    e.preventDefault()
    const folder = getDnd().over
    const dragIds = JSON.parse(e.dataTransfer.getData(MIME) || '[]') as string[]
    if (folder) { move(dragIds, folder); clear() }
    dwellOn(null, () => {})
    endDrag()
  }

  // ---------- render ----------
  const handlers = useMemo(() => ({
    onMenu: (id: string, at: MenuAnchor) => {
      const forIds = selected.has(id) ? [...selected] : [id]
      if (!selected.has(id)) selectOnly(id)
      openMenu(forIds, at)
    },
    onRename: (id: string, name: string | null) => { setRenaming(null); if (name !== null) rename(id, name); setFocus(id) },
    onRetry: retryImport,
    onRemove: (id: string) => deleteForever([id]),
  }), [selected, ctx]) // eslint-disable-line react-hooks/exhaustive-deps

  const selIds = [...selected]
  const selDecks = selIds.filter((i) => getLibrary().entries[i]?.type === 'deck')
  const barActions = inTrash
    ? [
        { label: 'Restore', icon: <ArrowCounterClockwise size={16} />, run: () => { restore(selIds); clear() } },
        { label: 'Delete', icon: <X size={16} />, danger: true, run: () => { deleteForever(selIds); clear() } },
      ]
    : [
        ...(selDecks.length ? [{ label: 'Download', icon: <DownloadSimple size={16} />, run: () => download(selDecks, 'pptx') }] : []),
        { label: 'Move', icon: <FolderSimple size={16} />, run: () => pickFolder(selIds) },
        { label: 'Delete', icon: <TrashIcon size={16} />, danger: true, run: () => { trash(selIds); clear() } },
      ]

  if (!entries.length) return <>{p.empty}</>

  const firstFocusable = focus ?? ids[0]
  return (
    <>
      <div
        ref={root}
        role="listbox"
        aria-label={p.label}
        aria-multiselectable
        data-collection
        className={p.view === 'grid' ? s.grid : s.list}
        data-size={p.size ?? 'md'}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
        onFocus={(e) => { const id = idFrom(e.target); if (id && id !== focus) setFocus(id) }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onDragEnd={() => { endDrag(); dwellOn(null, () => {}) }}
      >
        {p.view === 'list' && <EntryRow.Header />}
        {entries.map((e) => {
          const st = {
            selected: selected.has(e.id),
            focused: e.id === firstFocusable,
            renaming: renaming === e.id,
            dropTarget: dnd.over === e.id && dnd.drag.kind !== 'none',
          }
          return p.view === 'grid'
            ? <EntryTile key={e.id} entry={e} state={st} handlers={handlers} meta={p.meta?.(e)} layoutId={p.layoutPrefix ? `${p.layoutPrefix}${e.id}` : undefined} />
            : <EntryRow key={e.id} entry={e} state={st} handlers={handlers} />
        })}
      </div>
      <SelectionBar count={selected.size} actions={barActions} onClear={clear} />
      <Menu open={!!menu} anchor={menu?.anchor ?? null} items={menu?.items ?? []} label={menu?.label ?? ''} onClose={() => setMenu(null)} />
    </>
  )
}
