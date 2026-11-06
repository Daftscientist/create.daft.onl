// Renders one slide's normalized HTML (domOXML's output shape: a .domoxml-slide, 1280x720 unless the
// deck says otherwise, of absolutely positioned shapes) inside a shadow root, scaled to the container's width. The same
// component draws 48px thumbnails, the stage and Quick Look. Slide HTML is untrusted (imports, AI
// output): it is sanitised, so scripts and event handlers never run.
import DOMPurify from 'dompurify'
import { useLayoutEffect, useRef } from 'react'
import type { SlideDoc, SlideSize } from '../data/types'
import { registerSlideFonts } from './fonts'
import s from './SlideView.module.css'

export const SLIDE_W = 1280
export const SLIDE_H = 720

const clean = new Map<string, string>()
export function sanitize(html: string): string {
  let out = clean.get(html)
  if (out === undefined) {
    out = DOMPurify.sanitize(html, { ADD_ATTR: ['style'], FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form'], ALLOW_DATA_ATTR: true })
    if (clean.size > 500) clean.clear()
    clean.set(html, out)
  }
  return out
}

const DEFAULT: SlideSize = { w: SLIDE_W, h: SLIDE_H }
const base = ({ w, h }: SlideSize) => `:host{display:block;position:relative;overflow:hidden;aspect-ratio:${w}/${h};width:100%}
.stage{position:absolute;left:0;top:0;width:${w}px;height:${h}px;transform-origin:0 0;user-select:none;
font:400 16px/normal Inter,sans-serif;color:#0b0b0c;letter-spacing:normal;word-spacing:normal;text-align:left;text-transform:none;white-space:normal;font-variant:normal;font-feature-settings:normal;cursor:default}
.stage *{margin:0;padding:0;box-sizing:border-box}`
// The page around the slide must not leak into it: the same reset and defaults as the page domOXML
// composes for export (core/render/page.py), so a slide looks here exactly as it exports.

// @font-face is ignored inside shadow roots, so an imported deck's embedded fonts are registered on
// the document (once each); the rest of its CSS stays scoped to the slide.
const FONT_FACE = /@font-face\s*\{[^}]*\}/g
const registered = new Set<string>()
function scopedCss(css: string): string {
  let sheet: HTMLStyleElement | null = null
  for (const rule of css.match(FONT_FACE) ?? []) {
    if (registered.has(rule)) continue
    registered.add(rule)
    sheet ??= document.head.appendChild(document.createElement('style'))
    sheet.textContent += rule
  }
  return css.replace(FONT_FACE, '')
}

// The editor's stage: objects off the slide stay visible on the ground; text being edited is selectable;
// empty placeholders show their hint (never exported: it's CSS, only here).
const EDITOR_CSS = `:host{overflow:visible}.stage>.domoxml-slide{overflow:visible!important}
[contenteditable]{user-select:text;-webkit-user-select:text;cursor:text;outline:none}
img{-webkit-user-drag:none;user-drag:none}
[data-ream-hidden]{visibility:visible!important;opacity:.35}
[data-ream-empty][data-ream-placeholder]::after{content:attr(data-ream-placeholder);position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(23,23,28,.38);font:500 28px/1.2 'Instrument Sans',sans-serif;pointer-events:none}
[data-ream-empty][data-ream-editing]::after{content:none}`

export function SlideView({ slide, size = DEFAULT, css = '', className, interactive = false, label, editor = false, hold = false, onStage }: {
  slide: SlideDoc
  size?: SlideSize
  css?: string
  className?: string
  interactive?: boolean
  label?: string
  /** The editor's stage (see EDITOR_CSS). */
  editor?: boolean
  /** Keeps the DOM as it is (a drag or text edit is changing it live); it catches up when released. */
  hold?: boolean
  /** The shadow root's stage element, for the editor's hit testing and live previews. */
  onStage?: (stage: HTMLDivElement | null) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    registerSlideFonts()
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    root.innerHTML = `<style>${base(size)}${scopedCss(css)}${editor ? EDITOR_CSS : ''}</style><div class="stage" part="stage"></div>`
    stage.current = root.querySelector('.stage')
    stage.current!.style.transform = `scale(${el.clientWidth / size.w})`
    onStage?.(stage.current)
  }, [size.w, size.h, css, editor]) // size compared by value; eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (hold) return
    const clean = sanitize(slide.html)
    // After an edit the stage often already shows exactly this (it was previewed live): leave it,
    // so pictures don't re-decode and nothing flickers.
    if (stage.current!.innerHTML !== clean) stage.current!.innerHTML = clean
  }, [slide.html, size.w, size.h, css, editor, hold])
  useLayoutEffect(() => () => onStage?.(null), []) // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const fit = () => { if (stage.current) stage.current.style.transform = `scale(${el.clientWidth / size.w})` }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size.w])

  return (
    <div
      ref={host}
      className={`${s.slide} ${className ?? ''}`}
      data-slide-id={slide.id}
      {...(interactive ? { role: 'img', 'aria-label': label ?? slideText(slide) } : { 'aria-hidden': true })}
    />
  )
}

const textCache = new Map<string, string>()
/** Visible text of a slide (search, accessibility, AI context). */
export function slideText(slide: SlideDoc): string {
  let t = textCache.get(slide.html)
  if (t === undefined) {
    const doc = new DOMParser().parseFromString(sanitize(slide.html), 'text/html')
    t = (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
    textCache.set(slide.html, t)
  }
  return t
}
