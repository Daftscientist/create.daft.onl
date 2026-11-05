// UI-phase data model. The real engine (domOXML on Pyodide + OPFS/SQLite) replaces the store's
// implementation later; these shapes are what the UI depends on.

/** One slide as normalized HTML (domOXML's output shape): what the viewer renders, the AI reads and
 *  edits, and the engine converts to and from PPTX. `id` is stable across edits and reorders. */
export type SlideDoc = { id: string; html: string }

export type ImportPhase = 'queued' | 'reading' | 'converting' | 'saving'

export type Deck = {
  type: 'deck'
  id: string
  name: string
  parentId: string | null
  createdAt: number
  modifiedAt: number
  openedAt: number | null
  starred: boolean
  trashedAt: number | null
  /** The entry whose trashing took this one with it (itself for a directly trashed entry). */
  trashedRoot?: string
  /** Sync: when this entry last changed (hybrid clock) and on which device. */
  clock?: number
  device?: string
  /** Sync: when the deck's slides or theme last changed. */
  docClock?: number
  sizeBytes: number
  slides: SlideDoc[]
  lastSlide: number
  status: 'ready' | 'importing' | 'failed'
  phase?: ImportPhase
  progress?: number
  error?: string
  simplified?: number
}

export type Folder = {
  type: 'folder'
  id: string
  name: string
  parentId: string | null
  createdAt: number
  modifiedAt: number
  starred: boolean
  trashedAt: number | null
  trashedRoot?: string
  clock?: number
  device?: string
}

export type Entry = Deck | Folder

export type LibraryState = {
  entries: Record<string, Entry>
  lastBackupAt: number | null
  /** Sync: ids deleted permanently on this device, with the clock of the deletion. */
  tombstones?: Record<string, number>
  /** Library-wide settings that sync (AI providers and model). `clock` orders changes across devices. */
  settings?: { ai?: unknown; clock?: number }
}

export type ExportFormat = 'pptx' | 'html'
