// Navigation-level actions shared by every desktop view.
import { createContext, useContext } from 'react'
import type { Entry } from '../data/types'

export type DesktopActions = {
  open: (e: Entry) => void
  preview: (deckId: string, slide?: number) => void
  openFolder: (folderId: string) => void
  openPalette: () => void
  pickFiles: () => void
}

export const ActionsContext = createContext<DesktopActions | null>(null)
export const useActions = () => {
  const a = useContext(ActionsContext)
  if (!a) throw new Error('useActions outside DesktopApp')
  return a
}
