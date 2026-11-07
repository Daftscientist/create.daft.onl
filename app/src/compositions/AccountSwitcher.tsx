// The account switcher (spec: accounts). Desktop: the account at the top of the sidebar opens a popover. Mobile: the
// avatar in the Home and Files headers opens a sheet. Both hold the same menu: the open account with its status,
// the others (each checked quietly for a working session), Add account, Manage accounts.
import { CaretUpDown, CircleNotch, DiceFive, DotsThree, GearSix, LinkBreak, PencilSimple, Plus, SignIn, SignOut, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { accountSub, activeAccount, PROVIDER_NAME, switchTo, updateAccount, useAccounts, type Account, type AccountKind } from '../data/accounts'
import { accountHealth, addCloudAccount, addLocalAccount, removeAccount, signInAgain, signOutAccount, type Health } from '../data/accountActions'
import { driveFor } from '../cloud'
import { needsSignIn, reconnect, summary, useSync } from '../data/sync'
import { navigate } from '../lib/router'
import { Button } from '../ui/Button'
import { confirm, Modal } from '../ui/Dialog'
import { toast } from '../data/toasts'
import { Popover } from '../ui/Popover'
import { Sheet } from '../ui/Sheet'
import { TextField } from '../ui/Field'
import { AccountAvatar } from './AccountAvatar'
import { cameoAvatar, newSeed } from '../lib/avatar'
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
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)

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

  const failMessage = (e: unknown) => {
    const err = e as Error
    return err.name === 'SignInCancelled' ? 'Sign-in was cancelled.' : err.name === 'PopupBlocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site.' : err.message
  }
  const pick = async (a: Account) => {
    setFailed(null)
    setBusy(a.id)
    if (health[a.id] !== 'signin') { if (!(await switchTo(a.id))) setBusy(null); return }
    // Signed out: sign in first (inside this click), then open it.
    try { await signInAgain(a); if (!(await switchTo(a.id))) setBusy(null) } catch (e) { setBusy(null); setFailed({ id: a.id, message: failMessage(e) }) }
  }
  const signIn = async (a: Account) => {
    setFailed(null)
    try {
      if (a.id === me.id) await reconnect()
      else { await signInAgain(a); setHealth((h) => ({ ...h, [a.id]: 'ok' })) }
    } catch (e) { setFailed({ id: a.id, message: failMessage(e) }) }
  }
  const signOut = async (a: Account) => {
    await signOutAccount(a)
    if (a.id !== me.id) setHealth((h) => ({ ...h, [a.id]: 'signin' }))
    setOpen(null)
  }
  const unlink = async (a: Account) => {
    const local = a.kind === 'local'
    const ok = await confirm({
      title: local ? `Delete ${a.name}?` : `Unlink ${a.name}?`,
      body: local
        ? <p>Everything in this library is deleted from this browser, and it isn’t stored anywhere else.{a.id === me.id ? ' Back it up first from Settings → Storage if you want to keep it.' : ''}</p>
        : <p>You’re signed out and this browser forgets the account and its copy of your files. Everything stays in {PROVIDER_NAME[a.kind]}; add the account again any time.{a.id === me.id && sync.pending ? <> <strong>{sync.pending} {sync.pending === 1 ? 'change hasn’t' : 'changes haven’t'} reached {PROVIDER_NAME[a.kind]} yet and will be lost.</strong></> : null}</p>,
      confirmLabel: local ? 'Delete library' : 'Unlink',
      danger: true,
    })
    if (!ok) return
    if (!(await removeAccount(a))) toast({ message: `${a.name} is open in another tab. Close it there, then try again.`, tone: 'danger' })
    else if (a.id !== me.id) { toast({ message: local ? `Deleted ${a.name}` : `Unlinked ${a.name}` }); setOpen(null) }
  }

  /** The actions under an account, revealed by its ⋯ button. */
  const actions = (a: Account, signedOut: boolean) => (
    <div className={s.rowActions}>
      {a.kind !== 'local' && signedOut && <button type="button" className={s.chip} onClick={() => void signIn(a)}><SignIn size={14} />Sign in</button>}
      {a.kind === 'local' && <button type="button" className={s.chip} onClick={() => { setEditing(a); setOpen(null) }}><PencilSimple size={14} />Edit</button>}
      {a.kind !== 'local' && !signedOut && <button type="button" className={s.chip} onClick={() => void signOut(a)}><SignOut size={14} />Sign out</button>}
      <button type="button" className={s.chip} data-danger onClick={() => void unlink(a)}><LinkBreak size={14} />{a.kind === 'local' ? 'Delete' : 'Unlink'}</button>
    </div>
  )
  const nameOrInput = (a: Account) => <b>{a.name}</b>
  const more = (a: Account) => (
    <button type="button" className={s.more} aria-label={`More for ${a.name}`} aria-expanded={open === a.id} onClick={() => setOpen(open === a.id ? null : a.id)}><DotsThree size={18} weight="bold" /></button>
  )

  return (
    <div className={s.menu}>
      <div className={s.me}>
        <AccountAvatar account={me} size={44} warn={needsSignIn(sync)} />
        <div className={s.meText}>
          {nameOrInput(me)}
          <span>{accountSub(me)}</span>
          {(me.kind === 'local' || sum.tone !== 'ok') && <span className={s.status} data-tone={me.kind === 'local' ? 'muted' : sum.tone}>{me.kind === 'local' ? 'Kept in this browser' : sum.title}</span>}
        </div>
        {more(me)}
      </div>
      {open === me.id && actions(me, needsSignIn(sync))}
      {failed?.id === me.id && <p className={s.failedLine}>{failed.message}</p>}
      {needsSignIn(sync) && (
        <div className={s.alert}>
          <WarningCircle size={16} weight="fill" />
          <span>{me.kind === 'google' ? 'Google Drive access expired' : `Signed out of ${PROVIDER_NAME[me.kind]}`}. {sync.pending ? `${sync.pending} ${sync.pending === 1 ? 'change is' : 'changes are'} waiting here.` : 'Your work is safe on this device.'}</span>
          <Button variant="primary" icon={<SignIn size={15} />} disabled={sync.auth === 'reconnecting'} onClick={() => void reconnect()}>Sign in</Button>
        </div>
      )}

      {others.length > 0 && (
        <ul className={s.list} aria-label="Other accounts">
          {others.map((a) => {
            const h = health[a.id]
            return (
              <li key={a.id}>
                <div className={s.rowWrap}>
                  <button type="button" className={s.row} onClick={() => void pick(a)} disabled={!!busy}>
                    <AccountAvatar account={a} size={32} warn={h === 'signin'} />
                    <span className={s.rowText}>
                      {nameOrInput(a)}
                      <span>{accountSub(a)}</span>
                      {h === 'signin' && <span className={s.signin}>Signed out · sign in to open</span>}
                      {h === 'offline' && <span>Offline · opens this device’s copy</span>}
                    </span>
                    {busy === a.id && <CircleNotch size={16} className={s.spin} />}
                  </button>
                  {more(a)}
                </div>
                {open === a.id && actions(a, h === 'signin')}
                {(h === 'signin' || failed?.id === a.id) && open !== a.id && (
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
        {withSettings && <button type="button" className={s.action} onClick={() => { onClose(); navigate({ name: 'settings', section: null }) }}><span className={s.actionIcon}><GearSix size={16} /></span>Settings</button>}
      </div>
      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
      {editing && <EditLocalAccount account={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const CHOICES: { kind: AccountKind; line: string; recommended?: boolean }[] = [
  { kind: 'dropbox', line: 'Stays signed in. Your files live in Dropbox › Apps › Ream.', recommended: true },
  { kind: 'google', line: 'Your files live in a private Ream folder in your Drive. Google signs you out about hourly; one click signs back in.' },
  { kind: 'onedrive', line: 'Your files live in OneDrive › Apps › Ream. Sign in about once a day.' },
  { kind: 'local', line: 'Private to this browser, nothing leaves the device. Back it up yourself.' },
]

/** The four ways to keep your work, for first run and Add account. Each cloud row signs in inside its click; the
 *  local one goes to the next step (`onLocal`). */
export function AccountChoices({ onAdded, onLocal }: { onAdded: (a: Account, existed: boolean) => void; onLocal: () => void }) {
  const [busy, setBusy] = useState<AccountKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const attempt = useRef(0)
  const { accounts } = useAccounts()
  useEffect(() => { driveFor({ id: '__prepare', kind: 'google' }).prepare() }, [])

  const choose = async (kind: AccountKind) => {
    setError(null)
    if (kind === 'local') { onLocal(); return }
    setBusy(kind)
    const mine = ++attempt.current
    try { const r = await addCloudAccount(kind, () => attempt.current !== mine); if (r) onAdded(r.account, r.existed) } catch (e) {
      const err = e as Error
      if (attempt.current === mine && err.name !== 'SignInCancelled') setError(err.name === 'PopupBlocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' : `${PROVIDER_NAME[kind]} sign-in didn’t finish: ${err.message}`)
    } finally { if (attempt.current === mine) setBusy(null) }
  }

  return (
    <div className={s.choices}>
      {CHOICES.map((c) => (
        <button key={c.kind} type="button" className={s.choice} disabled={!!busy} onClick={() => void choose(c.kind)}>
          {c.kind === 'local' ? <span className={s.localMark}><LaptopGlyph /></span> : <ProviderMark id={c.kind} size={36} />}
          <span className={s.choiceText}>
            <b>{c.kind === 'local' ? (accounts.some((a) => a.kind === 'local') ? 'Another library on this device' : 'On this device') : PROVIDER_NAME[c.kind]}{c.recommended && <span className={s.tag}>Recommended</span>}</b>
            <span>{busy === c.kind ? <>Finish signing in in the window that opened · <span role="button" tabIndex={0} className={s.link} onClick={(e) => { e.stopPropagation(); attempt.current++; setBusy(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); attempt.current++; setBusy(null) } }}>Cancel</span></> : c.line}</span>
          </span>
          {busy === c.kind ? <CircleNotch size={18} className={s.spin} /> : null}
        </button>
      ))}
      {error && <p className={s.error} role="alert">{error}</p>}
    </div>
  )
}

/** A local account's face and name: a DiceBear Cameo face (roll the dice for another) and a name. */
export type LocalDraft = { name: string; seed: string }
export function LocalAccountForm({ draft, onChange, placeholder }: { draft: LocalDraft; onChange: (d: LocalDraft) => void; placeholder: string }) {
  const [spin, setSpin] = useState(0)
  return (
    <div className={s.localForm}>
      <div className={s.face}>
        <img src={cameoAvatar(draft.seed)} alt="Your avatar" width={112} height={112} />
        <button type="button" className={s.dice} aria-label="Another avatar" title="Another avatar" data-spin={spin % 2 || undefined}
          onClick={() => { setSpin((n) => n + 1); onChange({ ...draft, seed: newSeed() }) }}><DiceFive size={20} weight="fill" /></button>
      </div>
      <TextField label="Name" value={draft.name} placeholder={placeholder} autoFocus onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      <p className={s.note}>A separate library kept only in this browser. Nothing in it is shared with your other accounts.</p>
    </div>
  )
}

function LaptopGlyph() {
  return <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden><path d="M232 168h-8V72a24 24 0 0 0-24-24H56a24 24 0 0 0-24 24v96h-8a8 8 0 0 0-8 8v16a24 24 0 0 0 24 24h176a24 24 0 0 0 24-24v-16a8 8 0 0 0-8-8ZM48 72a8 8 0 0 1 8-8h144a8 8 0 0 1 8 8v96H48Zm176 120a8 8 0 0 1-8 8H40a8 8 0 0 1-8-8v-8h192Z" /></svg>
}

export function AddAccountDialog({ onClose }: { onClose: () => void }) {
  const { accounts } = useAccounts()
  const placeholder = accounts.some((a) => a.kind === 'local') ? 'Work' : 'Personal'
  const [draft, setDraft] = useState<LocalDraft | null>(null)
  if (draft) {
    const create = () => void switchTo(addLocalAccount(draft.name || placeholder, draft.seed).id)
    return (
      <Modal title="New local account" width={420} onClose={onClose} actions={<>
        <Button variant="ghost" onClick={() => setDraft(null)}>Back</Button>
        <Button variant="primary" onClick={create}>Create</Button>
      </>}>
        <form onSubmit={(e) => { e.preventDefault(); create() }}><LocalAccountForm draft={draft} onChange={setDraft} placeholder={placeholder} /></form>
      </Modal>
    )
  }
  return (
    <Modal title="Add an account" width={480} onClose={onClose} actions={<Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <p className={s.note}>Each account is its own library. Switch between them any time.</p>
      <AccountChoices onAdded={(a) => void switchTo(a.id)} onLocal={() => setDraft({ name: '', seed: newSeed() })} />
    </Modal>
  )
}

/** Changing a local account's face or name. */
export function EditLocalAccount({ account, onClose }: { account: Account; onClose: () => void }) {
  const [draft, setDraft] = useState<LocalDraft>({ name: account.name, seed: account.avatarSeed ?? newSeed() })
  const save = () => { updateAccount(account.id, { name: draft.name.trim() || account.name, avatarSeed: draft.seed, avatar: cameoAvatar(draft.seed) }); onClose() }
  return (
    <Modal title="Edit account" width={420} onClose={onClose} actions={<>
      <Button variant="ghost" onClick={onClose}>Cancel</Button>
      <Button variant="primary" onClick={save}>Save</Button>
    </>}>
      <form onSubmit={(e) => { e.preventDefault(); save() }}><LocalAccountForm draft={draft} onChange={setDraft} placeholder={account.name} /></form>
    </Modal>
  )
}
