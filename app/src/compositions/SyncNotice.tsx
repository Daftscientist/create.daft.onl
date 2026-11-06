// First-load / in-flow sync prompt. Shown only when something is at stake (review round 1, blocker 1):
// changes waiting, or another device changed things since the last pull. Never modal.
import { CloudSlash, CloudWarning, Lock } from '@phosphor-icons/react'
import { dismissNotice, noticeReason, PROVIDERS, reconnect, useSync } from '../data/sync'
import { relTimeInline } from '../lib/format'
import { navigate } from '../lib/router'
import { Button } from '../ui/Button'
import { Notice } from '../ui/Notice'
import { openSyncFlow } from './SyncFlows'

export function SyncNotice() {
  const sync = useSync()
  const reason = noticeReason(sync)
  if (!reason || !sync.provider) return null
  const name = PROVIDERS[sync.provider].name
  const busy = sync.auth === 'reconnecting'
  if (reason.kind === 'locked') {
    return <Notice icon={<Lock size={16} />} title={`Your ${name} library is encrypted`} actions={<Button variant="secondary" onClick={() => openSyncFlow('unlock')}>Unlock</Button>}>Enter your passphrase to bring in decks from your other devices.</Notice>
  }
  if (reason.kind === 'full') {
    return <Notice tone="danger" icon={<CloudWarning size={16} />} title={`${name} is full`} actions={<Button variant="secondary" onClick={() => navigate({ name: 'settings', section: 'accounts' })}>Manage</Button>}>{sync.pending} changes are saved in this browser and will sync when there’s space.</Notice>
  }
  if (reason.kind === 'deleted') {
    return <Notice tone="danger" icon={<CloudWarning size={16} />} title={`Ream’s folder was deleted from ${name}`} actions={<Button variant="secondary" onClick={() => navigate({ name: 'settings', section: 'accounts' })}>Upload again</Button>}>Your library is still here in this browser.</Notice>
  }
  const title = reason.kind === 'waiting'
    ? `${name} sync is paused`
    : `Last synced with ${name} ${sync.lastSyncAt ? relTimeInline(sync.lastSyncAt) : 'a while ago'}`
  const body = reason.kind === 'waiting'
    ? `${sync.pending} ${sync.pending === 1 ? 'change is' : 'changes are'} saved in this browser. Reconnect to send ${sync.pending === 1 ? 'it' : 'them'} to your other devices.`
    : `Reconnect to bring in changes from ${sync.otherDevice?.name ?? 'your other devices'}.`
  return (
    <Notice
      icon={<CloudSlash size={16} />}
      title={title}
      onDismiss={dismissNotice}
      actions={<Button variant="secondary" disabled={busy} onClick={() => void reconnect()}>{busy ? 'Reconnecting…' : 'Reconnect'}</Button>}
    >
      {body}
    </Notice>
  )
}
