// Which composition to show (DESIGN.md §2). Width decides; a coarse pointer raises the bar.
import { useSyncExternalStore } from 'react'

const query = '(max-width: 759px), (pointer: coarse) and (max-width: 899px)'
const mq = matchMedia(query)

export type Shell = 'desktop' | 'mobile'

export function useShell(): Shell {
  const mobile = useSyncExternalStore(
    (l) => (mq.addEventListener('change', l), () => mq.removeEventListener('change', l)),
    () => mq.matches,
  )
  return mobile ? 'mobile' : 'desktop'
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'
