// Mobile screens: LargeTitle + MobileList (+ ContinueCard on Recents). No bespoke layout.
import { CaretDown, ClockCounterClockwise, FolderSimple, FolderSimplePlus, NotePencil, PencilSimple, Star, Trash, UploadSimple } from '@phosphor-icons/react'
import { AnimatePresence } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ContinueCard } from '../compositions/ContinueCard'
import { SyncNotice } from '../compositions/SyncNotice'
import { pickPptx } from '../compositions/importPicker'
import { MobileList, MobileSection, type MobileSelect } from '../compositions/MobileList'
import { EmptyState } from '../compositions/PageHeader'
import { childrenOf, emptyTrash, isLive, isTrashRoot, projects, recents, rename, trashDaysLeft, useLibrary } from '../data/library'
import { ProjectConversation } from '../compositions/ProjectChat'
import { ProjectSide } from '../compositions/ProjectSide'
import { currentChat, newChat, useRuns } from '../data/projectRuns'
import { Menu, type MenuAnchor } from '../ui/Menu'
import { Sheet, SheetTitle } from '../ui/Sheet'
import type { Deck, Entry } from '../data/types'
import { count, relTimeInline } from '../lib/format'
import { sortEntries } from '../lib/prefs'
import { navigate } from '../lib/router'
import { BackButton, Button, TextButton } from '../ui/Button'
import { LargeTitle } from '../ui/LargeTitle'
import { ListGroup, ListRow } from '../ui/List'
import { SyncStatus } from '../compositions/SyncStatus'
import s from './screens.module.css'

type ScreenProps = {
  select: MobileSelect
  onOpen: (e: Entry) => void
  onActions: (id: string) => void
  reportIds: (ids: string[]) => void
  header: { leading: ReactNode; trailing: ReactNode }
}

function useReport(entries: Entry[], report: (ids: string[]) => void) {
  const key = entries.map((e) => e.id).join(',')
  useEffect(() => { report(key ? key.split(',') : []) }, [key, report])
}

export function RecentsScreen(p: ScreenProps) {
  const lib = useLibrary()
  const all = recents(lib, 12)
  const [first, ...rest] = all
  const list = p.select.active ? all : rest
  useReport(list, p.reportIds)
  return (
    <LargeTitle title="Home" leading={p.header.leading} trailing={p.header.trailing}>
      <SyncNotice />
      {!all.length ? (
        <EmptyState icon={<ClockCounterClockwise size={24} />} title="Your decks will show up here" body="Import a PowerPoint file from your phone. Everything stays in this browser, on this device.">
          <Button variant="primary" size="lg" icon={<UploadSimple size={18} />} onClick={() => pickPptx(null)}>Import .pptx</Button>
        </EmptyState>
      ) : (
        <>
          {!p.select.active && first && (
            <ContinueCard
              deck={first as Deck}
              onOpen={() => p.onOpen(first)}
              onPresent={() => { p.onOpen(first); requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('office:present'))) }}
            />
          )}
          <MobileSection title="Recent">
            <MobileList entries={list} select={p.select} onOpen={p.onOpen} onActions={p.onActions} meta={(e) => (e.type === 'deck' && e.status === 'ready' ? `Opened ${relTimeInline(e.openedAt ?? e.modifiedAt)} · ${count(e.slides.length, 'slide')}` : undefined)} />
          </MobileSection>
        </>
      )}
    </LargeTitle>
  )
}

/** Projects (spec: projects): Starred and Trash, then every project, then decks that aren't in one. */
export function FilesScreen(p: ScreenProps) {
  const lib = useLibrary()
  const list = projects(lib)
  const loose = useMemo(() => sortEntries(childrenOf(lib, null).filter((e) => e.type === 'deck'), 'modified'), [lib])
  useReport(useMemo(() => [...list, ...loose], [list, loose]), p.reportIds)
  const starred = Object.values(lib.entries).filter((e) => e.starred && isLive(e)).length
  const trashed = Object.values(lib.entries).filter(isTrashRoot).length
  return (
    <LargeTitle title="Projects" leading={p.header.leading} trailing={p.header.trailing}>
      {!p.select.active && (
        <>
          <ListGroup>
            <ListRow icon={<Star size={20} />} label="Starred" value={starred || undefined} onClick={() => navigate({ name: 'starred' })} />
            <ListRow icon={<Trash size={20} />} label="Trash" value={trashed || undefined} onClick={() => navigate({ name: 'trash' })} />
          </ListGroup>
          <div className={s.storage}><SyncStatus /></div>
        </>
      )}
      {list.length ? (
        <MobileSection title="Projects"><MobileList entries={list} select={p.select} onOpen={p.onOpen} onActions={p.onActions} /></MobileSection>
      ) : (
        <EmptyState icon={<FolderSimplePlus size={24} />} title="No projects yet" body="A project keeps related decks together, with a chat that knows all of them. Tap + to make one." />
      )}
      {!!loose.length && <MobileSection title="Not in a project"><MobileList entries={loose} select={p.select} onOpen={p.onOpen} onActions={p.onActions} /></MobileSection>}
    </LargeTitle>
  )
}

