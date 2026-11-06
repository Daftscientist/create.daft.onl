// Settings sections (docs/design/specs/settings.md). Both shells render these; they only frame them.
import {
  Archive, Cloud, Database, DownloadSimple, Info, Keyboard, Palette, Sparkle,
  ChartBar, Cube, Waveform,
} from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { backUp, decks, isLive, useLibrary } from '../data/library'
import { setPrefs, useDevicePrefs } from '../data/prefs'
import {
  disconnect, PROVIDERS, setDeviceName, setEncryption, setVisibleCopies, syncNow, useSync,
} from '../data/sync'
import { toast } from '../data/toasts'
import { bytes, count, relTimeInline } from '../lib/format'
import { KEYMAP } from '../lib/keymap'
import { useBrowserModel } from '../data/ai/browser'
import { providerName, type ModelProvider } from '../data/ai/settings'
import { clearUsage, usageByDay, usageSince, useUsageVersion } from '../data/ai/usage'
import { AiMark } from './AiMark'
import { persistStorage, storage } from '../storage/client'
import { PRODUCT } from '../ui/Brand'
import { Button, Keys } from '../ui/Button'
import { Confirm } from '../ui/Dialog'
import { SettingGroup, SettingRow, Switch, TextField } from '../ui/Field'
import { Segmented } from '../ui/Segmented'
import { useShell } from '../lib/shell'
import { VoiceAgentsSettings } from './VoiceAgents'
import { AiModels, AiProviders } from './AiSettings'
import { ProviderMark } from './ProviderMark'
import { openSyncFlow, prepareProviders, startConnect } from './SyncFlows'
import { runSyncAction, useSyncSummary } from './SyncStatus'
import s from './settings.module.css'

export type SectionDef = { id: string; label: string; group: 'This browser' | 'Library' | 'AI' | 'Ream'; icon: ReactNode; render: () => ReactNode; preview?: boolean; keyboardOnly?: boolean }

export const SECTIONS: SectionDef[] = [
  { id: 'appearance', label: 'Appearance', group: 'This browser', icon: <Palette size={18} />, render: () => <Appearance /> },
  { id: 'shortcuts', label: 'Keyboard shortcuts', group: 'This browser', icon: <Keyboard size={18} />, render: () => <Shortcuts />, keyboardOnly: true },
  { id: 'storage', label: 'Storage', group: 'Library', icon: <Database size={18} />, render: () => <Storage /> },
  { id: 'sync', label: 'Sync', group: 'Library', icon: <Cloud size={18} />, render: () => <Sync /> },
  { id: 'ai', label: 'Providers', group: 'AI', icon: <Sparkle size={18} />, render: () => <AiProviders /> },
  { id: 'models', label: 'Models', group: 'AI', icon: <Cube size={18} />, render: () => <AiModels /> },
  { id: 'voice', label: 'Voice', group: 'AI', icon: <Waveform size={18} />, render: () => <VoiceAgentsSettings /> },
  { id: 'usage', label: 'Usage', group: 'AI', icon: <ChartBar size={18} />, render: () => <Usage /> },
  { id: 'about', label: `About ${PRODUCT}`, group: 'Ream', icon: <Info size={18} />, render: () => <About /> },
]
/** Shortcuts only where there is a keyboard (review: it was dead UI on phones). */
export const visibleSections = () => SECTIONS.filter((x) => !x.keyboardOnly || matchMedia('(any-pointer: fine)').matches)

// ---------- This device ----------

