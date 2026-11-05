// Settings sections (docs/design/specs/settings.md). Both shells render these; they only frame them.
import {
  Cloud, Database, DownloadSimple, Info, Keyboard, Lock, Monitor, Moon, Palette, Sparkle, Sun, UploadSimple,
} from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { backUp, decks, isLive, useLibrary } from '../data/library'
import { setPrefs, useDevicePrefs } from '../data/prefs'
import {
  disconnect, PROVIDERS, reconnect, setDeviceName, setEncryption, setVisibleCopies, syncNow, useSync,
} from '../data/sync'
import { toast } from '../data/toasts'
import { bytes, count, relTimeInline } from '../lib/format'
import { modKey } from '../lib/shell'
import { persistStorage, storage } from '../storage/client'
import { PRODUCT } from '../ui/Brand'
import { Button } from '../ui/Button'
import { Confirm } from '../ui/Dialog'
import { SettingGroup, SettingRow, Switch, TextField } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import { useShell } from '../lib/shell'
import { ProviderMark } from './ProviderMark'
import { openSyncFlow } from './SyncFlows'
import { SyncStatus } from './SyncStatus'
import s from './settings.module.css'

export type SectionDef = { id: string; label: string; group: 'This device' | 'Library' | 'Ream'; icon: ReactNode; render: () => ReactNode; preview?: boolean }

export const SECTIONS: SectionDef[] = [
  { id: 'appearance', label: 'Appearance', group: 'This device', icon: <Palette size={18} />, render: () => <Appearance /> },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'This device', icon: <Keyboard size={18} />, render: () => <Shortcuts /> },
  { id: 'storage', label: 'Storage', group: 'Library', icon: <Database size={18} />, render: () => <Storage /> },
  { id: 'sync', label: 'Sync', group: 'Library', icon: <Cloud size={18} />, render: () => <Sync /> },
  { id: 'encryption', label: 'Encryption', group: 'Library', icon: <Lock size={18} />, render: () => <Encryption /> },
  { id: 'ai', label: 'AI', group: 'Library', icon: <Sparkle size={18} />, render: () => <AiPreview />, preview: true },
  { id: 'about', label: `About ${PRODUCT}`, group: 'Ream', icon: <Info size={18} />, render: () => <About /> },
]
export const visibleSections = () =>
  SECTIONS.filter((x) => !x.preview || new URLSearchParams(location.search).has('preview') || sessionStorage.getItem('ream.preview') === 'ai')

// ---------- This device ----------

function Appearance() {
  const prefs = useDevicePrefs()
  const lg = useShell() === 'mobile' ? 'lg' : 'md'
  return (
    <>
      <p className={s.scope}>These apply to this browser only.</p>
      <SettingGroup>
        <SettingRow label="Theme" description="Follow your device, or always use light or dark.">
          <Segmented size={lg} label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[
            { value: 'system', title: 'Match device', label: <span className={s.seg}><Monitor size={15} />System</span> },
            { value: 'light', title: 'Light', label: <span className={s.seg}><Sun size={15} />Light</span> },
            { value: 'dark', title: 'Dark', label: <span className={s.seg}><Moon size={15} />Dark</span> },
          ]} />
        </SettingRow>
        <SettingRow label="Motion" description="Reduce movement to simple fades. “System” follows your device’s accessibility setting.">
          <Segmented size={lg} label="Motion" value={prefs.motion} onChange={(motion) => setPrefs({ motion })} options={[
            { value: 'system', title: 'Follow device', label: 'System' },
            { value: 'reduce', title: 'Reduce motion', label: 'Reduced' },
          ]} />
        </SettingRow>
      </SettingGroup>
    </>
  )
}

const KEYS: [string, string][] = [
  [`${modKey}K`, 'Search decks, slides and actions'], ['↵', 'Open the focused deck or folder'], ['Space', 'Quick Look'],
  ['F2', 'Rename'], [`${modKey}D`, 'Duplicate'], ['S', 'Star or unstar'], [`${modKey}⌫`, 'Move to Trash'],
  [`${modKey}A`, 'Select all'], [`${modKey}Space`, 'Add or remove from selection'], ['⇧ + arrows', 'Extend the selection'],
  ['Esc', 'Clear selection, close, or go back'], [`${modKey},`, 'Open Settings'],
]
function Shortcuts() {
  return (
    <SettingGroup title="Library">
      {KEYS.map(([k, d]) => <SettingRow key={k} label={d}><kbd className={s.kbd}>{k}</kbd></SettingRow>)}
    </SettingGroup>
  )
}

