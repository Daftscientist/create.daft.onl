// Ream's slide fonts. Slides name them by their real family ("Instrument Sans", "Instrument Serif"),
// the names inside the font files, so domOXML can match and embed them in exported decks.
// On screen: the variable Sans (every weight). In a .pptx: static Regular and Bold, the faces
// PowerPoint can embed (a variable font would be substituted).
import sansVariable from '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url'
import sansBold from '@fontsource/instrument-sans/files/instrument-sans-latin-700-normal.woff2?url'
import sansRegular from '@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2?url'
import serifRegular from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url'

import interVariable from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

const abs = (u: string) => new URL(u, location.href).href

// The Office fonts most decks use, drawn everywhere: the installed font when there is one (local()),
// otherwise an open font with the same letter widths, so text wraps as it will in PowerPoint. Slides
// keep the real name, so an exported deck still says Calibri.
const CLONES = import.meta.glob('../../node_modules/@fontsource/{carlito,caladea,arimo,tinos,cousine,gelasio}/files/*-latin-{400,700}-{normal,italic}.woff2', { query: '?url', import: 'default', eager: true }) as Record<string, string>
const STANDS_IN: [string, string][] = [
  ['Calibri', 'carlito'], ['Cambria', 'caladea'], ['Arial', 'arimo'], ['Helvetica', 'arimo'],
  ['Times New Roman', 'tinos'], ['Courier New', 'cousine'], ['Georgia', 'gelasio'],
]
const cloneFaces = STANDS_IN.flatMap(([family, clone]) => Object.entries(CLONES)
  .filter(([path]) => path.includes(`/${clone}/`))
  .map(([path, url]) => {
    const [, weight, style] = /-(400|700)-(normal|italic)\.woff2$/.exec(path)!
    const local = `${family}${weight === '700' ? ' Bold' : ''}${style === 'italic' ? ' Italic' : ''}`
    return `@font-face{font-family:'${family}';src:local('${local}'),url(${abs(url)}) format('woff2');font-weight:${weight};font-style:${style}}`
  })).join('')

export const SLIDE_FONT_CSS =
  `@font-face{font-family:'Instrument Sans';src:url(${abs(sansVariable)}) format('woff2');font-weight:100 900}`
  + `@font-face{font-family:'Instrument Serif';src:url(${abs(serifRegular)}) format('woff2');font-weight:400}`
  + `@font-face{font-family:'Inter';src:local('Inter'),url(${abs(interVariable)}) format('woff2');font-weight:100 900}`
  + cloneFaces

/** The fonts the font menus offer: each one draws in every browser. `generic` is its CSS fallback. */
export const FONTS: { name: string; generic: 'sans-serif' | 'serif' | 'monospace' }[] = [
  { name: 'Instrument Sans', generic: 'sans-serif' }, { name: 'Inter', generic: 'sans-serif' },
  { name: 'Calibri', generic: 'sans-serif' }, { name: 'Arial', generic: 'sans-serif' }, { name: 'Helvetica', generic: 'sans-serif' },
  { name: 'Instrument Serif', generic: 'serif' }, { name: 'Georgia', generic: 'serif' }, { name: 'Cambria', generic: 'serif' },
  { name: 'Times New Roman', generic: 'serif' }, { name: 'Courier New', generic: 'monospace' },
]
/** A font-family value for `name`, with the right kind of fallback. */
export function fontStack(name: string): string {
  const generic = FONTS.find((f) => f.name === name)?.generic
    ?? (/mono|courier|consol|code/i.test(name) ? 'monospace' : /serif|times|garamond|georgia|cambria|book|roman/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans-serif')
  return `${name},${generic}`
}
/** The files exported decks embed. */
export const EMBED_FONT_URLS = [sansRegular, sansBold, serifRegular]
/** Slides made before the fonts were named by family used the package's CSS alias. */
export const withFamilyNames = (html: string) => html.replace(/Instrument Sans Variable/g, 'Instrument Sans')

let registered = false
/** Registers the slide fonts on the document (shadow roots can't declare @font-face). */
export function registerSlideFonts() {
  if (registered) return
  registered = true
  document.head.appendChild(document.createElement('style')).textContent = SLIDE_FONT_CSS
}
