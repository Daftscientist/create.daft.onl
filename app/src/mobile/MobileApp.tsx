// Mobile composition (DESIGN.md §2, §6 Mobile). Composes shared compositions only.
import { GearSix, DownloadSimple, FolderSimple, FolderSimplePlus, Plus, Trash, UploadSimple } from '@phosphor-icons/react'
import { AnimatePresence } from 'motion/react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActionSheet } from '../compositions/ActionSheet'
import { FolderSheet } from '../compositions/FolderSheet'
import { pickPptx } from '../compositions/importPicker'
import type { MobileSelect } from '../compositions/MobileList'
import { download, getLibrary, newDeck, newFolder, openDeck, trash } from '../data/library'
import { toast } from '../data/toasts'
import type { Entry } from '../data/types'
import { back, navigate, useRoute } from '../lib/router'
import { BackButton, IconButton, TextButton } from '../ui/Button'
import { Sheet, SheetActions, SheetTitle } from '../ui/Sheet'
import { Toaster } from '../ui/Toaster'
import { MobileViewer } from './Viewer'
import { FilesScreen, RecentsScreen, StarredScreen, TrashScreen } from './screens'
import { SearchSheet } from './SearchSheet'
import { SettingsScreen } from './SettingsScreen'
import { SyncFlowHost } from '../compositions/SyncFlows'
import { TabBar } from './TabBar'
import s from './MobileApp.module.css'

type SheetState = { kind: 'actions'; ids: string[] } | { kind: 'move'; ids: string[] } | { kind: 'create' } | { kind: 'search' } | null

export function MobileApp() {
  const route = useRoute()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [listIds, setListIds] = useState<string[]>([])
  const routeKey = JSON.stringify(route)

  useEffect(() => { setSelecting(false); setSelected(new Set()); scrollTo({ top: 0 }) }, [routeKey])
  // Toasts sit above the floating tab bar (review: they covered navigation).
  useEffect(() => {
    document.documentElement.style.setProperty('--toast-base', '96px')
    return () => document.documentElement.style.setProperty('--toast-base', '24px')
  }, [])

  const destination = route.name === 'files' ? route.folderId : null
  const destName = destination ? getLibrary().entries[destination]?.name ?? 'Files' : 'Files'

  const open = useCallback((e: Entry) => {
    if (e.type === 'folder') return navigate({ name: 'files', folderId: e.id })
    openDeck(e.id)
    navigate({ name: 'deck', deckId: e.id })
  }, [])

  const select: MobileSelect = useMemo(() => ({
    active: selecting,
    ids: selected,
    toggle: (id) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n }),
  }), [selecting, selected])

  const ctx = useMemo(() => ({
    open,
    pickFolder: (ids: string[]) => setSheet({ kind: 'move', ids }),
    inTrash: route.name === 'trash',
  }), [open, route.name])

  const screen = {
    select,
    onOpen: open,
    onActions: (id: string) => setSheet({ kind: 'actions', ids: [id] }),
    reportIds: setListIds,
    header: {
      trailing: route.name === 'trash' || route.name === 'settings' ? null : selecting ? (
        <TextButton onClick={() => { setSelecting(false); setSelected(new Set()) }}>Done</TextButton>
      ) : (
        <>
          <TextButton onClick={() => setSelecting(true)}>Select</TextButton>
          <IconButton label={`New in ${destName}`} size="lg" tone="plain" tooltip={false} onClick={() => setSheet({ kind: 'create' })}><Plus size={22} /></IconButton>
          {route.name === 'files' && !route.folderId && <IconButton label="Settings" size="lg" tone="plain" tooltip={false} onClick={() => navigate({ name: 'settings', section: null })}><GearSix size={22} /></IconButton>}
        </>
      ),
      leading: selecting ? (
        <TextButton onClick={() => setSelected((prev) => (prev.size ? new Set() : new Set(listIds)))}>
          {selected.size ? 'Deselect all' : 'Select all'}
        </TextButton>
      ) : route.name !== 'home' && !(route.name === 'files' && route.folderId === null) ? (
        <BackButton onClick={back} />
      ) : null,
    },
  }

  if (route.name === 'deck') return <><MobileViewer deckId={route.deckId} slide={route.slide} /><Toaster /></>

  const ids = [...selected]
  const batch = selecting ? (
    <div className={s.batch}>
      <span className={s.batchCount}>{ids.length ? `${ids.length} selected` : 'Select items'}</span>
      <button type="button" className={s.batchBtn} disabled={!ids.length} onClick={() => download(ids.filter((i) => getLibrary().entries[i]?.type === 'deck'), 'pptx')} aria-label="Download"><DownloadSimple size={22} /></button>
      <button type="button" className={s.batchBtn} disabled={!ids.length} onClick={() => setSheet({ kind: 'move', ids })} aria-label="Move"><FolderSimple size={22} /></button>
      <button type="button" className={`${s.batchBtn} ${s.danger}`} disabled={!ids.length} onClick={() => { trash(ids); setSelected(new Set()); setSelecting(false) }} aria-label="Delete"><Trash size={22} /></button>
    </div>
  ) : undefined

  return (
    <div className={s.app}>
      <main className={s.main}>
        {route.name === 'home' && <RecentsScreen {...screen} />}
        {route.name === 'files' && <FilesScreen {...screen} folderId={route.folderId} />}
        {route.name === 'starred' && <StarredScreen {...screen} />}
        {route.name === 'trash' && <TrashScreen {...screen} />}
        {route.name === 'settings' && <SettingsScreen section={route.section} />}
      </main>
      <TabBar
        tab={route.name === 'home' ? 'recents' : 'files'}
        hidden={route.name === 'settings'}
        onTab={(t) => navigate(t === 'recents' ? { name: 'home' } : { name: 'files', folderId: null })}
        onSearch={() => setSheet({ kind: 'search' })}
        batch={batch}
      />
      <Toaster />
      <AnimatePresence><SyncFlowHost /></AnimatePresence>
      <AnimatePresence>
        {sheet?.kind === 'actions' && <ActionSheet key="a" ids={sheet.ids} ctx={ctx} onClose={() => setSheet(null)} />}
        {sheet?.kind === 'move' && <FolderSheet key="m" ids={sheet.ids} onClose={() => { setSheet(null); setSelecting(false); setSelected(new Set()) }} />}
        {sheet?.kind === 'search' && <SearchSheet key="s" onClose={() => setSheet(null)} />}
        {sheet?.kind === 'create' && (
          <Sheet key="c" label="Create" onClose={() => setSheet(null)} header={<SheetTitle>Add to {destName}</SheetTitle>}>
            <SheetActions
              onDone={() => setSheet(null)}
              groups={[[
                { label: 'New deck', icon: <Plus size={20} />, run: () => { const id = newDeck(destination); toast({ message: `New deck in ${destName}` }); open(getLibrary().entries[id]) } },
                { label: 'Import from Files', icon: <UploadSimple size={20} />, run: () => pickPptx(destination) },
                { label: 'New folder', icon: <FolderSimplePlus size={20} />, run: () => navigate({ name: 'files', folderId: newFolder(destination) }) },
              ]]}
            />
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  )
}
