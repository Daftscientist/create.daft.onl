// Settings → Accounts (spec: accounts). The open account as a card with its status and the one action it needs,
// its sync and encryption settings, then every other account on this device with Switch and Remove.
import { Plus, SignIn, Trash } from '@phosphor-icons/react'
import { useState } from 'react'
import { accountSub, activeAccount, PROVIDER_NAME, switchTo, updateAccount, useAccounts, type Account } from '../data/accounts'
import { removeAccount } from '../data/accountActions'
import { backUp, decks, isLive, useLibrary } from '../data/library'
import { PROVIDERS, setDeviceName, setEncryption, setVisibleCopies, syncNow, useSync } from '../data/sync'
import { toast } from '../data/toasts'
import { count, relTimeInline } from '../lib/format'
import { Button } from '../ui/Button'
import { Confirm } from '../ui/Dialog'
import { SettingGroup, SettingRow, Switch, TextField } from '../ui/Field'
import { AccountAvatar } from './AccountAvatar'
import { AddAccountDialog } from './AccountSwitcher'
import { openSyncFlow } from './SyncFlows'
import { runSyncAction, useSyncSummary } from './SyncStatus'
import s from './AccountsSettings.module.css'

export function AccountsSettings() {
  const { accounts } = useAccounts()
  const me = activeAccount()!
  const sync = useSync()
  const lib = useLibrary()
  const { sum } = useSyncSummary()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<Account | null>(null)
  const [encOff, setEncOff] = useState(false)
  const others = accounts.filter((a) => a.id !== me.id)
  const cloud = me.kind !== 'local'
  const n = decks(lib).filter(isLive).length

  return (
    <>
      <p className={s.lede}>Each account is its own library. The one you have open {cloud ? 'syncs with its storage' : 'lives in this browser'}; switch any time from the top of the sidebar.</p>

      <section className={s.card} aria-label={`${me.name}, open now`}>
        <AccountAvatar account={me} size={56} />
        <div className={s.cardText}>
          <span className={s.open}>Open now</span>
          {me.kind === 'local'
            ? <input className={s.nameInput} aria-label="Account name" value={me.name} onChange={(e) => updateAccount(me.id, { name: e.target.value })} onBlur={(e) => { if (!e.target.value.trim()) updateAccount(me.id, { name: 'Personal' }) }} />
            : <b className={s.name}>{me.name}</b>}
          <span className={s.sub}>{accountSub(me)}{cloud ? ` · ${PROVIDERS[me.kind as keyof typeof PROVIDERS].folder}` : ''}</span>
          <span className={s.status} data-tone={cloud ? sum.tone : 'muted'}>{cloud ? sum.text : `${count(n, 'deck')} in this browser`}</span>
        </div>
        <div className={s.cardAction}>
          {cloud && (sum.action
            ? <Button variant="primary" icon={sum.action === 'reconnect' ? <SignIn size={15} /> : undefined} disabled={sync.auth === 'reconnecting'} onClick={() => runSyncAction(sum.action!)}>{sum.action === 'reconnect' ? 'Sign in again' : sum.action === 'unlock' ? 'Unlock' : sum.action === 'review' ? 'Review' : 'Manage'}</Button>
            : <Button variant="secondary" disabled={!sync.online || !!sync.transfer} onClick={() => void syncNow()}>Sync now</Button>)}
          {!cloud && <Button variant="secondary" onClick={() => void backUp()}>Back up</Button>}
        </div>
      </section>

      {cloud && (
        <SettingGroup title={PROVIDER_NAME[me.kind]}>
          <SettingRow label="Last synced" description={sync.lastSyncAt ? `${relTimeInline(sync.lastSyncAt)}. Sync runs a few seconds after each change, and when you come back to ${PROVIDER_NAME[me.kind] === 'This device' ? 'Ream' : 'this tab'}.` : 'Not yet. Sync runs a few seconds after each change.'} />
          <SettingRow label="End-to-end encryption" description={`Encrypt everything in this browser before it reaches ${PROVIDER_NAME[me.kind]}, so it only stores unreadable data.`}>
            <Switch label="End-to-end encryption" disabled={!!sync.transfer} checked={sync.encrypted} onChange={(v) => (v ? openSyncFlow('encrypt') : setEncOff(true))} />
          </SettingRow>
          {me.kind === 'google' && (
            <SettingRow label="Also keep PowerPoint copies in My Drive" description="A visible “Ream” folder with a .pptx of every deck. Asks Google for one more permission.">
              <Switch label="Keep PowerPoint copies in My Drive" checked={sync.visibleCopies} onChange={setVisibleCopies} />
            </SettingRow>
          )}
          <SettingRow label="Device name" description="Shown on your other devices, for example in conflict copies.">
            <TextField label="Device name" hideLabel className={s.nameField} value={sync.deviceName} onChange={(e) => setDeviceName(e.target.value)} />
          </SettingRow>
        </SettingGroup>
      )}

      <SettingGroup title={others.length ? 'Other accounts on this device' : 'Other accounts'}>
        {others.map((a) => (
          <div key={a.id} className={s.row}>
            <AccountAvatar account={a} size={36} />
            <span className={s.rowText}><b>{a.name}</b><span>{accountSub(a)}</span></span>
            <Button variant="secondary" onClick={() => switchTo(a.id)}>Switch</Button>
            <Button variant="ghost" aria-label={`Remove ${a.name}`} icon={<Trash size={15} />} onClick={() => setRemoving(a)}>Remove</Button>
          </div>
        ))}
        <div className={s.row}>
          <span className={s.addIcon}><Plus size={18} /></span>
          <span className={s.rowText}><b>Add an account</b><span>Dropbox, Google Drive, OneDrive, or another library on this device</span></span>
          <Button variant="primary" onClick={() => setAdding(true)}>Add</Button>
        </div>
      </SettingGroup>

      <SettingGroup title="Danger zone" tone="danger">
        <SettingRow label={`Remove ${me.name} from this browser`} description={cloud ? `Deletes this browser’s copy. Everything stays in ${PROVIDER_NAME[me.kind]}, and you can add the account again any time.` : 'Deletes this library and everything in it. Back up first if you want to keep it.'}>
          <Button variant="secondary" onClick={() => setRemoving(me)}>Remove…</Button>
        </SettingRow>
      </SettingGroup>

      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
      {removing && (
        <Confirm
          title={`Remove ${removing.name} from this browser?`}
          danger
          confirmLabel={removing.kind === 'local' ? 'Delete this library' : 'Remove from this browser'}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            const a = removing
            const ok = await removeAccount(a)
            if (!ok) toast({ message: `${a.name} is open in another tab. Close it there, then try again.`, tone: 'danger' })
            else if (a.id !== me.id) toast({ message: `Removed ${a.name} from this browser` })
          }}
          body={removing.kind === 'local'
            ? <p>Everything in <strong>{removing.name}</strong> is deleted from this browser, and it isn’t stored anywhere else.{removing.id === me.id ? <> <button type="button" className={s.link} onClick={() => void backUp()}>Back up first</button></> : ' Switch to it and back it up first if you want to keep it.'}</p>
            : <p>This browser’s copy is deleted and you’re signed out. Your files stay in {PROVIDER_NAME[removing.kind]}.{removing.id === me.id && sync.pending ? <> <strong>{sync.pending} changes haven’t synced yet and will be lost.</strong></> : null}</p>}
        />
      )}
      {encOff && (
        <Confirm title="Turn off encryption?" confirmLabel="Turn off" onClose={() => setEncOff(false)} onConfirm={() => void setEncryption(false)}
          body={<p>Your copy in {PROVIDER_NAME[me.kind]} will be stored readable again. Your library itself doesn’t change.</p>} />
      )}
    </>
  )
}
