// Picks the composition (DESIGN.md §2). Both shells share routes, data and compositions.
import { MotionConfig } from 'motion/react'
import { lazy, Suspense } from 'react'
import { LibraryGate } from './compositions/LibraryGate'
import { DesktopApp } from './desktop/DesktopApp'
import { MobileApp } from './mobile/MobileApp'
import { useShell } from './lib/shell'
import { useDevicePrefs } from './data/prefs'
if (import.meta.env.DEV) void import('./lib/devhooks')
// Dev-only: every interactive-answer component in its states (spec: generative-ui.md).
const GenuiGallery = import.meta.env.DEV ? lazy(() => import('./genui/Gallery')) : null
const gallery = !!GenuiGallery && new URLSearchParams(location.search).get('preview') === 'genui'

export function App() {
  const shell = useShell()
  const prefs = useDevicePrefs()
  return (
    <MotionConfig reducedMotion={prefs.motion === 'reduce' ? 'always' : 'user'}>
      <LibraryGate>{gallery && GenuiGallery ? <Suspense fallback={null}><GenuiGallery /></Suspense> : shell === 'desktop' ? <DesktopApp /> : <MobileApp />}</LibraryGate>
    </MotionConfig>
  )
}
