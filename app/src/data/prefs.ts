// Appearance (Settings → Appearance: theme, motion). Per account, like every setting: kept with the account's
// library (so a cloud account brings its look to every device) and cached here so the first frame has the right
// theme before the library opens.
import { useSyncExternalStore } from 'react'
import { scoped } from './accounts'

export type DevicePrefs = { theme: 'system' | 'light' | 'dark'; motion: 'system' | 'reduce' }
const KEY = scoped('ream.device.v1')
let prefs: DevicePrefs = { theme: 'system', motion: 'system' }
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { /* defaults */ }

const listeners = new Set<() => void>()
function apply() {
  const html = document.documentElement
  if (prefs.theme === 'system') delete html.dataset.theme
  else html.dataset.theme = prefs.theme
  html.dataset.motion = prefs.motion
}
apply()

function set(p: Partial<DevicePrefs>) {
  prefs = { ...prefs, ...p }
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* session only */ }
  apply()
  listeners.forEach((l) => l())
}
let saveToLibrary: ((p: DevicePrefs) => void) | null = null
/** The library hands over its settings once open (and whenever they change from another device). */
export function adoptLibraryPrefs(fromLibrary: Partial<DevicePrefs> | undefined, save: (p: DevicePrefs) => void) {
  saveToLibrary = save
  if (fromLibrary && (fromLibrary.theme !== prefs.theme || fromLibrary.motion !== prefs.motion)) set(fromLibrary)
}
export function setPrefs(p: Partial<DevicePrefs>) {
  set(p)
  saveToLibrary?.(prefs)
}
export const useDevicePrefs = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => prefs)
