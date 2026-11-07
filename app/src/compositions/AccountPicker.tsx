// "Choose an account" on launch (spec: accounts): when this browser has more than one account and Ream hasn't been
// used for a while, pick which to open before anything loads. Signed-out cloud accounts sign in inside the click.
import { CircleNotch, Plus, SignIn } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { driveFor } from '../cloud'
import { accountSub, activeAccount, switchTo, useAccounts, type Account } from '../data/accounts'
import { accountHealth, signInAgain, type Health } from '../data/accountActions'
import { BrandMark } from '../ui/Brand'
import { AccountAvatar } from './AccountAvatar'
import { AddAccountDialog } from './AccountSwitcher'
import s from './AccountPicker.module.css'

const SEEN = 'ream.lastSeen', AWAY = 8 * 3600_000
/** Whether to ask which account to open: several accounts, away for a while, and this tab hasn't chosen yet. */
export function shouldPick(): boolean {
  try {
    if (new URLSearchParams(location.search).has('account') || sessionStorage.getItem('ream.tab.picked')) return false
    const last = Number(localStorage.getItem(SEEN) ?? 0)
    return accountsCount() > 1 && Date.now() - last > AWAY
  } catch { return false }
}
const accountsCount = () => { try { return (JSON.parse(localStorage.getItem('ream.accounts.v1') ?? '{}').accounts ?? []).length as number } catch { return 0 } }
/** Marks Ream as in use (called while the app is open). */
export function noteSeen() {
  const mark = () => { try { localStorage.setItem(SEEN, String(Date.now())) } catch { /* ok */ } }
  mark()
  setInterval(() => { if (document.visibilityState === 'visible') mark() }, 60_000)
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') mark() })
}
const picked = () => { try { sessionStorage.setItem('ream.tab.picked', '1') } catch { /* ok */ } }

export function AccountPicker({ onContinue }: { onContinue: () => void }) {
  const { accounts } = useAccounts()
  const current = activeAccount()
  const [health, setHealth] = useState<Record<string, Health | 'checking'>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<{ id: string; text: string } | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    for (const a of accounts) {
      if (a.kind === 'local') continue
      driveFor(a).prepare()
      setHealth((h) => ({ ...h, [a.id]: 'checking' }))
      void accountHealth(a).then((v) => setHealth((h) => ({ ...h, [a.id]: v })))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (a: Account) => {
    setError(null)
    setBusy(a.id)
    try {
      if (health[a.id] === 'signin') await signInAgain(a)
      picked()
      if (a.id === current?.id) onContinue()
      else await switchTo(a.id)
    } catch (e) {
      setBusy(null)
      const err = e as Error
      setError({ id: a.id, text: err.name === 'SignInCancelled' ? 'Sign-in was cancelled.' : err.name === 'PopupBlocked' ? 'Your browser blocked the sign-in window. Allow pop-ups for this site.' : err.message })
    }
  }

  return (
    <main className={s.screen}>
      <div className={s.card}>
        <BrandMark size={30} />
        <h1 className={s.title}>Choose an account</h1>
        <p className={s.lede}>Each one is its own library, with its own settings.</p>
        <ul className={s.list}>
          {accounts.map((a) => {
            const h = health[a.id]
            return (
              <li key={a.id}>
                <button type="button" className={s.row} onClick={() => void open(a)} disabled={!!busy}>
                  <AccountAvatar account={a} size={44} warn={h === 'signin'} />
                  <span className={s.text}>
                    <b>{a.name}</b>
                    <span>{accountSub(a)}</span>
                    {h === 'signin' && <span className={s.signin}>Signed out · sign in to open</span>}
                    {error?.id === a.id && <span className={s.error}>{error.text}</span>}
                  </span>
                  {busy === a.id ? <CircleNotch size={18} className={s.spin} /> : h === 'signin' ? <SignIn size={18} className={s.icon} /> : a.id === current?.id ? <span className={s.last}>Last used</span> : null}
                </button>
                {error?.id === a.id && <button type="button" className={s.offline} onClick={() => { picked(); if (a.id === current?.id) onContinue(); else void switchTo(a.id) }}>Open without signing in</button>}
              </li>
            )
          })}
          <li>
            <button type="button" className={s.row} onClick={() => setAdding(true)}>
              <span className={s.add}><Plus size={20} /></span>
              <span className={s.text}><b>Use another account</b><span>Dropbox, Google Drive, OneDrive, or a new local library</span></span>
            </button>
          </li>
        </ul>
      </div>
      {adding && <AddAccountDialog onClose={() => setAdding(false)} />}
    </main>
  )
}
