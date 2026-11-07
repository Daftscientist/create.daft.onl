// An account's face (spec: accounts): the provider's profile photo, or a monogram on a soft gradient from the
// account's hue (local accounts, and any photo that fails to load). A small badge says where it lives.
import { Laptop } from '@phosphor-icons/react'
import { useState } from 'react'
import type { Account } from '../data/accounts'
import { ProviderMark } from './ProviderMark'
import { cameoAvatar } from '../lib/avatar'
import s from './AccountAvatar.module.css'

export function AccountAvatar({ account, size = 28, badge = true, warn = false }: { account: Account; size?: number; badge?: boolean; warn?: boolean }) {
  const [broken, setBroken] = useState(false)
  const letter = (account.name.trim()[0] ?? '?').toUpperCase()
  const b = Math.max(12, Math.round(size * 0.46))
  return (
    <span className={s.wrap} style={{ width: size, height: size }} aria-hidden>
      {account.kind === 'local'
        // Local accounts: a generated face on a soft tint (accounts from before faces get one from their id).
        ? <span className={s.art} style={{ '--h': account.hue } as React.CSSProperties}><img src={account.avatar ?? cameoAvatar(account.avatarSeed ?? account.id)} alt="" /></span>
        : account.avatar && !broken
        ? <img className={s.photo} src={account.avatar} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <span className={s.mono} style={{ '--h': account.hue, fontSize: Math.round(size * 0.44) } as React.CSSProperties}>{letter}</span>}
      {badge && (
        <span className={s.badge} style={{ width: b, height: b }}>
          {account.kind === 'local' ? <Laptop size={b - 4} weight="bold" /> : <ProviderMark id={account.kind} size={b} />}
        </span>
      )}
      {warn && <span className={s.warn} />}
    </span>
  )
}
