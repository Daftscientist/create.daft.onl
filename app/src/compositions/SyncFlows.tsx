// Sync flows that any surface can start: connect (provider choice → sign-in → library choice → transfer),
// unlock an encrypted library, and turn encryption on. One host per shell renders whichever is open.
import { CircleNotch, Lock } from '@phosphor-icons/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { decks, getLibrary, isLive, backUp } from '../data/library'
import { DRIVES } from '../cloud'
import { cancelConnect, connect, finishConnect, PROVIDERS, setEncryption, unlock, useSync, type ProviderId } from '../data/sync'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Dialog'
import { TextField } from '../ui/Field'
import { ProviderMark } from './ProviderMark'
import s from './SyncFlows.module.css'

type Flow = null | 'connect' | 'unlock' | 'encrypt'
let flow: Flow = null
let pending: Promise<Awaited<ReturnType<typeof connect>>> | null = null
let pendingError: string | null = null
/** Connect straight to one provider (the provider rows are the connect controls). Runs inside the
 *  click so the sign-in window isn't blocked; the flow shows its progress and the next question. */
export function startConnect(id: ProviderId) {
  pendingError = null
  pending = connect(id).catch((e: Error) => { pendingError = e.name === 'PopupBlocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' : e.message; return 'cancelled' as const })
  openSyncFlow('connect')
}
export function prepareProviders() { for (const d of Object.values(DRIVES)) d.prepare() }
const listeners = new Set<() => void>()
export function openSyncFlow(f: Flow) { flow = f; listeners.forEach((l) => l()) }
const useFlow = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => flow)

export function SyncFlowHost() {
  const f = useFlow()
  const close = () => openSyncFlow(null)
  if (f === 'connect') return <ConnectFlow onClose={close} />
  if (f === 'unlock') return <UnlockFlow onClose={close} />
  if (f === 'encrypt') return <EncryptFlow onClose={close} />
  return null
}

const ORDER: ProviderId[] = ['dropbox', 'onedrive', 'google']

function ConnectFlow({ onClose }: { onClose: () => void }) {
  const sync = useSync()
  const [step, setStep] = useState<'pick' | 'signing' | 'choose'>(() => (pending ? 'signing' : 'pick'))
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const p = pending
    pending = null
    if (!p) return
    void p.then((r) => {
      if (r === 'choose') setStep('choose')
      else if (r === 'locked') { onClose(); openSyncFlow('unlock') }
      else if (r === 'done') onClose()
      else { setError(pendingError); setStep('pick'); if (!pendingError) onClose() }
    })
  }, [onClose])
  const local = decks(getLibrary()).filter(isLive).length

  if (step === 'pick') {
    return (
      <Modal title="Sync your library" onClose={onClose} width={480} actions={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
        {error && <p className={s.error}>{error}</p>}
        <p>Your decks are stored in a private folder in your own cloud account. {`Ream`} has no servers and never sees them.</p>
        <div className={s.providers}>
          {ORDER.map((id) => (
            <button key={id} type="button" className={s.provider} onClick={() => { startConnect(id); onClose(); openSyncFlow('connect') }}>
              <ProviderMark id={id} />
              <span className={s.pText}>
                <span className={s.pName}>{PROVIDERS[id].name}{PROVIDERS[id].recommended && <span className={s.badge}>Recommended</span>}</span>
                <span className={s.pMeta}>{PROVIDERS[id].stays}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>
    )
  }
  if (step === 'signing' || sync.auth === 'authorizing') {
    return (
      <Modal title={`Signing in to ${sync.provider ? PROVIDERS[sync.provider].name : ''}`} onClose={() => { cancelConnect(); onClose() }} actions={<Button variant="ghost" onClick={() => { cancelConnect(); onClose() }}>Cancel</Button>}>
        <p className={s.waiting}><CircleNotch size={18} className={s.spin} /> Finish signing in in the window that opened.</p>
        <p className={s.small}>Nothing happening? Your browser may have blocked the window. Close this and try again.</p>
      </Modal>
    )
  }
  const name = sync.provider ? PROVIDERS[sync.provider].name : ''
  const choose = (c: 'merge' | 'remote') => { onClose(); void finishConnect(c, local) }
  return (
    <Modal title={`${name} already has a library`} onClose={() => { cancelConnect(); onClose() }} width={500} actions={<Button variant="ghost" onClick={() => { cancelConnect(); onClose() }}>Cancel</Button>}>
      <p>Signed in as <strong>{sync.account}</strong>. It holds decks from <strong>{sync.otherDevice?.name ?? 'another device'}</strong>, and this browser has <strong>{local} decks</strong>.</p>
      <div className={s.choices}>
        <button type="button" className={s.choice} onClick={() => choose('merge')}>
          <span className={s.cTitle}>Merge both libraries <span className={s.badge}>Recommended</span></span>
          <span className={s.cMeta}>Keeps everything. If the same deck changed in both places you’ll get both copies, marked as a conflict.</span>
        </button>
        <button type="button" className={s.choice} onClick={async () => { await backUp(); choose('remote') }}>
          <span className={s.cTitle}>Use only the library in {name}</span>
          <span className={s.cMeta}>Backs up this browser’s decks to a file first, then replaces them here.</span>
        </button>
      </div>
    </Modal>
  )
}

function UnlockFlow({ onClose }: { onClose: () => void }) {
  const sync = useSync()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    const ok = await unlock(value)
    setBusy(false)
    if (ok) onClose()
    else setError('That passphrase didn’t unlock the library. Check it and try again.')
  }
  return (
    <Modal
      title="Unlock your library"
      onClose={onClose}
      actions={<><Button variant="ghost" onClick={onClose}>Not now</Button><Button variant="primary" disabled={!value || busy} onClick={submit} icon={<Lock size={15} />}>{busy ? 'Unlocking…' : 'Unlock'}</Button></>}
    >
      <p>Your {sync.provider ? PROVIDERS[sync.provider].name : ''} library is end-to-end encrypted. Enter the passphrase you chose on your other device.</p>
      <TextField label="Passphrase" type="password" autoFocus value={value} error={error} onChange={(e) => { setValue(e.target.value); setError(undefined) }} onKeyDown={(e) => e.key === 'Enter' && value && submit()} />
    </Modal>
  )
}

function EncryptFlow({ onClose }: { onClose: () => void }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [ack, setAck] = useState(false)
  const mismatch = b.length > 0 && a !== b
  const ok = a.length >= 8 && a === b && ack
  return (
    <Modal
      title="Turn on end-to-end encryption"
      onClose={onClose}
      width={480}
      actions={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!ok} onClick={() => { onClose(); void setEncryption(true, a) }}>Encrypt library</Button></>}
    >
      <p>Everything is encrypted in this browser before it reaches your cloud, so the provider only ever stores unreadable data. You’ll need this passphrase on each new device.</p>
      <TextField label="Passphrase" type="password" autoFocus value={a} hint="At least 8 characters" onChange={(e) => setA(e.target.value)} />
      <TextField label="Repeat passphrase" type="password" value={b} error={mismatch ? 'The passphrases don’t match.' : undefined} onChange={(e) => setB(e.target.value)} />
      <label className={s.ack}>
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span><strong>If I lose this passphrase, my cloud copy can’t be recovered.</strong> Ream can’t reset it.</span>
      </label>
    </Modal>
  )
}

