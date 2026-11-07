// Everything that must be true before the library can be shown: this tab owns the store and the
// store has opened. Each other state gets one calm, explained screen; nothing flashes for fast boots.
import { ArrowsLeftRight, HardDrives, Lock, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { bootLibrary, getBootError, useBoot } from '../data/library'
import { takeOver, useOwnership } from '../storage/client'
import { BrandMark, PRODUCT } from '../ui/Brand'
import { Button } from '../ui/Button'
import { EmptyState } from './PageHeader'
import { FirstRun } from './FirstRun'
import { AccountPicker, noteSeen, shouldPick } from './AccountPicker'
import { adoptLegacyLibrary, needsFirstRun } from '../data/accounts'
import s from './LibraryGate.module.css'

let started = false

export function LibraryGate({ children }: { children: ReactNode }) {
  // No account yet: choose where work lives before anything opens, unless this browser already holds a library
  // from before accounts (then it becomes the first account, untouched).
  const first = needsFirstRun() && !new URLSearchParams(location.search).has('memory')
  const [legacy, setLegacy] = useState<'checking' | 'none'>(first ? 'checking' : 'none')
  useEffect(() => {
    if (!first) return
    void (async () => {
      try {
        const root = await navigator.storage.getDirectory()
        await root.getDirectoryHandle('ream-db')
        adoptLegacyLibrary(); location.reload(); return
      } catch { /* no old library */ }
      setLegacy('none')
    })()
  }, [first])
  const [pick, setPick] = useState(() => !first && shouldPick())
  useEffect(() => { if (!first && !pick) noteSeen() }, [first, pick])
  if (first) return legacy === 'checking' ? <Screen /> : <FirstRun />
  if (pick) return <AccountPicker onContinue={() => setPick(false)} />
  return <Gate>{children}</Gate>
}

function Gate({ children }: { children: ReactNode }) {
  const own = useOwnership()
  const boot = useBoot()
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!started) { started = true; bootLibrary() }
    const t = setTimeout(() => setSlow(true), 400)
    return () => clearTimeout(t)
  }, [])

  if (own === 'elsewhere') {
    return (
      <Screen>
        <EmptyState icon={<ArrowsLeftRight size={24} />} title={`${PRODUCT} is open in another tab`} body="Your library can only be open in one tab at a time, so changes never collide.">
          <Button variant="primary" onClick={takeOver}>Use here</Button>
        </EmptyState>
      </Screen>
    )
  }
  if (own === 'lost') {
    return (
      <Screen>
        <EmptyState icon={<ArrowsLeftRight size={24} />} title="Moved to another tab" body="You opened your library in another tab. Everything you did here is saved.">
          <Button variant="secondary" onClick={() => location.reload()}>Use here instead</Button>
        </EmptyState>
      </Screen>
    )
  }
  if (own === 'insecure') {
    return (
      <Screen>
        <EmptyState icon={<Lock size={24} />} title={`Open ${PRODUCT} over a secure address`} body={`Browsers only allow private file storage on HTTPS pages, and this page was opened over plain HTTP (${location.host}). Open the HTTPS address for this site instead.`}>
          <Button variant="ghost" onClick={() => { location.search = '?memory' }}>Try without saving</Button>
        </EmptyState>
      </Screen>
    )
  }
  if (own === 'unsupported' || boot === 'failed') {
    return (
      <Screen>
        <EmptyState
          icon={own === 'unsupported' ? <HardDrives size={24} /> : <WarningCircle size={24} />}
          title={own === 'unsupported' ? 'This browser can’t store your library' : 'Your library didn’t open'}
          body={own === 'unsupported'
            ? `${PRODUCT} keeps everything on this device, which needs private file storage. Try a current Chrome, Edge, Firefox or Safari, outside private browsing.`
            : `Something went wrong opening local storage (${getBootError()}). Reloading usually fixes it.`}
        >
          <Button variant="secondary" onClick={() => location.reload()}>Reload</Button>
          <Button variant="ghost" onClick={() => { location.search = '?memory' }}>Try without saving</Button>
        </EmptyState>
      </Screen>
    )
  }
  if (boot !== 'ready') {
    return slow ? <Screen><div className={s.opening}><BrandMark size={28} /><span>Opening your library…</span></div></Screen> : <Screen />
  }
  return <>{children}</>
}

function Screen({ children }: { children?: ReactNode }) {
  return <div className={s.screen}>{children}</div>
}
