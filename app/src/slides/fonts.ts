// Ream's slide fonts. Slides name them by their real family ("Instrument Sans", "Instrument Serif"),
// the names inside the font files, so domOXML can match and embed them in exported decks.
// On screen: the variable Sans (every weight). In a .pptx: static Regular and Bold, the faces
// PowerPoint can embed (a variable font would be substituted).
import sansVariable from '@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url'
import sansBold from '@fontsource/instrument-sans/files/instrument-sans-latin-700-normal.woff2?url'
import sansRegular from '@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2?url'
import serifRegular from '@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url'

const abs = (u: string) => new URL(u, location.href).href
export const SLIDE_FONT_CSS =
  `@font-face{font-family:'Instrument Sans';src:url(${abs(sansVariable)}) format('woff2');font-weight:100 900}`
  + `@font-face{font-family:'Instrument Serif';src:url(${abs(serifRegular)}) format('woff2');font-weight:400}`
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
