// Tiny path router. Routes are shared by both shells so a resize keeps your place.
import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'home' }
  | { name: 'files'; folderId: string | null }
  | { name: 'starred' }
  | { name: 'trash' }
  | { name: 'deck'; deckId: string; slide?: number }
  | { name: 'browse' }
  | { name: 'settings'; section: string | null }

export function parse(path: string): Route {
  const [, a, b, c] = path.split('/')
  switch (a) {
    case 'files': return { name: 'files', folderId: b || null }
    case 'starred': return { name: 'starred' }
    case 'trash': return { name: 'trash' }
    case 'browse': return { name: 'browse' }
    case 'settings': return { name: 'settings', section: b || null }
    case 'deck': return b ? { name: 'deck', deckId: b, slide: c ? Number(c) - 1 : undefined } : { name: 'home' }
    default: return { name: 'home' }
  }
}

export function href(r: Route): string {
  switch (r.name) {
    case 'home': return '/'
    case 'files': return r.folderId ? `/files/${r.folderId}` : '/files'
    case 'starred': return '/starred'
    case 'trash': return '/trash'
    case 'browse': return '/browse'
    case 'settings': return r.section ? `/settings/${r.section}` : '/settings'
    case 'deck': return `/deck/${r.deckId}${r.slide !== undefined ? `/${r.slide + 1}` : ''}`
  }
}

const listeners = new Set<() => void>()
addEventListener('popstate', () => listeners.forEach((l) => l()))

export function navigate(r: Route, opts: { replace?: boolean } = {}) {
  const url = href(r)
  if (url === location.pathname) return
  const go = () => {
    history[opts.replace ? 'replaceState' : 'pushState'](null, '', url)
    listeners.forEach((l) => l())
  }
  go()
}

export function useRoute(): Route {
  const path = useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => location.pathname,
  )
  return parse(path)
}

export const back = () => history.back()
