// Desktop library views. Each is PageHeader + Collection; none has bespoke layout or styling.
import { ClockCounterClockwise, FolderSimplePlus, NotePencil, SidebarSimple, Star, Trash, UploadSimple, Plus, CaretRight } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useMemo, useState } from 'react'
import { ProjectConversation } from '../compositions/ProjectChat'
import { ProjectSide } from '../compositions/ProjectSide'
import { currentChat, newChat, thread, useRuns } from '../data/projectRuns'
import { Overlay } from '../ui/Overlay'
import { renameOnArrival, takeRenameOnArrival } from '../lib/arrival'
import { Collection } from '../compositions/Collection'
import { EmptyState, PageHeader, SectionHeader } from '../compositions/PageHeader'
import { ViewTools } from '../compositions/ViewTools'
import { SyncNotice } from '../compositions/SyncNotice'
import { PromptStart } from '../compositions/PromptStart'
import { childrenOf, emptyTrash, isLive, isTrashRoot, newDeck, newProject, projectChats, projects, recents, rename, trashDaysLeft, useLibrary, decks } from '../data/library'
import type { Entry } from '../data/types'
import { count, relTimeInline } from '../lib/format'
import { usePrefs, sortEntries } from '../lib/prefs'
import { navigate } from '../lib/router'
import { Button, IconButton } from '../ui/Button'
import { useActions } from './actions'
import s from './views.module.css'

function useCollectionProps() {
  const a = useActions()
  return { onOpen: a.open, onPreview: (id: string) => a.preview(id), onOpenFolder: a.openFolder }
}

export function RecentsView() {
  const lib = useLibrary()
  const cp = useCollectionProps()
  const a = useActions()
  const [prefs, setPrefs] = usePrefs('recents', { sort: 'opened', view: 'grid' })
  const all = recents(lib, 12)
  const total = decks(lib).filter(isLive).length
  const showJump = total >= 8
  const jump = showJump ? all.slice(0, 4) : []
  const rest = sortEntries(showJump ? all.slice(4) : all, prefs.sort)
  const opened = (e: Entry) => (e.type === 'deck' ? `Opened ${relTimeInline(e.openedAt ?? e.modifiedAt)} · ${count(e.slides.length, 'slide')}` : undefined)

  if (!total) {
    return (
      <>
        <PageHeader title="Home" />
        <PromptStart />
        <EmptyState icon={<ClockCounterClockwise size={24} />} title="Your decks will show up here" body="Import a PowerPoint file or start a new deck. Everything stays in this browser, on this device.">
          <Button variant="secondary" icon={<UploadSimple size={16} />} onClick={a.pickFiles}>Import .pptx</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => a.open(lib.entries[newDeck(null)])}>New deck</Button>
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Home" />
      <SyncNotice />
      <PromptStart />
      {showJump && (
        <section className={s.section} aria-label="Jump back in">
          <SectionHeader title="Jump back in" />
          <Collection {...cp} entries={jump} view="grid" size="lg" label="Jump back in" meta={opened} layoutPrefix="ql-" />
        </section>
      )}
      <section className={s.section} aria-label="Earlier">
        <SectionHeader title={showJump ? 'Earlier' : 'Recents'}>
          <ViewTools prefs={prefs} onChange={setPrefs} />
        </SectionHeader>
        <Collection {...cp} entries={rest} view={prefs.view} label="Recent decks" meta={opened} layoutPrefix="ql-" />
      </section>
    </>
  )
}

/** Projects (spec: projects): every project, then the decks that aren't in one. */
export function ProjectsView() {
  const lib = useLibrary()
  const cp = useCollectionProps()
  const a = useActions()
  const [prefs, setPrefs] = usePrefs('files', { sort: 'modified', view: 'grid' })
  const list = useMemo(() => sortEntries(projects(lib), prefs.sort), [lib, prefs.sort])
  const loose = useMemo(() => sortEntries(childrenOf(lib, null).filter((e) => e.type === 'deck'), prefs.sort), [lib, prefs.sort])
  return (
    <>
      <PageHeader
        title="Projects"
        count={[count(list.length, 'project'), loose.length ? `${count(loose.length, 'deck')} outside` : ''].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button variant="ghost" icon={<FolderSimplePlus size={16} />} onClick={() => { const id = newProject(); renameOnArrival(id); a.openFolder(id) }}>New project</Button>
            <ViewTools prefs={prefs} onChange={setPrefs} sorts={['modified', 'name']} />
          </>
        }
      />
      <section className={s.section} aria-label="Projects">
        <Collection
          {...cp}
          entries={list}
          view={prefs.view}
          label="Projects"
          layoutPrefix="ql-"
          empty={
            <EmptyState icon={<FolderSimplePlus size={24} />} title="No projects yet" body="A project keeps related decks together, with a chat that knows all of them.">
              <Button variant="primary" icon={<FolderSimplePlus size={16} />} onClick={() => { const id = newProject(); renameOnArrival(id); a.openFolder(id) }}>New project</Button>
            </EmptyState>
          }
        />
      </section>
      {!!loose.length && (
        <section className={s.section} aria-label="Not in a project">
          <SectionHeader title="Not in a project" />
          <Collection {...cp} entries={loose} view={prefs.view} label="Not in a project" layoutPrefix="ql-" />
        </section>
      )}
    </>
  )
}


