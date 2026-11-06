// Sync flows that any surface can start: unlock an encrypted library, and turn encryption on.
// (Adding a cloud is now adding an account: compositions/AccountSwitcher.) One host per shell renders whichever is open.
import { Lock } from '@phosphor-icons/react'
import { useState, useSyncExternalStore } from 'react'
import { PROVIDERS, setEncryption, unlock, useSync } from '../data/sync'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Dialog'
import { TextField } from '../ui/Field'
import s from './SyncFlows.module.css'

type Flow = null | 'unlock' | 'encrypt'
let flow: Flow = null
const listeners = new Set<() => void>()
export function openSyncFlow(f: Flow) { flow = f; listeners.forEach((l) => l()) }
const useFlow = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => flow)

export function SyncFlowHost() {
  const f = useFlow()
  const close = () => openSyncFlow(null)
  if (f === 'unlock') return <UnlockFlow onClose={close} />
  if (f === 'encrypt') return <EncryptFlow onClose={close} />
  return null
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

