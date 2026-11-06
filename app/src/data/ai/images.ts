// Picture generation (spec: image generation): the user's chosen picture model, from Picture → Generate in
// the editor and as Ask's generate_picture tool. Reference pictures go along when the model takes them.
import { generateImage } from 'ai'
import { providerDef, type AiProviderId } from './providers'
import { getAi, modelsFor, type ModelRef } from './settings'
import { recordUsage } from './usage'

export const ASPECTS = ['16:9', '4:3', '1:1', '3:4', '9:16'] as const
export type Aspect = (typeof ASPECTS)[number]

/** The picture model Ream uses: the one chosen in Settings, else the first one turned on. */
export function pictureModel(): ModelRef | null {
  const ai = getAi()
  const all = modelsFor(ai, 'image')
  const chosen = ai.imageModel && all.some((m) => m.provider === ai.imageModel!.provider && m.id === ai.imageModel!.id) ? ai.imageModel : null
  return chosen ?? all[0] ?? null
}

/** Makes a picture; returns it as a data URL. */
export async function makePicture(opts: { prompt: string; references?: string[]; aspect?: Aspect; signal?: AbortSignal }): Promise<string> {
  const ref = pictureModel()
  if (!ref) throw new Error('Choose a picture model in Settings → AI to generate pictures.')
  const def = providerDef(ref.provider as AiProviderId)
  if (!def.makeImage) throw new Error(`${def.name} pictures can’t be generated from the browser yet.`)
  const model = await def.makeImage(getAi().providers[ref.provider as AiProviderId] ?? {}, ref.id)
  const r = await generateImage({
    model,
    prompt: opts.references?.length ? { text: opts.prompt, images: opts.references } : opts.prompt,
    aspectRatio: opts.aspect,
    abortSignal: opts.signal,
    maxRetries: 2,
  })
  recordUsage(ref.provider, ref.id, { requests: 1, pictures: 1 })
  return `data:${r.image.mediaType || 'image/png'};base64,${r.image.base64}`
}