/** One project (spec: projects v2): its conversation, with its chats and files beside it. */
export function ProjectView({ projectId }: { projectId: string }) {
  useRuns()
  const lib = useLibrary()
  const a = useActions()
  const project = lib.entries[projectId]
  const chatId = currentChat(projectId)
  const started = thread(chatId).turns.length > 0
  const chatTitle = projectChats(lib, projectId).find((c) => c.id === chatId)?.title
  const [sheet, setSheet] = useState(false)
  if (!project || project.type !== 'folder' || project.trashedAt !== null) {
    return <EmptyState icon={<FolderSimplePlus size={24} />} title="This project isn’t here any more" body="It may have been moved to Trash or deleted."><Button variant="secondary" onClick={() => navigate({ name: 'files', folderId: null })}>Go to Projects</Button></EmptyState>
  }
  const n = childrenOf(lib, projectId).filter((e) => e.type === 'deck').length
  return (
    <div className={s.project}>
      <div className={s.projectMain}>
        <header className={s.projectHead}>
          <button type="button" className={s.crumb} onClick={() => navigate({ name: 'files', folderId: null })}>Projects</button>
          <CaretRight size={10} className={s.crumbSep} />
          {started ? <h1 className={s.projectName}><ProjectTitle id={projectId} name={project.name} /></h1> : <span className={s.crumbHere}>{project.name}</span>}
          {started && chatTitle && <><CaretRight size={10} className={s.crumbSep} /><span className={s.chatTitle} title={chatTitle}>{chatTitle}</span></>}
          <span className={s.headSpacer} />
          {started && <IconButton label="New chat" size="sm" tone="plain" className={s.headNewChat} onClick={() => newChat(projectId)}><NotePencil size={16} /></IconButton>}
          <Button variant="ghost" size="sm" className={s.filesButton} icon={<SidebarSimple size={15} />} onClick={() => setSheet(true)}>Chats and files{n ? ` · ${n}` : ''}</Button>
        </header>
        <ProjectConversation key={chatId} projectId={projectId} chatId={chatId} title={<h1 className={s.heroName}><ProjectTitle id={projectId} name={project.name} /></h1>} />
      </div>
      <aside className={s.projectSide} aria-label="Chats and files"><ProjectSide projectId={projectId} onPreview={(id) => a.preview(id)} /></aside>
      <AnimatePresence>
        {sheet && (
          <Overlay key="files" label="Chats and files" align="end" onClose={() => setSheet(false)}>
            <motion.div className={s.sideSheet} initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.2 }}>
              <ProjectSide projectId={projectId} onPreview={(id) => a.preview(id)} onDone={() => setSheet(false)} />
            </motion.div>
          </Overlay>
        )}
      </AnimatePresence>
    </div>
  )
}

/** The project's name as its page title: click to rename (Enter or leaving keeps it, Esc puts it back). */
function ProjectTitle({ id, name }: { id: string; name: string }) {
  const [editing, setEditing] = useState(() => takeRenameOnArrival(id))
  if (!editing) return <button type="button" className={s.titleButton} title="Rename" onClick={() => setEditing(true)}>{name}</button>
  const done = (v: string | null) => { setEditing(false); if (v !== null && v.trim() && v.trim() !== name) rename(id, v.trim()) }
  return (
    <input
      className={s.titleInput}
      defaultValue={name}
      autoFocus
      aria-label="Project name"
      size={Math.max(8, name.length + 2)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') done(e.currentTarget.value); if (e.key === 'Escape') done(null) }}
      onBlur={(e) => done(e.currentTarget.value)}
    />
  )
}

export function StarredView() {
  const lib = useLibrary()
  const cp = useCollectionProps()
  const [prefs, setPrefs] = usePrefs('starred', { sort: 'modified', view: 'grid' })
  const entries = sortEntries(Object.values(lib.entries).filter((e) => e.starred && isLive(e)), prefs.sort)
  return (
    <>
      <PageHeader title="Starred" count={count(entries.length, 'item')} actions={<ViewTools prefs={prefs} onChange={setPrefs} />} />
      <Collection
        {...cp}
        entries={entries}
        view={prefs.view}
        label="Starred"
        layoutPrefix="ql-"
        empty={<EmptyState icon={<Star size={24} />} title="Nothing starred yet" body="Star the decks you come back to. Right-click a deck and choose Star, or select it and press S." />}
      />
    </>
  )
}

export function TrashView() {
  const lib = useLibrary()
  const cp = useCollectionProps()
  const entries = Object.values(lib.entries).filter(isTrashRoot).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
  return (
    <>
      <PageHeader
        title="Trash"
        count={count(entries.length, 'item')}
        actions={entries.length ? <Button variant="ghost" onClick={emptyTrash}>Empty Trash</Button> : undefined}
      />
      {!!entries.length && <p className={s.note}>Items are deleted permanently after 30 days.</p>}
      <Collection
        {...cp}
        entries={entries}
        view="list"
        inTrash
        label="Trash"
        meta={(e) => `${trashDaysLeft(e)} days left`}
        empty={<EmptyState icon={<Trash size={24} />} title="Trash is empty" body="Deleted decks stay here for 30 days before they’re removed for good." />}
      />
    </>
  )
}
