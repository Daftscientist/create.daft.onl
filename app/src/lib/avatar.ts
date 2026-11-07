// Generated faces for local accounts: DiceBear's Cameo style, default look, transparent background. A seed makes
// the same face every time, so an account only stores its seed (and the picture, for the first frame).
import { Avatar } from '@dicebear/core'
import cameo from '@dicebear/styles/cameo.json'

export const newSeed = () => Math.random().toString(36).slice(2, 10)
export function cameoAvatar(seed: string): string {
  return new Avatar(cameo as never, { seed }).toDataUri()
}
