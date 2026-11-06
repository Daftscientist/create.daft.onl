// The account switcher (spec: accounts). Desktop: the account at the top of the sidebar opens a popover. Mobile: the
// avatar in the Home and Files headers opens a sheet. Both hold the same menu: the open account with its status,
// the others (each checked quietly for a working session), Add account, Manage accounts.
import { CaretUpDown, CircleNotch, GearSix, Plus, SignIn, UsersThree, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { accountSub, activeAccount, PROVIDER_NAME, switchTo, useAccounts, type Account, type AccountKind } from '../data/accounts'
import { accountHealth, addCloudAccount, addLocalAccount, signInAgain, type Health } from '../data/accountActions'
import { driveFor } from '../cloud'
import { needsSignIn, reconnect, summary, useSync } from '../data/sync'
import { navigate } from '../lib/router'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Dialog'
import { Popover } from '../ui/Popover'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/Field'
import { AccountAvatar } from './AccountAvatar'
import { ProviderMark } from './ProviderMark'
import s from './AccountSwitcher.module.css'

/** True when the open account can't sync until its owner signs in again (the avatar shows an amber dot). */
export function useAccountWarn() {
  const sync = useSync()
  return needsSignIn(sync) || sync.locked
}

/** Desktop: top of the sidebar. */
export function AccountButton() {
  const me = activeAccount()
  const warn = useAccountWarn()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!me) return null
  return (
    <>
      <button type="button" className={s.trigger} aria-haspopup="dialog" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        aria-label={`${me.name}, ${accountSub(me)}${warn ? ', signed out' : ''}. Switch account`}>
        <AccountAvatar account={me} size={26} badge={false} warn={warn} />
        <span className={s.triggerText}><b>{me.name}</b><span>{me.kind === 'local' ? 'On this device' : PROVIDER_NAME[me.kind]}</span></span>
        <CaretUpDown size={13} className={s.caret} />
      </button>
      {anchor && <Popover anchor={anchor} label="Accounts" width={320} onClose={() => setAnchor(null)}><AccountMenu onClose={() => setAnchor(null)} /></Popover>}
    </>
  )
}

/** Mobile: the avatar in the screen header. */
export function AccountAvatarButton() {
  const me = activeAccount()
  const warn = useAccountWarn()
  const [open, setOpen] = useState(false)
  if (!me) return null
  return (
    <>
      <button type="button" className={s.avatarButton} aria-label={`${me.name}${warn ? ', signed out' : ''}. Switch account`} onClick={() => setOpen(true)}>
        <AccountAvatar account={me} size={32} badge={false} warn={warn} />
      </button>
      {open && <Sheet label="Accounts" onClose={() => setOpen(false)}><AccountMenu onClose={() => setOpen(false)} withSettings /></Sheet>}
    </>
  )
}

