// The one sync status line (settings spec, review round 1). The line itself always opens Settings → Sync;
// the action (Reconnect / Review / Unlock) is a separate control, so a click never does two different things.
import { CloudArrowUp, CloudCheck, CloudSlash, CloudWarning, HardDrives, Lock } from '@phosphor-icons/react'
import { reconnect, summary, useSync, type Summary } from '../data/sync'
import { navigate } from '../lib/router'
import { openSyncFlow } from './SyncFlows'
import s from './SyncStatus.module.css'

const ICON: Record<Summary['tone'], React.ReactNode> = {
  ok: <CloudCheck size={16} />,
  busy: <CloudArrowUp size={16} />,
  warn: <CloudSlash size={16} />,
  danger: <CloudWarning size={16} />,
  muted: <HardDrives size={16} />,
}
const ACTION_LABEL = { reconnect: 'Reconnect', review: 'Review', unlock: 'Unlock', 'open-provider': 'Manage' } as const

export function useSyncSummary() {
  const sync = useSync()
  return { sync, sum: summary(sync) }
}

export function runSyncAction(a: NonNullable<Summary['action']>) {
  if (a === 'reconnect') void reconnect()
  else if (a === 'unlock') openSyncFlow('unlock')
  else if (a === 'review') navigate({ name: 'files', folderId: null })
  else navigate({ name: 'settings', section: 'sync' })
}

/** Sidebar footer / mobile Files card. Two lines that wrap rather than truncate; the action gets its own row. */
export function SyncStatus({ sub, showAccount = true }: { sub?: string; showAccount?: boolean }) {
  const { sync, sum } = useSyncSummary()
  const detail = sync.provider ? (showAccount ? sync.account ?? undefined : undefined) : sub
  return (
    <div className={s.status} data-tone={sum.tone}>
      <span className={s.icon} aria-hidden>{sync.locked ? <Lock size={16} /> : sync.provider ? ICON[sum.tone] : <HardDrives size={16} />}</span>
      <div className={s.body}>
        <button type="button" className={s.text} onClick={() => navigate({ name: 'settings', section: sync.provider ? 'sync' : 'storage' })}>
          <span className={s.line}>{sum.text}</span>
          {detail && <span className={s.sub}>{detail}</span>}
        </button>
        {sum.action && (
          <button type="button" className={s.action} onClick={() => runSyncAction(sum.action!)} disabled={sync.auth === 'reconnecting'}>
            {ACTION_LABEL[sum.action]}
          </button>
        )}
      </div>
    </div>
  )
}

/** Compact, for the deck header: only speaks up when changes are not leaving this device. */
export function SyncInline() {
  const { sync, sum } = useSyncSummary()
  if (!sync.provider || (sum.tone !== 'warn' && sum.tone !== 'danger' && sync.online)) return null
  return (
    <span className={s.inline} data-tone={sum.tone}>
      <CloudSlash size={13} aria-hidden />
      <span>{sync.online ? 'Not synced' : 'Offline'}</span>
      {sum.action && <button type="button" className={s.inlineAction} onClick={() => runSyncAction(sum.action!)}>{ACTION_LABEL[sum.action]}</button>}
    </span>
  )
}
