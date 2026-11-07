// Beside a project's conversation (spec: projects v2): its chats and its files. Desktop shows this as a column (or a
// sheet when narrow); phones show it in a bottom sheet. Files are a real list: arrows move, Enter opens, Space
// previews, ⋯ / right-click has the usual deck menu. Order holds still while Ream is working in the project.
import { ChatCircle, DotsThree, FolderSimple, FolderSimpleDashed, NotePencil } from '@phosphor-icons/react'
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { childrenOf, move, openDeck, projectChats, projects, rename, useLibrary, getLibrary } from '../data/library'
import { currentChat, isRunning, newChat, openChatIn, projectBusy, useRuns } from '../data/projectRuns'
import type { Deck } from '../data/types'
import { relTimeInline } from '../lib/format'
import { navigate } from '../lib/router'
import { IconButton } from '../ui/Button'
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu'
import { commandsFor } from './commands'
import { DeckThumb } from './DeckThumb'
import s from './ProjectSide.module.css'

export function ProjectSide({ projectId, onPreview, onDone, touch }: { projectId: string; onPreview?: (deckId: string) => void; onDone?: () => void; touch?: boolean }) {
  useRuns()
  const lib = useLibrary()
  const chats = projectChats(lib, projectId)
  const open = currentChat(projectId)
  const busy = projectBusy(projectId)
  const decks = childrenOf(lib, projectId).filter((e): e is Deck => e.type === 'deck')
  // While Ream works here the list keeps its order (new decks go on top), so rows don't jump under the pointer.
  const sorted = [...decks].sort((a, b) => b.modifiedAt - a.modifiedAt).map((d) => d.id)
  const [frozen, setFrozen] = useState<{ busy: boolean; order: string[] }>({ busy, order: sorted })
  if (frozen.busy !== busy) setFrozen({ busy, order: sorted }) // adjusting state while rendering, as React documents
  const order = busy ? [...sorted.filter((id) => !frozen.order.includes(id)), ...frozen.order.filter((id) => sorted.includes(id))] : sorted
  const rows = order.map((id) => lib.entries[id] as Deck)
  const [showAll, setShowAll] = useState(false)
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; items: MenuItem[]; label: string } | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const list = useRef<HTMLDivElement>(null)

  const openDeckRow = (d: Deck) => { if (d.status !== 'ready') return; openDeck(d.id); navigate({ name: 'deck', deckId: d.id }); onDone?.() }
  const pickProject = (ids: string[], at: MenuAnchor) => setMenu({
    label: 'Move to project', anchor: at,
    items: [
      ...projects(getLibrary()).filter((f) => f.id !== projectId).map((f) => ({ label: f.name, icon: <FolderSimple size={16} />, run: () => move(ids, f.id) })),
      { label: 'Not in a project', icon: <FolderSimpleDashed size={16} />, run: () => move(ids, null) },
    ],
  })
  const menuFor = (d: Deck, at: MenuAnchor) => setMenu({
    label: 'Actions', anchor: at,
    items: commandsFor([d.id], { open: (e) => openDeckRow(e as Deck), preview: onPreview, startRename: setRenaming, pickFolder: (ids) => pickProject(ids, at), inTrash: false, touch }),
  })
  const onKey = (e: ReactKeyboardEvent, d: Deck, i: number) => {
    const go = (j: number) => { e.preventDefault(); list.current?.querySelectorAll<HTMLElement>('[data-row]')[j]?.focus() }
    if (e.key === 'ArrowDown') go(Math.min(rows.length - 1, i + 1))
    else if (e.key === 'ArrowUp') go(Math.max(0, i - 1))
    else if (e.key === ' ' && onPreview) { e.preventDefault(); onPreview(d.id) }
    else if (e.key === 'F2') { e.preventDefault(); setRenaming(d.id) }
  }
  const shownChats = showAll ? chats : chats.slice(0, 5)

  return (
    <div className={s.side} data-touch={touch || undefined}>
      <section className={s.group} aria-label="Chats">
        <header className={s.head}>
          <h2>Chats</h2>
          <IconButton label="New chat" size="sm" tone="plain" side="top" onClick={() => { newChat(projectId); onDone?.() }}><NotePencil size={15} /></IconButton>
        </header>
        {chats.length ? (
          <div className={s.chats}>
            {shownChats.map((c) => (
              <button key={c.id} type="button" className={s.chat} aria-current={c.id === open ? 'true' : undefined} onClick={() => { openChatIn(projectId, c.id); onDone?.() }}>
                <ChatCircle size={15} weight={c.id === open ? 'fill' : 'regular'} />
                <span className={s.chatName}>{c.title}</span>
                {isRunning(c.id) ? <span className={s.running} aria-label="Working" /> : <span className={s.when}>{relTimeInline(c.at)}</span>}
              </button>
            ))}
            {chats.length > 5 && <button type="button" className={s.more} onClick={() => setShowAll(!showAll)}>{showAll ? 'Fewer' : `All ${chats.length} chats`}</button>}
          </div>
        ) : <p className={s.none}>Your chats about this project will be listed here.</p>}
      </section>

      <section className={s.group} aria-label="Files">
        <header className={s.head}><h2>Files <span>{decks.length || ''}</span></h2></header>
        {rows.length ? (
          <div className={s.files} ref={list} role="list">
            {rows.map((d, i) => (
              <div key={d.id} role="listitem" className={s.fileItem}>
                {renaming === d.id ? (
                  <div className={s.file}>
                    <span className={s.thumb}><DeckThumb deck={d} /></span>
                    <input
                      className={s.rename} defaultValue={d.name} autoFocus aria-label="Name"
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = d.name; e.currentTarget.blur() } }}
                      onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== d.name) rename(d.id, v); setRenaming(null) }}
                    />
                  </div>
                ) : (
                <button
                  type="button" data-row className={s.file}
                  onClick={() => openDeckRow(d)}
                  onKeyDown={(e) => onKey(e, d, i)}
                  onContextMenu={(e) => { e.preventDefault(); menuFor(d, { x: e.clientX, y: e.clientY }) }}
                >
                  <span className={s.thumb}><DeckThumb deck={d} /></span>
                  <span className={s.fileText}>
                    <b title={d.name}>{d.name}</b>
                    <small>{d.status === 'importing' ? 'Importing…' : d.status === 'failed' ? (d.error ?? 'Import failed') : d.remote ? `${relTimeInline(d.modifiedAt)} · in the cloud` : `${relTimeInline(d.modifiedAt)} · ${d.slides.length} ${d.slides.length === 1 ? 'slide' : 'slides'}`}</small>
                  </span>
                </button>
                )}
                <button type="button" className={s.dots} aria-label={`Actions for ${d.name}`} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); menuFor(d, { x: r.right, y: r.bottom + 4, align: 'end' }) }}><DotsThree size={18} weight="bold" /></button>
              </div>
            ))}
          </div>
        ) : <p className={s.none}>No decks yet. Drop .pptx files here, use Import, or ask Ream to make one.</p>}
      </section>
      <Menu open={!!menu} anchor={menu?.anchor ?? null} items={menu?.items ?? []} label={menu?.label ?? ''} onClose={() => setMenu(null)} />
    </div>
  )
}