// ---------- Library ----------

function useEstimate() {
  const [est, setEst] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null)
  const refresh = async () => {
    try {
      const e = await navigator.storage.estimate()
      setEst({ usage: e.usage ?? 0, quota: e.quota ?? 0, persisted: await navigator.storage.persisted() })
    } catch { setEst(null) }
  }
  useEffect(() => { void refresh() }, [])
  return [est, refresh] as const
}

function Storage() {
  const lib = useLibrary()
  const sync = useSync()
  const [est, refresh] = useEstimate()
  const [confirm, setConfirm] = useState(false)
  const n = decks(lib).filter(isLive).length
  const pct = est && est.quota ? Math.min(100, (est.usage / est.quota) * 100) : 0
  return (
    <>
      <SettingGroup title="This browser">
        <SettingRow label={`${count(n, 'deck')} · ${est ? bytes(est.usage) : '—'} used`} description={est ? `${bytes(est.quota)} available to ${PRODUCT} in this browser` : 'Storage size isn’t available in this browser'}>
          <span className={s.meter} aria-hidden><i style={{ width: `${Math.max(1.5, pct)}%` }} /></span>
        </SettingRow>
        <SettingRow
          label="Keep my library"
          description={est?.persisted ? 'This browser won’t clear your library to free up space.' : 'Without this, the browser may clear your library when the device is low on space.'}
        >
          {est?.persisted ? <span className={s.ok}>On</span> : <Button variant="secondary" onClick={async () => { const ok = await persistStorage(); await refresh(); toast({ message: ok ? 'Your library is kept in this browser' : 'The browser declined. Back up regularly or connect sync.' }) }}>Turn on</Button>}
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Backups">
        <SettingRow label="Back up now" description={lib.lastBackupAt ? `Last backup ${relTimeInline(lib.lastBackupAt)}. Saves every deck and folder to one file.` : 'Saves every deck and folder to one file.'}>
          <Button variant="secondary" icon={<UploadSimple size={15} />} onClick={backUp}>Back up</Button>
        </SettingRow>
        <SettingRow label="Restore from a backup" description="You’ll see what’s inside before anything changes. Nothing here is deleted.">
          <Button variant="secondary" onClick={() => toast({ message: 'Restoring arrives with the storage engine. Nothing was changed.' })}>Choose file…</Button>
        </SettingRow>
        <SettingRow label="Export every deck" description="A .zip of PowerPoint files, for use anywhere.">
          <Button variant="secondary" icon={<DownloadSimple size={15} />} onClick={() => toast({ message: `Exporting ${count(n, 'deck')} arrives with the engine.` })}>Export</Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="Danger zone" tone="danger">
        <SettingRow label="Remove data from this browser" description={sync.provider ? `Your ${PROVIDERS[sync.provider].name} copy is kept, and this browser is disconnected from it.` : 'Deletes your library from this browser. Back up first if you want to keep it.'}>
          <Button variant="secondary" onClick={() => setConfirm(true)}>Remove…</Button>
        </SettingRow>
      </SettingGroup>
      {confirm && (
        <Confirm
          title="Remove your library from this browser?"
          danger
          confirmLabel="Remove from this browser"
          onClose={() => setConfirm(false)}
          onConfirm={async () => { if (sync.provider) disconnect(); await storage.wipe(); location.href = '/' }}
          body={<>
            <p>This deletes <strong>{count(n, 'deck')}</strong> from this browser.{' '}
              {sync.pending ? <strong>{sync.pending} changes haven’t synced yet and will be lost.</strong> : null}</p>
            <p>{sync.provider ? `Your ${PROVIDERS[sync.provider].name} copy stays as it is.` : lib.lastBackupAt ? `Your last backup was ${relTimeInline(lib.lastBackupAt)}.` : 'You have no backup.'}{' '}
              <button type="button" className={s.link} onClick={() => void backUp()}>Back up first</button></p>
          </>}
        />
      )}
    </>
  )
}

