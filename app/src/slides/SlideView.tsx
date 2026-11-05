// Renders one slide's normalized HTML (domOXML's output shape: a 1280x720 .domoxml-slide of
// absolutely positioned shapes) inside a shadow root, scaled to the container's width. The same
// component draws 48px thumbnails, the stage and Quick Look. Slide HTML is untrusted (imports, AI
// output): it is sanitised, so scripts and event handlers never run.
import DOMPurify from 'dompurify'
import { useLayoutEffect, useRef } from 'react'
import type { SlideDoc } from '../data/types'
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

const BASE = `:host{display:block;position:relative;overflow:hidden;aspect-ratio:16/9;width:100%}
.stage{position:absolute;left:0;top:0;width:${SLIDE_W}px;height:${SLIDE_H}px;transform-origin:0 0;user-select:none}
.stage *{box-sizing:border-box}`

export function SlideView({ slide, className, interactive = false, label }: { slide: SlideDoc; className?: string; interactive?: boolean; label?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    if (!stage.current) {
      root.innerHTML = `<style>${BASE}</style><div class="stage" part="stage"></div>`
      stage.current = root.querySelector('.stage')
    }
    stage.current!.innerHTML = sanitize(slide.html)
  }, [slide.html])

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const fit = () => { if (stage.current) stage.current.style.transform = `scale(${el.clientWidth / SLIDE_W})` }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
