// UI-phase data model. The real engine (domOXML on Pyodide + OPFS/SQLite) replaces the store's
// implementation later; these shapes are what the UI depends on.

export type SlideTheme = {
  bg: string
  fg: string
  muted: string
  accent: string
  surface: string
  serif?: boolean
}

export type SlideSpec =
  | { kind: 'title'; eyebrow?: string; title: string; subtitle?: string }
  | { kind: 'bullets'; title: string; items: string[] }
  | { kind: 'stat'; value: string; label: string; note?: string }
  | { kind: 'chart'; title: string; bars: number[]; labels: string[]; highlight?: number }
  | { kind: 'quote'; text: string; by: string }
  | { kind: 'split'; title: string; body: string; tag?: string }
  | { kind: 'grid'; title: string; cells: { label: string; value: string }[] }
  | { kind: 'section'; index: string; title: string }

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
  sizeBytes: number
  theme: SlideTheme
  slides: SlideSpec[]
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
}

export type Entry = Deck | Folder

export type LibraryState = {
  entries: Record<string, Entry>
  lastBackupAt: number | null
}

export type ExportFormat = 'pptx' | 'html'
