import { useSyncExternalStore } from 'react'

export type Toast = {
  id: number
  message: string
  action?: { label: string; run: () => void }
  tone?: 'ok' | 'danger'
  busy?: boolean
  duration: number
}

let toasts: Toast[] = []
let seq = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function toast(t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) {
  const item: Toast = { duration: 5000, ...t, id: ++seq }
  toasts = [...toasts, item].slice(-3)
  emit()
  return { id: item.id, dismiss: () => dismissToast(item.id) }
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export function useToasts() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => toasts,
  )
}