function Appearance() {
  const prefs = useDevicePrefs()
  const lg = useShell() === 'mobile' ? 'lg' : 'md'
  return (
    <>
      <SettingGroup>
        <SettingRow label="Theme" description="Follow your device, or always use light or dark.">
          <Segmented size={lg} label="Theme" value={prefs.theme} onChange={(theme) => setPrefs({ theme })} options={[
            { value: 'system', title: 'Match device', label: 'System' },
            { value: 'light', title: 'Light', label: 'Light' },
            { value: 'dark', title: 'Dark', label: 'Dark' },
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

function Shortcuts() {
  return (
    <>
      {KEYMAP.map((g) => (
        <SettingGroup key={g.title} title={g.title} dense>
          {g.items.map((it) => (
            <SettingRow key={it.label} label={it.label}>
              <span className={s.alts}>
                {it.keys.map((k, i) => <span key={i} className={s.alt}>{i > 0 && it.keys.length === 2 && <span className={s.or}>or</span>}<Keys keys={k} /></span>)}
              </span>
            </SettingRow>
          ))}
        </SettingGroup>
      ))}
    </>
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
          {pct >= 1 && <span className={s.meter} role="img" aria-label={`${Math.round(pct)}% of available space used`}><i style={{ width: `${pct}%` }} /></span>}
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
          <Button variant="secondary" icon={<Archive size={15} />} onClick={backUp}>Back up</Button>
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

const ORDER = ['dropbox', 'onedrive', 'google'] as const

function Sync() {
  const sync = useSync()
  useEffect(() => { prepareProviders() }, [])
  const [off, setOff] = useState(false)
  const { sum } = useSyncSummary()
  if (!sync.provider) {
    return (
      <>
        <p className={s.lede}>Use your library on all your devices. Your decks go to a private folder in your own cloud account; {PRODUCT} has no servers and never sees them.</p>
        <SettingGroup title="Connect a cloud">
          {ORDER.map((id) => (
            <SettingRow key={id} label={<><ProviderMark id={id} size={22} />{PROVIDERS[id].name}{PROVIDERS[id].recommended && <span className={s.badge}>Recommended</span>}</>} description={PROVIDERS[id].stays}>
              <Button variant={PROVIDERS[id].recommended ? 'primary' : 'secondary'} onClick={() => startConnect(id)}>Connect</Button>
            </SettingRow>
          ))}
        </SettingGroup>
      </>
    )
  }
  const p = PROVIDERS[sync.provider]
  const paused = sync.auth === 'expired' || sync.auth === 'revoked'
  return (
    <>
      <SettingGroup title={p.name}>
        <div className={s.providerHead}>
          {sync.avatar ? <img className={s.avatar} src={sync.avatar} alt="" referrerPolicy="no-referrer" /> : <ProviderMark id={sync.provider} size={36} />}
          <div className={s.providerText}>
            <span className={s.providerName}>{sync.accountName ?? sync.account}</span>
            {sync.accountName && <span className={s.providerMeta}>{sync.account}</span>}
            <span className={s.providerMeta}>Stored in {p.folder}</span>
          </div>
        </div>
        <SettingRow
          label={sum.title}
          description={paused ? `${p.name} needs you to sign in again. Your changes are saved in this browser until then.` : sync.lastSyncAt ? `Last synced ${relTimeInline(sync.lastSyncAt)}. Sync also runs after each change.` : 'Sync runs a few seconds after each change.'}
        >
          {sum.action ? <Button variant="primary" onClick={() => runSyncAction(sum.action!)} disabled={sync.auth === 'reconnecting'}>{sum.action === 'reconnect' ? 'Reconnect' : sum.action === 'unlock' ? 'Unlock' : 'Review'}</Button>
            : <Button variant="secondary" disabled={!sync.online || !!sync.transfer} onClick={() => void syncNow()}>Sync now</Button>}
        </SettingRow>
        <SettingRow label="End-to-end encryption" description="Encrypt everything in this browser before it reaches your cloud, so your provider only stores unreadable data.">
          <Switch label="End-to-end encryption" disabled={!!sync.transfer} checked={sync.encrypted} onChange={(v) => (v ? openSyncFlow('encrypt') : setOff(true))} />
        </SettingRow>
        {sync.provider === 'google' && (
          <SettingRow label="Also keep PowerPoint copies in My Drive" description="A visible “Ream” folder with a .pptx of every deck. Asks Google for one more permission.">
            <Switch label="Keep PowerPoint copies in My Drive" checked={sync.visibleCopies} onChange={setVisibleCopies} />
          </SettingRow>
        )}
        <SettingRow label={`Disconnect ${p.name}`} description={`This browser keeps its library. Your ${p.name} copy is left as it is.`}>
          <Button variant="secondary" onClick={disconnect}>Disconnect</Button>
        </SettingRow>
      </SettingGroup>
      <SettingGroup title="This browser">
        <SettingRow label="Device name" description="Shown on your other devices, for example in conflict copies.">
          <TextField label="Device name" hideLabel className={s.nameField} value={sync.deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </SettingRow>
      </SettingGroup>
      {off && (
        <Confirm title="Turn off encryption?" confirmLabel="Turn off" onClose={() => setOff(false)} onConfirm={() => void setEncryption(false)}
          body={<p>Your cloud copy will be stored readable by {p.name} again. Your library itself doesn’t change.</p>} />
      )}
    </>
  )
}

// ---------- AI usage ----------

const n = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1e4 ? `${Math.round(x / 1e3)}k` : x.toLocaleString())
/** Settings → AI → Usage: totals as tiles, a bar for each day, then providers and models as bars by tokens. */
function Usage() {
  useUsageVersion()
  const browser = useBrowserModel()
  const [period, setPeriod] = useState<'7' | '30' | 'all'>('30')
  const rows = usageSince(period === 'all' ? null : Number(period))
  const days = usageByDay(period === '7' ? 7 : 30)
  const tok = (c: { input: number; output: number }) => c.input + c.output
  const total = rows.reduce((a, r) => ({ requests: a.requests + r.count.requests, input: a.input + r.count.input, output: a.output + r.count.output, pictures: a.pictures + r.count.pictures }), { requests: 0, input: 0, output: 0, pictures: 0 })
  const providers = [...new Set(rows.map((r) => r.provider))].map((p) => ({ p, list: rows.filter((r) => r.provider === p).sort((a, b) => tok(b.count) - tok(a.count)) }))
    .map((x) => ({ ...x, tokens: x.list.reduce((a, r) => a + tok(r.count), 0), requests: x.list.reduce((a, r) => a + r.count.requests, 0) })).sort((a, b) => b.tokens - a.tokens)
  const maxDay = Math.max(1, ...days.map((d) => tok(d.count)))
  const maxModel = Math.max(1, ...rows.map((r) => tok(r.count)))
  const [hover, setHover] = useState<number | null>(null)
  const shownDay = hover !== null ? days[hover] : null
  return (
    <>
      <p className={s.lede}>What {PRODUCT} sent to AI providers from this browser. Your provider’s dashboard has the exact bill.</p>
      <div className={s.usageBar}>
        <Segmented label="Period" value={period} onChange={setPeriod} options={[{ value: '7', label: '7 days', title: 'The last 7 days' }, { value: '30', label: '30 days', title: 'The last 30 days' }, { value: 'all', label: 'All time', title: 'Everything recorded in this browser' }]} />
      </div>
      <div className={s.tiles}>
        <div className={s.tile}><span>Tokens</span><b>{n(total.input + total.output)}</b><small>{n(total.input)} in · {n(total.output)} out</small></div>
        <div className={s.tile}><span>Requests</span><b>{n(total.requests)}</b><small>{providers.length ? `${providers.length} ${providers.length === 1 ? 'provider' : 'providers'}` : 'None yet'}</small></div>
        <div className={s.tile}><span>Pictures</span><b>{n(total.pictures)}</b><small>generated</small></div>
      </div>
      <section className={s.chartCard} aria-label="Tokens per day">
        <div className={s.chartHead}><b>Tokens per day</b><span>{shownDay ? `${new Date(shownDay.day).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${n(tok(shownDay.count))} tokens · ${n(shownDay.count.requests)} requests` : period === 'all' ? 'Last 30 days' : `Last ${period} days`}</span></div>
        <div className={s.chart} onPointerLeave={() => setHover(null)}>
          {days.map((d, i) => {
            const v = tok(d.count)
            return (
              <button key={d.day} type="button" className={s.dayCol} data-on={hover === i || undefined} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                aria-label={`${d.day}: ${v} tokens, ${d.count.requests} requests`}>
                <i style={{ height: v ? `${Math.max(3, (v / maxDay) * 100)}%` : 0 }} />
              </button>
            )
          })}
        </div>
        <div className={s.axis}><span>{new Date(days[0].day).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span><span>Today</span></div>
      </section>
      {!rows.length && <p className={s.empty}>Nothing used in this period yet. Ask, pictures and voice show up here.</p>}
      {providers.map(({ p, list, tokens, requests }) => (
        <section key={p} className={s.provCard}>
          <div className={s.provHead}><AiMark id={p as ModelProvider} size={20} /><b>{providerName(p as ModelProvider, browser)}</b><span>{n(tokens)} tokens · {n(requests)} requests</span></div>
          <ul className={s.modelBars}>
            {list.map((r) => (
              <li key={r.model}>
                <div className={s.modelLine}><span className={s.modelId}>{r.model}</span><span className={s.modelVal}>{r.count.pictures ? `${n(r.count.pictures)} pictures` : `${n(tok(r.count))} tokens`}</span></div>
                <div className={s.track}><i style={{ width: `${Math.max(2, (tok(r.count) / maxModel) * 100)}%` }} /></div>
                <div className={s.modelMeta}>{n(r.count.requests)} requests · {n(r.count.input)} in · {n(r.count.output)} out{r.count.reasoning ? ` (${n(r.count.reasoning)} thinking)` : ''}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {rows.length > 0 && <Button variant="ghost" onClick={clearUsage}>Clear these counts</Button>}
    </>
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
