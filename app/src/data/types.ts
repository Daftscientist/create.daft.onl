// UI-phase data model. The real engine (domOXML on Pyodide + OPFS/SQLite) replaces the store's
// implementation later; these shapes are what the UI depends on.

/** One slide as domOXML normalized HTML: what the viewer renders, the AI reads and edits, and the
 *  engine converts to and from PPTX. `id` is stable across edits and reorders.
 *  Imported slides keep their domOXML IR (JSON) for exact export, with what changed since import
 *  (editor/irdiff.ts): `irDirty` nodes are captured from the HTML, `irMoved` nodes keep their IR with
 *  a new box, every other node ships its original IR. `irSlide`: the slide's own attributes
 *  (background, notes, transition) changed. `hidden`: skipped when presenting. Speaker notes,
 *  transitions and animations live in the HTML as domOXML reads them (data-notes, data-transition*,
 *  data-animate*), so they import, export and reach the AI unchanged. */
export type SlideDoc = { id: string; html: string; ir?: string; irDirty?: string[]; irMoved?: string[]; irSlide?: boolean; irAnim?: boolean; hidden?: boolean; comments?: SlideComment[] }
/** A comment on a slide (or one object on it). Kept with the deck, so it syncs; never exported. */
/** A comment on a slide: pinned to a point on it (`pin`, slide px), attached to objects (`objectIds`; `objectId`
 *  is the older single form), or on the slide as a whole. `by`: who wrote it (the user, or Ask). */
export type SlideComment = { id: string; text: string; at: number; objectId?: string; objectIds?: string[]; pin?: { x: number; y: number }; by?: 'user' | 'ai'; resolved?: boolean; replies?: { id: string; text: string; at: number; by?: 'user' | 'ai' }[] }
/** Slide size in CSS px; 1280x720 unless an imported deck says otherwise. */
export type SlideSize = { w: number; h: number }

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
  /** Sync: the cloud copy of the content this device has (an immutable revision in the account's storage). */
  docRev?: string
  /** Sync: only the deck's details are on this device so far; its slides come from the account when opened. */
  remote?: true
  sizeBytes: number
  slides: SlideDoc[]
  /** Imported decks: their slide size and shared CSS (embedded @font-face). Stored with the slides. */
  size?: SlideSize
  css?: string
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
  settings?: { ai?: unknown; appearance?: unknown; clock?: number }
  /** Ask's conversation per deck. Kept with the account and synced, like the decks. */
  chats?: Record<string, Chat>
}
export type Chat = { clock: number; device?: string; turns: unknown[] }

export type ExportFormat = 'pptx' | 'html'
