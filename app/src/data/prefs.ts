// "This device" preferences (Settings → Appearance, Motion). Device-scoped by design, so they live in
// this browser's localStorage rather than the synced library.
import { useSyncExternalStore } from 'react'

export type DevicePrefs = { theme: 'system' | 'light' | 'dark'; motion: 'system' | 'reduce' }
const KEY = 'ream.device.v1'
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

export function setPrefs(p: Partial<DevicePrefs>) {
  prefs = { ...prefs, ...p }
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* session only */ }
  apply()
  listeners.forEach((l) => l())
}
export const useDevicePrefs = () => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => prefs)
