// AI provider logos (lobehub's MIT icon set), in the same rounded tile as the cloud ProviderMark.
// `bare` drops the tile for inline use in menus and chips.
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg?raw'
import azure from '@lobehub/icons-static-svg/icons/azure-color.svg?raw'
import cerebras from '@lobehub/icons-static-svg/icons/cerebras-color.svg?raw'
import cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg?raw'
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg?raw'
import fireworks from '@lobehub/icons-static-svg/icons/fireworks-color.svg?raw'
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg?raw'
import groq from '@lobehub/icons-static-svg/icons/groq.svg?raw'
import microsoft from '@lobehub/icons-static-svg/icons/microsoft-color.svg?raw'
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg?raw'
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg?raw'
import openai from '@lobehub/icons-static-svg/icons/openai.svg?raw'
import openrouter from '@lobehub/icons-static-svg/icons/openrouter.svg?raw'
import perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg?raw'
import together from '@lobehub/icons-static-svg/icons/together-color.svg?raw'
import xai from '@lobehub/icons-static-svg/icons/xai.svg?raw'
import type { ModelProvider } from '../data/ai/settings'

const SVG: Record<ModelProvider, string> = {
  anthropic, openai, google: gemini, openrouter, mistral, xai, groq, deepseek, cerebras,
  togetherai: together, fireworks, perplexity, cohere, azure, local: ollama,
  browser: /\bEdg\//.test(navigator.userAgent) ? microsoft : gemini,
}
// The files carry fixed 1em sizing and a <title>; the label lives on the row, so both go.
const clean = (svg: string) => svg.replace(/\s(width|height|style)="[^"]*"/g, '').replace(/<title>.*?<\/title>/, '').replace('<svg', '<svg width="100%" height="100%" aria-hidden="true"')

export function AiMark({ id, size = 28, bare = false }: { id: ModelProvider; size?: number; bare?: boolean }) {
  const glyph = bare ? size : Math.round(size * 0.58)
  return (
    <span
      aria-hidden
      style={{
        width: size, height: size, flex: 'none', display: 'inline-grid', placeItems: 'center', color: 'var(--ink)',
        ...(bare ? {} : { borderRadius: Math.round(size / 4), background: 'var(--fill)' }),
      }}
    >
      <span style={{ width: glyph, height: glyph, display: 'block' }} dangerouslySetInnerHTML={{ __html: clean(SVG[id]) }} />
    </span>
  )
}