export function AccountMenu({ onClose, withSettings }: { onClose: () => void; withSettings?: boolean }) {
  const { accounts } = useAccounts()
  const me = activeAccount()!
  const sync = useSync()
  const sum = summary(sync)
  const others = accounts.filter((a) => a.id !== me.id)
  const [health, setHealth] = useState<Record<string, Health | 'checking'>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [failed, setFailed] = useState<{ id: string; message: string } | null>(null)
  const [adding, setAdding] = useState(false)

  // Check every other account quietly when the menu opens (silent refresh where the provider allows it), and load
  // sign-in code ahead so a click can open its window at once.
  useEffect(() => {
    for (const a of others) {
      if (a.kind === 'local') continue
      driveFor(a).prepare()
      setHealth((h) => ({ ...h, [a.id]: 'checking' }))
      void accountHealth(a).then((v) => setHealth((h) => ({ ...h, [a.id]: v })))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const pick = async (a: Account) => {
    setFailed(null)
    if (health[a.id] !== 'signin') { setBusy(a.id); if (!(await switchTo(a.id))) setBusy(null); return }
    // A lapsed session: sign in first (inside this click), then open it.
    setBusy(a.id)
    try { await signInAgain(a); if (!(await switchTo(a.id))) setBusy(null) } catch (e) {
      setBusy(null)
      const err = e as Error
      setFailed({ id: a.id, message: err.name === 'SignInCancelled' ? 'Sign-in was cancelled.' : err.name === 'PopupBlocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site.' : err.message })
    }
  }

  return (
    <div className={s.menu}>
      <div className={s.me}>
        <AccountAvatar account={me} size={44} />
        <div className={s.meText}>
          <b>{me.name}</b>
          <span>{accountSub(me)}</span>
          <span className={s.status} data-tone={sum.tone}>{me.kind === 'local' ? 'Kept in this browser' : sum.text}</span>
        </div>
      </div>
      {needsSignIn(sync) && (
        <div className={s.alert}>
          <WarningCircle size={16} weight="fill" />
          <span>{me.kind === 'google' ? 'Google Drive access expired' : `Signed out of ${PROVIDER_NAME[me.kind]}`}. {sync.pending ? `${sync.pending} ${sync.pending === 1 ? 'change is' : 'changes are'} waiting here.` : 'Your work is safe on this device.'}</span>
          <Button variant="primary" icon={<SignIn size={15} />} disabled={sync.auth === 'reconnecting'} onClick={() => void reconnect()}>{me.kind === 'google' ? 'Reconnect' : 'Sign in again'}</Button>
        </div>
      )}

      {others.length > 0 && (
        <ul className={s.list} aria-label="Other accounts">
          {others.map((a) => {
            const h = health[a.id]
            return (
              <li key={a.id}>
                <button type="button" className={s.row} onClick={() => void pick(a)} disabled={!!busy}>
                  <AccountAvatar account={a} size={32} warn={h === 'signin'} />
                  <span className={s.rowText}>
                    <b>{a.name}</b>
                    <span>{accountSub(a)}</span>
                    {h === 'signin' && <span className={s.signin}>{a.kind === 'google' ? 'Drive access expired' : 'Signed out'} · tap to sign in</span>}
                    {h === 'offline' && <span>Offline · opens this device’s copy</span>}
                  </span>
                  {busy === a.id ? <CircleNotch size={16} className={s.spin} /> : h === 'checking' ? null : h === 'signin' ? <SignIn size={16} className={s.rowIcon} /> : null}
                </button>
                {(h === 'signin' || failed?.id === a.id) && (
                  <div className={s.failed}>
                    {failed?.id === a.id && <span>{failed.message}</span>}
                    <button type="button" className={s.link} onClick={() => void switchTo(a.id)}>Open without signing in</button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className={s.actions}>
        <button type="button" className={s.action} onClick={() => setAdding(true)}><span className={s.actionIcon}><Plus size={16} /></span>Add account</button>
        <button type="button" className={s.action} onClick={() => { onClose(); navigate({ name: 'settings', section: 'accounts' }) }}><span className={s.actionIcon}><UsersThree size={16} /></span>Manage accounts</button>
        {withSettings && <button type="button" className={s.action} onClick={() => { onClose(); navigate({ name: 'settings', section: null }) }}><span className={s.actionIcon}><GearSix size={16} /></span>Settings</button>}
      </div>
      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
    </div>
  )
}

const CHOICES: { kind: AccountKind; line: string; recommended?: boolean }[] = [
  { kind: 'dropbox', line: 'Stays signed in. Your files live in Dropbox › Apps › Ream.', recommended: true },
  { kind: 'google', line: 'Your files live in a private Ream folder in your Drive. Google signs you out about hourly; one click signs back in.' },
  { kind: 'onedrive', line: 'Your files live in OneDrive › Apps › Ream. Sign in about once a day.' },
  { kind: 'local', line: 'Private to this browser, nothing leaves the device. Back it up yourself.' },
]

/** The four ways to keep your work, for first run and Add account. Each cloud row signs in inside its click. */
export function AccountChoices({ onAdded, compact }: { onAdded: (a: Account, existed: boolean) => void; compact?: boolean }) {
  const [busy, setBusy] = useState<AccountKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [naming, setNaming] = useState(false)
  const attempt = useRef(0)
  const [name, setName] = useState('')
  const { accounts } = useAccounts()
  useEffect(() => { driveFor({ id: '__prepare', kind: 'google' }).prepare() }, [])

  const choose = async (kind: AccountKind) => {
    setError(null)
    if (kind === 'local') { setNaming(true); return }
    setBusy(kind)
    const mine = ++attempt.current
    try { const r = await addCloudAccount(kind, () => attempt.current !== mine); if (r) onAdded(r.account, r.existed) } catch (e) {
      const err = e as Error
      if (attempt.current === mine && err.name !== 'SignInCancelled') setError(err.name === 'PopupBlocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' : `${PROVIDER_NAME[kind]} sign-in didn’t finish: ${err.message}`)
    } finally { if (attempt.current === mine) setBusy(null) }
  }

  if (naming) {
    const suggestion = accounts.some((a) => a.kind === 'local') ? 'Work' : 'Personal'
    return (
      <form className={s.naming} onSubmit={(e) => { e.preventDefault(); onAdded(addLocalAccount(name || suggestion), false) }}>
        <TextField label="Name" value={name} placeholder={suggestion} autoFocus onChange={(e) => setName(e.target.value)} />
        <p className={s.note}>A separate library kept only in this browser. Nothing in it is shared with your other accounts.</p>
        <div className={s.namingActions}>
          <Button variant="ghost" type="button" onClick={() => setNaming(false)}>Back</Button>
          <Button variant="primary" type="submit">Create</Button>
        </div>
      </form>
    )
  }
  return (
    <div className={s.choices} data-compact={compact || undefined}>
      {CHOICES.map((c) => (
        <button key={c.kind} type="button" className={s.choice} disabled={!!busy} onClick={() => void choose(c.kind)}>
          {c.kind === 'local' ? <span className={s.localMark}><LaptopGlyph /></span> : <ProviderMark id={c.kind} size={36} />}
          <span className={s.choiceText}>
            <b>{c.kind === 'local' ? (accounts.some((a) => a.kind === 'local') ? 'Another library on this device' : 'On this device') : PROVIDER_NAME[c.kind]}{c.recommended && <span className={s.tag}>Recommended</span>}</b>
            <span>{c.line}</span>
          </span>
          {busy === c.kind ? <CircleNotch size={18} className={s.spin} /> : null}
        </button>
      ))}
      {busy && <p className={s.waiting}>Finish signing in to {PROVIDER_NAME[busy]} in the window that opened. <button type="button" className={s.link} onClick={() => { attempt.current++; setBusy(null) }}>Cancel</button></p>}
      {error && <p className={s.error} role="alert">{error}</p>}
    </div>
  )
}

function LaptopGlyph() {
  return <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d="M232 168h-8V72a24 24 0 0 0-24-24H56a24 24 0 0 0-24 24v96h-8a8 8 0 0 0-8 8v16a24 24 0 0 0 24 24h176a24 24 0 0 0 24-24v-16a8 8 0 0 0-8-8ZM48 72a8 8 0 0 1 8-8h144a8 8 0 0 1 8 8v96H48Zm176 120a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8v-8h192Z" /></svg>
}

export function AddAccountDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Add an account" width={480} onClose={onClose} actions={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <p className={s.note}>Each account is its own library. Switch between them any time.</p>
      <AccountChoices onAdded={(a) => switchTo(a.id)} />
    </Modal>
  )
}


