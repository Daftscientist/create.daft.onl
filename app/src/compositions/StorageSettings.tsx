// Settings → Storage (spec: accounts). Shaped by where the open account keeps its work: a cloud account shows its
// storage (provider, space used, what's on this device and what's only in the cloud); a local account shows this
// browser's space and whether it's protected from clearing. Both: what's in the library, backups.
import { Archive, CloudCheck, DownloadSimple, FolderSimple, HardDrives, Presentation, ShieldCheck, ArrowsLeftRight } from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { driveFor } from '../cloud'
import { activeAccount, PROVIDER_NAME } from '../data/accounts'
import { backUp, decks, folders, isLive, useLibrary } from '../data/library'
import { useSync } from '../data/sync'
import { toast } from '../data/toasts'
import { bytes, count, relTimeInline } from '../lib/format'
import { persistStorage } from '../storage/client'
import { Button } from '../ui/Button'
import { SettingGroup, SettingRow } from '../ui/Field'
import { AccountAvatar } from './AccountAvatar'
import { ProviderMark } from './ProviderMark'
import { SyncSettingsGroup } from './SyncSettings'
import s from './StorageSettings.module.css'

function useEstimate() {
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const refresh = async () => {
    try { const e = await navigator.storage.estimate(); setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: await navigator.storage.persisted() }) } catch { setEst(null) }
  }
  useEffect(() => { void refresh() }, [])
  return [est, refresh] as const
}

function Meter({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total ? Math.min(100, (used / total) * 100) : 0
  return (
    <div className={s.meterBlock}>
      <div className={s.meterHead}><b>{bytes(used)}</b><span>of {bytes(total)} used</span></div>
      <span className={s.meter} role="img" aria-label={`${label}: ${Math.round(pct)}% used`}><i style={{ width: `${Math.max(pct, 0.8)}%` }} data-high={pct > 85 || undefined} /></span>
    </div>
  )
}

function Tile({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: string }) {
  return (
    <div className={s.tile}>
      <span className={s.tileIcon} aria-hidden>{icon}</span>
      <span className={s.tileLabel}>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  )
}

export function StorageSettings() {
  const me = activeAccount()!
  const lib = useLibrary()
  const sync = useSync()
  const [est, refresh] = useEstimate()
  const [quota, setQuota] = useState<{ used: number; total: number } | null | 'loading'>(me.kind === 'local' ? null : 'loading')
  useEffect(() => { if (me.kind !== 'local') void driveFor(me).quota().then(setQuota).catch(() => setQuota(null)) }, [me.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const all = decks(lib).filter(isLive)
  const remoteOnly = all.filter((d) => d.remote).length
  const slides = all.reduce((n, d) => n + d.slides.length, 0)
  const nFolders = folders(lib).filter(isLive).length
  const cloud = me.kind !== 'local'
  const where = PROVIDER_NAME[me.kind]

  return (
    <>
      <section className={s.hero} data-kind={me.kind}>
        <div className={s.flow} aria-hidden>
          <span className={s.node}><span className={s.nodeIcon}><HardDrives size={22} /></span><small>{cloud ? 'This device' : 'This browser'}</small></span>
          {cloud && <>
            <span className={s.link}><ArrowsLeftRight size={16} /></span>
            <span className={s.node}><span className={s.nodeIcon}><ProviderMark id={me.kind as 'dropbox'} size={30} /></span><small>{where}</small></span>
          </>}
          <span className={s.who}><AccountAvatar account={me} size={28} badge={false} /></span>
        </div>
        <div className={s.heroText}>
          <h2>{cloud ? `Stored in ${where}` : 'Stored in this browser'}</h2>
          <p>{cloud
            ? `${me.email ?? me.name}. Your decks live in ${me.kind === 'google' ? 'a private Ream folder in your Drive' : `${where} › Apps › Ream`}; this device keeps a copy so everything opens instantly and works offline.`
            : `${me.name}. Everything stays on this device and nothing leaves it. Back up now and then, or add a cloud account to keep work on every device.`}</p>
        </div>
        <div className={s.heroMeter}>
          {cloud
            ? quota === 'loading' ? <div className={s.meterBlock}><div className={s.meterHead}><span>Checking {where}…</span></div><span className={s.meter} /></div>
              : quota ? <Meter used={quota.used} total={quota.total} label={`${where} storage`} />
              : <div className={s.meterHead}><span className={s.okLine}><CloudCheck size={16} weight="fill" />{sync.lastSyncAt ? `Up to date · checked ${relTimeInline(sync.lastSyncAt)}` : 'Connected'}</span></div>
            : est ? <Meter used={est.usage} total={est.quota} label="This browser’s storage" /> : <div className={s.meterHead}><span>This browser doesn’t say how much space it has.</span></div>}
        </div>
      </section>

      <div className={s.tiles}>
        <Tile icon={<Presentation size={18} />} label="Decks" value={all.length} sub={count(slides, 'slide')} />
        <Tile icon={<FolderSimple size={18} />} label="Folders" value={nFolders} />
        {cloud
          ? <Tile icon={<HardDrives size={18} />} label="On this device" value={all.length - remoteOnly} sub={remoteOnly ? `${remoteOnly} still in ${where} only` : 'Every deck works offline'} />
          : <Tile icon={<ShieldCheck size={18} />} label="Protected" value={est?.persisted ? 'Yes' : 'No'} sub={est?.persisted ? 'The browser won’t clear it' : 'May be cleared when space is low'} />}
        <Tile icon={<Archive size={18} />} label="Last backup" value={lib.lastBackupAt ? relTimeInline(lib.lastBackupAt) : 'Never'} />
      </div>

      {!cloud && !est?.persisted && (
        <SettingGroup>
          <SettingRow label="Keep my library" description="Without this, the browser may clear your library when the device is low on space.">
            <Button variant="primary" onClick={async () => { const ok = await persistStorage(); await refresh(); toast({ message: ok ? 'Your library is kept in this browser' : 'The browser declined. Back up regularly, or add a cloud account.' }) }}>Turn on</Button>
          </SettingRow>
        </SettingGroup>
      )}

      <SyncSettingsGroup />

      <SettingGroup title="Backups and export">
        <SettingRow label="Back up now" description={lib.lastBackupAt ? `Last backup ${relTimeInline(lib.lastBackupAt)}. One file with every deck and folder.` : 'One file with every deck and folder, saved to your downloads.'}>
          <Button variant="secondary" icon={<Archive size={15} />} onClick={backUp}>Back up</Button>
        </SettingRow>
        <SettingRow label="Export every deck" description="A .zip of PowerPoint files, for use anywhere.">
          <Button variant="secondary" icon={<DownloadSimple size={15} />} onClick={() => toast({ message: `Exporting ${count(all.length, 'deck')} at once isn’t ready yet. Download decks one at a time from their menu.` })}>Export</Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}
