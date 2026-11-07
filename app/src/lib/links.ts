// One policy for every link Ream shows (prose and interactive answers, spec generative-ui.md §2): http(s) only, and
// never opened without the person seeing the full address first.
import { confirm } from '../ui/Dialog'

export function safeUrl(raw: string): URL | null {
  try { const u = new URL(raw); return u.protocol === 'https:' || u.protocol === 'http:' ? u : null } catch { return null }
}

export async function openLink(raw: string): Promise<boolean> {
  const u = safeUrl(raw)
  if (!u) return false
  const ok = await confirm({ title: `Open ${u.hostname}?`, body: `This opens a website outside Ream: ${u.href}`, confirmLabel: 'Open' })
  if (ok) window.open(u.href, '_blank', 'noopener,noreferrer')
  return ok
}
