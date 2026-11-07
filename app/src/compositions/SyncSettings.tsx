// Settings → Storage, for a cloud account: how its library is kept in that storage (encryption, visible PowerPoint
// copies) and this device's name. Signing in, adding and unlinking accounts live in the account switcher.
import { useState } from 'react'
import { activeAccount, PROVIDER_NAME } from '../data/accounts'
import { setDeviceName, setEncryption, setVisibleCopies, useSync } from '../data/sync'
import { relTimeInline } from '../lib/format'
import { Confirm } from '../ui/Dialog'
import { SettingGroup, SettingRow, Switch, TextField } from '../ui/Field'
import { openSyncFlow } from './SyncFlows'
import s from './settings.module.css'

export function SyncSettingsGroup() {
  const me = activeAccount()
  const sync = useSync()
  const [off, setOff] = useState(false)
  if (!me || me.kind === 'local') return null
  const where = PROVIDER_NAME[me.kind]
  return (
    <>
      <SettingGroup title={`Kept in ${where}`}>
        <SettingRow label="Up to date" description={sync.lastSyncAt ? `Checked ${relTimeInline(sync.lastSyncAt)}. Changes go to ${where} a few seconds after you make them, and changes from your other devices come in on their own.` : `Changes go to ${where} a few seconds after you make them.`} />
        <SettingRow label="End-to-end encryption" description={`Encrypt everything in this browser before it reaches ${where}, so it only stores unreadable data.`}>
          <Switch label="End-to-end encryption" disabled={!!sync.transfer} checked={sync.encrypted} onChange={(v) => (v ? openSyncFlow('encrypt') : setOff(true))} />
        </SettingRow>
        {me.kind === 'google' && (
          <SettingRow label="Also keep PowerPoint copies in My Drive" description="A visible “Ream” folder with a .pptx of every deck. Asks Google for one more permission.">
            <Switch label="Keep PowerPoint copies in My Drive" checked={sync.visibleCopies} onChange={setVisibleCopies} />
          </SettingRow>
        )}
        <SettingRow label="This device’s name" description="Shown on your other devices, for example on a copy kept when a deck changed in two places.">
          <TextField label="Device name" hideLabel className={s.nameField} value={sync.deviceName} onChange={(e) => setDeviceName(e.target.value)} />
        </SettingRow>
      </SettingGroup>
      {off && (
        <Confirm title="Turn off encryption?" confirmLabel="Turn off" onClose={() => setOff(false)} onConfirm={() => void setEncryption(false)}
          body={<p>Your copy in {where} will be stored readable again. Your library itself doesn’t change.</p>} />
      )}
    </>
  )
}
