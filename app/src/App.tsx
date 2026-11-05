// Picks the composition (DESIGN.md §2). Both shells share routes, data and compositions.
import { MotionConfig } from 'motion/react'
import { LibraryGate } from './compositions/LibraryGate'
import { DesktopApp } from './desktop/DesktopApp'
import { MobileApp } from './mobile/MobileApp'
import { useShell } from './lib/shell'

export function App() {
  const shell = useShell()
  return (
    <MotionConfig reducedMotion="user">
      <LibraryGate>{shell === 'desktop' ? <DesktopApp /> : <MobileApp />}</LibraryGate>
    </MotionConfig>
  )
}
