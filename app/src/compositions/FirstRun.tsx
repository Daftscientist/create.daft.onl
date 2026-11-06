// The first time Ream opens (spec: accounts): where should your work live? The only screen ever shown before your
// files. A cloud choice signs in inside its click; local asks only for a name.
import { switchTo } from '../data/accounts'
import { BrandMark, PRODUCT } from '../ui/Brand'
import { AccountChoices } from './AccountSwitcher'
import s from './FirstRun.module.css'

export function FirstRun() {
  return (
    <main className={s.screen}>
      <div className={s.card}>
        <BrandMark size={34} />
        <h1 className={s.title}>Where should {PRODUCT} keep your work?</h1>
        <p className={s.lede}>Sign in with your own storage and your decks follow you to every device, or keep them in this browser. Add more accounts later and switch any time.</p>
        <AccountChoices onAdded={(a) => switchTo(a.id)} />
        <p className={s.fine}>{PRODUCT} runs entirely in your browser. It only sees its own folder in your storage, and nothing passes through a server of ours.</p>
      </div>
    </main>
  )
}
