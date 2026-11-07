// The first time Ream opens (spec: accounts): where should your work live? A cloud choice signs in inside its click;
// on this device asks for a face and a name.
import { useState } from 'react'
import { switchTo } from '../data/accounts'
import { addLocalAccount } from '../data/accountActions'
import { newSeed } from '../lib/avatar'
import { BrandMark, PRODUCT } from '../ui/Brand'
import { Button } from '../ui/Button'
import { AccountChoices, LocalAccountForm, type LocalDraft } from './AccountSwitcher'
import s from './FirstRun.module.css'

export function FirstRun() {
  const [draft, setDraft] = useState<LocalDraft | null>(null)
  const create = () => { if (draft) void switchTo(addLocalAccount(draft.name || 'Personal', draft.seed).id) }
  return (
    <main className={s.screen}>
      <div className={s.card}>
        <BrandMark size={34} />
        {draft ? (
          <form className={s.local} onSubmit={(e) => { e.preventDefault(); create() }}>
            <h1 className={s.title}>Make it yours</h1>
            <LocalAccountForm draft={draft} onChange={setDraft} placeholder="Personal" />
            <div className={s.actions}>
              <Button variant="ghost" type="button" onClick={() => setDraft(null)}>Back</Button>
              <Button variant="primary" type="submit">Start</Button>
            </div>
          </form>
        ) : <>
          <h1 className={s.title}>Where should {PRODUCT} keep your work?</h1>
          <p className={s.lede}>Sign in with your own storage and your decks follow you to every device, or keep them in this browser. Add more accounts later and switch any time.</p>
          <AccountChoices onAdded={(a) => void switchTo(a.id)} onLocal={() => setDraft({ name: '', seed: newSeed() })} />
          <p className={s.fine}>{PRODUCT} runs entirely in your browser. It only sees its own folder in your storage, and nothing passes through a server of ours.</p>
        </>}
      </div>
    </main>
  )
}
