// A cloud account's deck whose slides aren't on this device yet (spec: accounts, content on demand): fetch them,
// then open. Offline or signed out, say where the slides are instead of opening an empty deck.
import { CloudArrowDown, CloudSlash } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { activeAccount, PROVIDER_NAME } from '../data/accounts'
import { useLibrary } from '../data/library'
import { ensureContent, needsSignIn, reconnect, useSync } from '../data/sync'
import { navigate } from '../lib/router'
import { Button } from '../ui/Button'
import { EmptyState } from './PageHeader'
import s from './RemoteDeckGate.module.css'

export function RemoteDeckGate({ deckId, children }: { deckId: string; children: ReactNode }) {
  const deck = useLibrary().entries[deckId]
  const sync = useSync()
  const remote = deck?.type === 'deck' && !!deck.remote
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!remote) return
    setFailed(false)
    void ensureContent(deckId).then((ok) => { if (!ok) setFailed(true) })
  }, [remote, deckId, sync.auth, sync.online])
  if (!remote) return <>{children}</>
  const where = PROVIDER_NAME[activeAccount()?.kind ?? 'local']
  const blocked = !sync.online || needsSignIn(sync) || failed
  return (
    <div className={s.screen}>
      {blocked ? (
        <EmptyState icon={<CloudSlash size={24} />} title={`${deck.name} is in ${where}`}
          body={!sync.online ? 'Its slides aren’t on this device yet. Connect to the internet to open it.' : needsSignIn(sync) ? `Sign in to ${where} to open it.` : `Ream couldn’t get it from ${where}. Try again in a moment.`}>
          {needsSignIn(sync) ? <Button variant="primary" onClick={() => void reconnect()}>Sign in</Button> : sync.online && <Button variant="primary" onClick={() => { setFailed(false); void ensureContent(deckId).then((ok) => setFailed(!ok)) }}>Try again</Button>}
          <Button variant="ghost" onClick={() => navigate({ name: 'home' })}>Back to library</Button>
        </EmptyState>
      ) : (
        <div className={s.loading} role="status"><CloudArrowDown size={22} /><span>Opening {deck.name}…</span></div>
      )}
    </div>
  )
}
