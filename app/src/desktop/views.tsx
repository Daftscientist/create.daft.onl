// Desktop library views. Each is PageHeader + Collection; none has bespoke layout or styling.
import { ClockCounterClockwise, FolderSimplePlus, Star, Trash, UploadSimple, Plus, CaretRight } from '@phosphor-icons/react'
import { Fragment, useMemo } from 'react'
import { Collection } from '../compositions/Collection'
import { EmptyState, PageHeader, SectionHeader } from '../compositions/PageHeader'
import { ViewTools } from '../compositions/ViewTools'
import { childrenOf, emptyTrash, isLive, isTrashRoot, newDeck, newFolder, pathTo, recents, trashDaysLeft, useLibrary, decks } from '../data/library'
import type { Entry } from '../data/types'
import { count, relTimeInline } from '../lib/format'
import { usePrefs, sortEntries } from '../lib/prefs'
import { navigate } from '../lib/router'
import { Button } from '../ui/Button'
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
        <PageHeader title="Recents" />
        <EmptyState icon={<ClockCounterClockwise size={24} />} title="Your decks will show up here" body="Import a PowerPoint file or start a new deck. Everything stays in this browser, on this device.">
          <Button variant="secondary" icon={<UploadSimple size={16} />} onClick={a.pickFiles}>Import .pptx</Button>
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => a.open(lib.entries[newDeck(null)])}>New deck</Button>
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHeader title="Recents" count={count(all.length, 'deck')} />
      {showJump && (
        <section className={s.section} aria-label="Jump back in">
          <SectionHeader title="Jump back in" />
          <Collection {...cp} entries={jump} view="grid" size="lg" label="Jump back in" meta={opened} layoutPrefix="ql-" />
        </section>
      )}
      <section className={s.section} aria-label="Earlier">
        <SectionHeader title={showJump ? 'Earlier' : 'Recently opened'}>
          <ViewTools prefs={prefs} onChange={setPrefs} />
        </SectionHeader>
        <Collection {...cp} entries={rest} view={prefs.view} label="Recent decks" meta={opened} layoutPrefix="ql-" />
      </section>
    </>
  )
}

export function FilesView({ folderId }: { folderId: string | null }) {
  const lib = useLibrary()
  const cp = useCollectionProps()
  const a = useActions()
  const [prefs, setPrefs] = usePrefs('files', { sort: 'modified', view: 'grid' })
  const folder = folderId ? lib.entries[folderId] : null
  const entries = useMemo(() => sortEntries(childrenOf(lib, folderId), prefs.sort), [lib, folderId, prefs.sort])
  const path = pathTo(lib, folderId)
  if (folderId && (!folder || folder.trashedAt !== null)) {
    return <EmptyState icon={<FolderSimplePlus size={24} />} title="This folder isn’t here any more" body="It may have been moved to Trash or deleted."><Button variant="secondary" onClick={() => navigate({ name: 'files', folderId: null })}>Go to Files</Button></EmptyState>
  }
  const decksHere = entries.filter((e) => e.type === 'deck').length
  const foldersHere = entries.length - decksHere
  return (
    <>
      <PageHeader
        title={folder ? folder.name : 'Files'}
        count={[foldersHere ? count(foldersHere, 'folder') : '', count(decksHere, 'deck')].filter(Boolean).join(' · ')}
        crumbs={folderId ? (
          <>
            <button type="button" className={s.crumb} onClick={() => navigate({ name: 'files', folderId: null })}>Files</button>
            {path.slice(0, -1).map((f) => (
              <Fragment key={f.id}>
                <CaretRight size={10} className={s.crumbSep} />
                <button type="button" className={s.crumb} onClick={() => navigate({ name: 'files', folderId: f.id })}>{f.name}</button>
              </Fragment>
            ))}
            <CaretRight size={10} className={s.crumbSep} />
          </>
        ) : undefined}
        actions={
          <>
            <Button variant="ghost" icon={<FolderSimplePlus size={16} />} onClick={() => a.openFolder(newFolder(folderId))}>New folder</Button>
            <ViewTools prefs={prefs} onChange={setPrefs} sorts={['modified', 'name']} />
          </>
        }
      />
      <Collection
        {...cp}
        entries={entries}
        view={prefs.view}
        label={folder ? folder.name : 'Files'}
        layoutPrefix="ql-"
        empty={
          <EmptyState icon={<FolderSimplePlus size={24} />} title={folder ? `${folder.name} is empty` : 'No files yet'} body="Drop .pptx files here, or move decks in from anywhere in your library.">
            <Button variant="secondary" icon={<UploadSimple size={16} />} onClick={a.pickFiles}>Import .pptx</Button>
          </EmptyState>
        }
      />
    </>
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