/** One project on a phone (spec: projects v2): the conversation is the screen. Files and chats are a sheet away. */
export function ProjectScreen({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  useRuns()
  const lib = useLibrary()
  const project = lib.entries[projectId]
  const chatId = currentChat(projectId)
  const [side, setSide] = useState(false)
  const [menu, setMenu] = useState<MenuAnchor | null>(null)
  const [renaming, setRenaming] = useState(false)
  const box = useViewportBox()
  if (!project || project.type !== 'folder' || project.trashedAt !== null) {
    return (
      <LargeTitle title="Project" leading={<BackButton onClick={onBack} />}>
        <EmptyState icon={<FolderSimplePlus size={24} />} title="This project isn’t here any more" body="It may have been moved to Trash or deleted." />
      </LargeTitle>
    )
  }
  const n = childrenOf(lib, projectId).filter((e) => e.type === 'deck').length
  return (
    <div className={s.chatScreen} ref={box}>
      <div className={s.chatBar}>
        <span className={s.chatSide}><BackButton label="Projects" onClick={onBack} /></span>
        <button type="button" className={s.chatName} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left + r.width / 2 - 110, y: r.bottom + 6 }) }}>
          <span>{project.name}</span><CaretDown size={12} weight="bold" />
        </button>
        <span className={`${s.chatSide} ${s.chatEnd}`}><button type="button" className={s.filesPill} onClick={() => setSide(true)}>Files{n ? ` ${n}` : ''}</button></span>
      </div>
      <ProjectConversation key={chatId} projectId={projectId} chatId={chatId} layout="phone" title={<span className={s.heroName}>{project.name}</span>} />
      <Menu open={!!menu} anchor={menu} label="Project" onClose={() => setMenu(null)} items={[
        { label: 'Rename', icon: <PencilSimple size={18} />, run: () => setRenaming(true) },
        { label: 'New chat', icon: <NotePencil size={18} />, run: () => newChat(projectId) },
        { label: 'Chats and files', icon: <FolderSimple size={18} />, run: () => setSide(true) },
      ]} />
      <AnimatePresence>
        {side && (
          <Sheet key="side" label="Chats and files" onClose={() => setSide(false)} header={<SheetTitle>{project.name}</SheetTitle>}>
            <div className={s.sheetBody}>
              <ProjectSide projectId={projectId} touch onDone={() => setSide(false)} />
              <Button variant="secondary" size="lg" icon={<UploadSimple size={18} />} onClick={() => { setSide(false); pickPptx(projectId) }}>Import a .pptx here</Button>
            </div>
          </Sheet>
        )}
        {renaming && (
          <Sheet key="rename" label="Rename project" onClose={() => setRenaming(false)} header={<SheetTitle>Rename project</SheetTitle>}>
            <form className={s.renameForm} onSubmit={(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('name')?.toString().trim(); if (v) rename(projectId, v); setRenaming(false) }}>
              <input name="name" defaultValue={project.name} autoFocus aria-label="Project name" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="primary" size="lg" type="submit">Save</Button>
            </form>
          </Sheet>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Keeps a full-screen view inside what's actually visible, so the composer rides on top of the keyboard (iOS ignores
 *  the viewport's resize hints; visualViewport tells the truth everywhere). */
function useViewportBox() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const fit = () => { const el = ref.current; if (!el) return; el.style.height = `${vv.height}px`; el.style.transform = `translateY(${vv.offsetTop}px)` }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit) }
  }, [])
  return ref
}

export function StarredScreen(p: ScreenProps) {
  const lib = useLibrary()
  const entries = sortEntries(Object.values(lib.entries).filter((e) => e.starred && isLive(e)), 'modified')
  useReport(entries, p.reportIds)
  return (
    <LargeTitle title="Starred" leading={p.header.leading} trailing={p.header.trailing}>
      {entries.length
        ? <MobileList entries={entries} select={p.select} onOpen={p.onOpen} onActions={p.onActions} />
        : <EmptyState icon={<Star size={24} />} title="Nothing starred yet" body="Open a deck’s ⋯ menu and choose Star to keep it here." />}
    </LargeTitle>
  )
}

export function TrashScreen(p: ScreenProps) {
  const lib = useLibrary()
  const entries = Object.values(lib.entries).filter(isTrashRoot).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  useReport(entries, p.reportIds)
  return (
    <LargeTitle
      title="Trash"
      leading={p.header.leading}
      trailing={entries.length ? <TextButton onClick={emptyTrash}>Empty</TextButton> : null}
    >
      {entries.length ? (
        <>
          <p className={s.note}>Items are deleted permanently after 30 days.</p>
          <MobileList entries={entries} select={p.select} swipe={false} onOpen={(e) => p.onActions(e.id)} onActions={p.onActions} meta={(e) => `${trashDaysLeft(e)} days left`} />
        </>
      ) : <EmptyState icon={<Trash size={24} />} title="Trash is empty" body="Deleted decks stay here for 30 days." />}
    </LargeTitle>
  )
}

