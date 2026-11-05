// The one sync status line (settings spec, review round 1). The line itself always opens Settings → Sync;
// the action (Reconnect / Review / Unlock) is a separate control, so a click never does two different things.
import { CloudArrowUp, CloudCheck, CloudSlash, CloudWarning, HardDrives, Lock } from '@phosphor-icons/react'
import { noticeReason, reconnect, summary, useSync, type Summary } from '../data/sync'
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

/** Sidebar footer / mobile Files card: two quiet lines, no stacked buttons. The action is an inline text
 *  link on the detail line; the rest of the block opens Settings. */
export function SyncStatus({ sub, noticeShown = false }: { sub?: string; noticeShown?: boolean }) {
  const { sync, sum } = useSyncSummary()
  const detail = sum.detail ?? sub
  // While the in-page notice offers the action, the footer only states the situation (no second button).
  const action = noticeShown && noticeReason(sync) ? undefined : sum.action
  return (
    <div className={s.status} data-tone={sum.tone}>
      <span className={s.icon} aria-hidden>{sync.locked ? <Lock size={16} /> : sync.provider ? ICON[sum.tone] : <HardDrives size={16} />}</span>
      <div className={s.body}>
        <button type="button" className={s.line} onClick={() => navigate({ name: 'settings', section: sync.provider ? 'sync' : 'storage' })}>{sum.title}</button>
        {(detail || action) && (
          <span className={s.sub}>
            {detail}
            {action && <>{detail && ' · '}<button type="button" className={s.link} onClick={() => runSyncAction(action)} disabled={sync.auth === 'reconnecting'}>{ACTION_LABEL[action]}</button></>}
          </span>
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
      <span className={s.sep} aria-hidden>·</span>
      <CloudSlash size={13} aria-hidden />
      <span>{sum.title}</span>
      {sum.action && <button type="button" className={s.inlineAction} onClick={() => runSyncAction(sum.action!)}>{ACTION_LABEL[sum.action]}</button>}
    </span>
  )
}
