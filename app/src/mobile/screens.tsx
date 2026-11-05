// Mobile screens: LargeTitle + MobileList (+ ContinueCard on Recents). No bespoke layout.
import { CaretRight, ClockCounterClockwise, FolderSimplePlus, Star, Trash, UploadSimple } from '@phosphor-icons/react'
import { useEffect, useMemo, type ReactNode } from 'react'
import { ContinueCard } from '../compositions/ContinueCard'
import { pickPptx } from '../compositions/importPicker'
import { MobileList, MobileSection, type MobileSelect } from '../compositions/MobileList'
import { EmptyState } from '../compositions/PageHeader'
import { backUp, childrenOf, emptyTrash, isLive, recents, trashDaysLeft, useLibrary } from '../data/library'
import type { Deck, Entry } from '../data/types'
import { count, relTimeInline } from '../lib/format'
import { sortEntries } from '../lib/prefs'
import { navigate } from '../lib/router'
import { Button, TextButton } from '../ui/Button'
import { LargeTitle } from '../ui/LargeTitle'
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
    <LargeTitle title="Recents" leading={p.header.leading} trailing={p.header.trailing}>
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

export function FilesScreen(p: ScreenProps & { folderId: string | null }) {
  const lib = useLibrary()
  const folder = p.folderId ? lib.entries[p.folderId] : null
  const entries = useMemo(() => sortEntries(childrenOf(lib, p.folderId), 'name'), [lib, p.folderId])
  useReport(entries, p.reportIds)
  const starred = Object.values(lib.entries).filter((e) => e.starred && isLive(e)).length
  const trashed = Object.values(lib.entries).filter((e) => e.trashedAt !== null).length
  return (
    <LargeTitle title={folder ? folder.name : 'Files'} leading={p.header.leading} trailing={p.header.trailing}>
      {!p.folderId && !p.select.active && (
        <div className={s.places}>
          <PlaceRow icon={<Star size={20} />} label="Starred" count={starred} onClick={() => navigate({ name: 'starred' })} />
          <PlaceRow icon={<Trash size={20} />} label="Trash" count={trashed} onClick={() => navigate({ name: 'trash' })} />
        </div>
      )}
      {entries.length ? (
        <MobileList entries={entries} select={p.select} onOpen={p.onOpen} onActions={p.onActions} />
      ) : (
        <EmptyState icon={<FolderSimplePlus size={24} />} title={folder ? `${folder.name} is empty` : 'No files yet'} body="Tap + to import a deck or make a new one here." />
      )}
      {!p.folderId && !p.select.active && <StorageCard />}
    </LargeTitle>
  )
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
  const entries = Object.values(lib.entries).filter((e) => e.trashedAt !== null).sort((a, b) => (b.trashedAt ?? 0) - (a.trashedAt ?? 0))
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

function PlaceRow({ icon, label, count: n, onClick }: { icon: ReactNode; label: string; count: number; onClick: () => void }) {
  return (
    <button type="button" className={s.place} onClick={onClick}>
      <span className={s.placeIcon}>{icon}</span>
      <span className={s.placeLabel}>{label}</span>
      {n > 0 && <span className={s.placeCount}>{n}</span>}
      <CaretRight size={14} className={s.chev} />
    </button>
  )
}

function StorageCard() {
  const lib = useLibrary()
  return (
    <div className={s.storage}>
      <div>
        <p className={s.storageTitle}>Stored in this browser</p>
        <p className={s.storageMeta}>{lib.lastBackupAt ? `Backed up ${relTimeInline(lib.lastBackupAt)}` : 'Not backed up yet'}</p>
      </div>
      <Button variant="secondary" onClick={backUp}>Back up</Button>
    </div>
  )
}
