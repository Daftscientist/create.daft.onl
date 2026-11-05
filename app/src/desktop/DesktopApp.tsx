// Desktop composition (DESIGN.md §2): frame + sidebar + inset panel. Composes only.
import { Plus, UploadSimple } from '@phosphor-icons/react'
import { AnimatePresence, LayoutGroup } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CommandPalette } from '../compositions/CommandPalette'
import { DropVeil } from '../compositions/DropVeil'
import { QuickLook } from '../compositions/QuickLook'
import { pickPptx } from '../compositions/importPicker'
import { getLibrary, newDeck, openDeck } from '../data/library'
import { toast } from '../data/toasts'
import type { Entry } from '../data/types'
import { navigate, useRoute } from '../lib/router'
import { Button } from '../ui/Button'
import { SearchTrigger } from '../ui/SearchTrigger'
import { Toaster } from '../ui/Toaster'
import { Tooltip } from '../ui/Tooltip'
import { ActionsContext, type DesktopActions } from './actions'
import { DeckPage } from './DeckPage'
import { Sidebar } from './Sidebar'
import { FilesView, RecentsView, StarredView, TrashView } from './views'
import s from './DesktopApp.module.css'

export function DesktopApp() {
  const route = useRoute()
  const [palette, setPalette] = useState(false)
  const [ql, setQl] = useState<{ deckId: string; slide: number } | null>(null)
  const panel = useRef<HTMLElement>(null)

  // Where New/Import land: the open folder in Files, otherwise the Files root (VISION v3).
  const destination = route.name === 'files' ? route.folderId : null
  const destName = destination ? getLibrary().entries[destination]?.name ?? 'Files' : 'Files'
  const destinationRef = useRef(destination)
  destinationRef.current = destination

  const actions = useMemo<DesktopActions>(() => ({
    open: (e: Entry) => {
      if (e.type === 'folder') return navigate({ name: 'files', folderId: e.id })
      openDeck(e.id)
      navigate({ name: 'deck', deckId: e.id })
    },
    preview: (deckId, slide) => setQl({ deckId, slide: slide ?? 0 }),
    openFolder: (folderId) => navigate({ name: 'files', folderId }),
    openPalette: () => setPalette(true),
    pickFiles: () => pickPptx(destinationRef.current),
  }), [])

  const create = useCallback(() => {
    const id = newDeck(destination)
    toast({ message: `New deck in ${destName}` })
    actions.open(getLibrary().entries[id])
  }, [destination, destName, actions])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p) }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  // Scroll to top on navigation, keep scroll on in-place updates.
  const routeKey = JSON.stringify(route)
  useEffect(() => { panel.current?.scrollTo({ top: 0 }) }, [routeKey])

  if (route.name === 'deck') {
    return (
      <ActionsContext.Provider value={actions}>
        <DeckPage deckId={route.deckId} slide={route.slide} />
      </ActionsContext.Provider>
    )
  }

  return (
    <ActionsContext.Provider value={actions}>
      <LayoutGroup>
        <div className={s.frame}>
          <Sidebar route={route} />
          <main ref={panel} className={s.panel} aria-label="Content">
            <div className={s.topbar}>
              <SearchTrigger onOpen={() => setPalette(true)} />
              <div className={s.primary}>
                <Tooltip label={`Import into ${destName}`}>
                  <Button variant="secondary" icon={<UploadSimple size={16} />} onClick={actions.pickFiles}>Import</Button>
                </Tooltip>
                <Tooltip label={`New deck in ${destName}`}>
                  <Button variant="primary" icon={<Plus size={16} weight="bold" />} onClick={create}>New deck</Button>
                </Tooltip>
              </div>
            </div>
            <div className={s.content}>
              {route.name === 'home' && <RecentsView />}
              {route.name === 'files' && <FilesView folderId={route.folderId} />}
              {route.name === 'starred' && <StarredView />}
              {route.name === 'trash' && <TrashView />}
            </div>
            <DropVeil destination={destination} destinationName={destName} />
          </main>
          <Toaster />
        </div>
        <AnimatePresence>
          {ql && <QuickLook key="ql" deckId={ql.deckId} slide={ql.slide} onSlide={(n) => setQl({ ...ql, slide: n })} onClose={() => setQl(null)} />}
        </AnimatePresence>
      </LayoutGroup>
      <AnimatePresence>{palette && <CommandPalette key="cp" onClose={() => setPalette(false)} />}</AnimatePresence>
    </ActionsContext.Provider>
  )
}