function Sync() {
  const sync = useSync()
  if (!sync.provider) {
    return (
      <>
        <SettingGroup>
          <SettingRow label="Use your library on all your devices" description={`Connect your own cloud storage. Your decks go to a private folder in your account; ${PRODUCT} has no servers and never sees them.`}>
            <Button variant="primary" icon={<Cloud size={15} />} onClick={() => openSyncFlow('connect')}>Connect…</Button>
          </SettingRow>
        </SettingGroup>
        <SettingGroup title="How each provider behaves in a browser">
          {(['dropbox', 'onedrive', 'google'] as const).map((id) => (
            <SettingRow key={id} label={<><ProviderMark id={id} size={22} />{PROVIDERS[id].name}{PROVIDERS[id].recommended && <span className={s.badge}>Recommended</span>}</>} description={PROVIDERS[id].stays} />
          ))}
        </SettingGroup>
      </>
    )
  }
  const p = PROVIDERS[sync.provider]
  return (
    <>
      <SettingGroup>
        <div className={s.providerHead}>
          <ProviderMark id={sync.provider} size={40} />
          <div className={s.providerText}>
            <span className={s.providerName}>{p.name}</span>
            <span className={s.providerMeta}>{sync.account} · stored in {p.folder}</span>
          </div>
        </div>
        <div className={s.statusRow}><SyncStatus /></div>
        <SettingRow label="Sync now" description="Sync also runs a few seconds after each change and when you come back to this tab.">
          <Button variant="secondary" disabled={sync.auth !== 'ok' || !sync.online} onClick={() => void syncNow()}>Sync now</Button>
        </SettingRow>
        {(sync.auth === 'expired' || sync.auth === 'revoked') && (
          <SettingRow label="Sign in again" description={`${p.name} needs you to sign in again before it can sync.`}>
            <Button variant="primary" onClick={() => void reconnect()}>Reconnect</Button>
          </SettingRow>
        )}
        {sync.provider === 'google' && (
          <SettingRow label="Also keep PowerPoint copies in My Drive" description="A visible “Ream” folder with a .pptx of every deck. Asks Google for one more permission.">
            <Switch label="Keep PowerPoint copies in My Drive" checked={sync.visibleCopies} onChange={setVisibleCopies} />
          </SettingRow>
        )}
      </SettingGroup>
      <SettingGroup title="This device">
        <SettingRow label="Device name" description="Shown on your other devices, for example in conflict copies.">
          <TextField label="Device name" hideLabel className={s.nameField} value={sync.deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </SettingRow>
        <SettingRow label={`Disconnect ${p.name}`} description={`This browser keeps its library. Your ${p.name} copy is left as it is.`}>
          <Button variant="secondary" onClick={disconnect}>Disconnect</Button>
        </SettingRow>
      </SettingGroup>
    </>
  )
}

function Encryption() {
  const sync = useSync()
  const [off, setOff] = useState(false)
  return (
    <>
      <SettingGroup>
        <SettingRow
          label="End-to-end encryption"
          description={sync.provider
            ? 'Encrypt everything in this browser before it reaches your cloud, so your provider only stores unreadable data.'
            : 'Protects your cloud copy, so it needs sync. Connect a provider in Sync first.'}
        >
          <Switch label="End-to-end encryption" disabled={!sync.provider || !!sync.transfer} checked={sync.encrypted} onChange={(v) => (v ? openSyncFlow('encrypt') : setOff(true))} />
        </SettingRow>
        {sync.encrypted && (
          <SettingRow label="Change passphrase" description="Other devices will ask for the new one next time they open your library.">
            <Button variant="secondary" onClick={() => openSyncFlow('encrypt')}>Change…</Button>
          </SettingRow>
        )}
      </SettingGroup>
      {off && (
        <Confirm
          title="Turn off encryption?"
          confirmLabel="Turn off"
          onClose={() => setOff(false)}
          onConfirm={() => void setEncryption(false)}
          body={<p>Your cloud copy will be stored readable by your provider again. Your library itself doesn’t change.</p>}
        />
      )}
    </>
  )
}

function AiPreview() {
  return (
    <SettingGroup>
      <SettingRow label={<>Models <span className={s.badge}>Preview</span></>} description="AI co-editing is paused while we choose how to connect models without a server. See docs/architecture/AI.md." />
    </SettingGroup>
  )
}

function About() {
  return (
    <SettingGroup>
      <SettingRow label={PRODUCT} description="Version 0.1 · UI preview" />
      <SettingRow label="Your files stay with you" description={`Everything is stored in this browser. Nothing leaves this device unless you connect your own cloud storage.`} />
      <SettingRow label="Open source" description="Read the code, report issues and build it yourself.">
        <Button variant="secondary" onClick={() => window.open('https://github.com/Daftscientist/create.daft.onl', '_blank', 'noopener')}>GitHub</Button>
      </SettingRow>
    </SettingGroup>
  )
}
