// Find and replace (spec phase 2; ⌘F, ⌥⌘F for replace). Searches every slide's text, steps through
// matches (selecting the object and showing its slide), and replaces one or all, keeping each run's
// formatting. Replace all is one change across the deck.
import { CaretDown, CaretUp, X } from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Deck } from '../data/types'
import { IconButton } from '../ui/Button'
import { parseSlide, topNodes } from './irdiff'
import { editSlides } from './ops'
import { setEditor } from './session'
import { liveStage } from './Canvas'
import s from './FindBar.module.css'

/** One match: its object, and which match it is inside that object (so Replace changes exactly it). */
/** One match: its object, and which match it is inside that object (so Replace changes exactly it). */
type Hit = { slideId: string; slideIndex: number; objectId: string; occ: number }
const BLOCKS = '.domoxml-text, li, td, th'

/** A paragraph's text as one string, with where each text node starts in it. A word split across
 *  formatting runs is found (and replaced) like any other. */
type Para = { nodes: Text[]; starts: number[]; text: string }
function parasOf(root: Element): Para[] {
  const out: Para[] = []
  for (const block of root.querySelectorAll(BLOCKS)) {
    if (block.matches('td, th') && block.querySelector('.domoxml-text, li')) continue
    const nodes: Text[] = []
    const w = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    // Text belongs to its nearest paragraph (an item's nested list has paragraphs of its own).
    for (let n = w.nextNode(); n; n = w.nextNode()) if (n.parentElement?.closest(BLOCKS) === block) nodes.push(n as Text)
    const starts: number[] = []
    let text = ''
    for (const n of nodes) { starts.push(text.length); text += n.data }
    if (text) out.push({ nodes, starts, text })
  }
  return out
}
function matches(p: Para, re: RegExp): [number, number][] {
  const out: [number, number][] = []
  re.lastIndex = 0
  for (let m = re.exec(p.text); m; m = re.exec(p.text)) { out.push([m.index, m.index + m[0].length]); if (!m[0].length) re.lastIndex++ }
  return out
}
/** Where character `i` of a paragraph lives. */
function charAt(p: Para, i: number): [Text, number] {
  for (let k = p.nodes.length - 1; k >= 0; k--) if (p.starts[k] <= i) return [p.nodes[k], i - p.starts[k]]
  return [p.nodes[0], 0]
}
/** Replaces characters [s, e) of a paragraph; the replacement takes the first run's formatting. */
function replaceRange(p: Para, s: number, e: number, rep: string) {
  p.nodes.forEach((n, k) => {
    const ns = p.starts[k], ne = ns + n.data.length
    if (ne <= s || ns >= e) return
    const a = Math.max(s, ns) - ns, b = Math.min(e, ne) - ns
    n.data = n.data.slice(0, a) + (ns <= s ? rep : '') + n.data.slice(b)
  })
}
const escapeRe = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

type Highlights = { set: (k: string, v: unknown) => void; delete: (k: string) => void }
const highlights = () => (CSS as unknown as { highlights?: Highlights }).highlights
declare const Highlight: { new (...r: Range[]): unknown } | undefined

export function FindBar({ deck, replace: startReplace, onClose }: { deck: Deck; replace: boolean; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [rep, setRep] = useState('')
  const [showReplace, setShowReplace] = useState(startReplace)
  const [caseOn, setCaseOn] = useState(false)
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus(); input.current?.select() }, [])
  useEffect(() => setShowReplace((r) => r || startReplace), [startReplace])

  const re = useMemo(() => (q ? new RegExp(escapeRe(q), caseOn ? 'g' : 'gi') : null), [q, caseOn])
  const hits = useMemo<Hit[]>(() => {
    if (!re) return []
    const out: Hit[] = []
    deck.slides.forEach((sl, slideIndex) => {
      for (const [objectId, el] of topNodes(parseSlide(sl.html))) {
        let occ = 0
        for (const p of parasOf(el)) for (let n = matches(p, re).length; n > 0; n--) out.push({ slideId: sl.id, slideIndex, objectId, occ: occ++ })
      }
    })
    return out
  }, [deck.slides, re])
  const cur = hits.length ? hits[Math.min(at, hits.length - 1)] : null

  const show = (i: number) => {
    if (!hits.length) return
    const k = (i + hits.length) % hits.length
    setAt(k)
    const h = hits[k]
    setEditor({ slideId: h.slideId, railSel: [h.slideId], railAnchor: h.slideId, sel: [h.objectId], scope: null, editing: null })
    requestAnimationFrame(() => requestAnimationFrame(() => mark(h)))
  }

  /** Highlights the current match on the live slide (CSS Custom Highlights; skipped where unsupported). */
  const mark = (h: Hit) => {
    const hl = highlights(), stage = liveStage()
    if (!hl || typeof Highlight === 'undefined' || !stage || !re) return
    const el = stage.querySelector(`[data-domoxml-node-id="${CSS.escape(h.objectId)}"]`)
    if (!el) return
    let occ = 0
    for (const p of parasOf(el)) for (const [a, b] of matches(p, re)) {
      if (occ++ !== h.occ) continue
      const r = document.createRange()
      const [sn, so] = charAt(p, a), [en, eo] = charAt(p, b)
      r.setStart(sn, so); r.setEnd(en, eo)
      hl.set('ream-find', new Highlight(r))
      return
    }
  }
  useEffect(() => () => highlights()?.delete('ream-find'), [])

  /** Replaces in text nodes (a match split across two runs isn't found, as in most editors). */
  const replaceIn = (only: Hit | null) => {
    if (!re) return
    let count = 0
    editSlides(only ? 'Replace' : 'Replace all', (slides) => slides.map((sl) => {
      if (only && sl.id !== only.slideId) return sl
      const root = parseSlide(sl.html)
      let changed = false
      for (const [id, el] of topNodes(root)) {
        if (only && id !== only.objectId) continue
        let occ = 0
        for (const p of parasOf(el)) {
          // Right to left, so earlier offsets stay valid as text changes length.
          const found = matches(p, re).map((m) => [m, occ++] as const)
          for (const [[a, b], k] of found.reverse()) {
            if (only && k !== only.occ) continue
            replaceRange(p, a, b, rep); count++; changed = true
          }
        }
      }
      return changed ? { ...sl, html: root.outerHTML } : sl
    }))
    return count
  }

  return (
    <div className={s.bar} role="search" aria-label="Find in deck" onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() } }}>
      <div className={s.row}>
        <input ref={input} className={s.input} value={q} placeholder="Find in deck" aria-label="Find" onChange={(e) => { setQ(e.target.value); setAt(0) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); show(e.shiftKey ? at - 1 : cur && hits[at] ? at + 1 : 0) } }} />
        <span className={s.count} aria-live="polite">{q ? (hits.length ? `${Math.min(at, hits.length - 1) + 1} of ${hits.length}` : 'No results') : ''}</span>
        <button type="button" className={s.toggle} aria-pressed={caseOn} title="Match case" onClick={() => setCaseOn((c) => !c)}>Aa</button>
        <IconButton label="Previous" hint="⇧↵" size="sm" tone="plain" disabled={!hits.length} onClick={() => show(at - 1)}><CaretUp size={14} /></IconButton>
        <IconButton label="Next" hint="↵" size="sm" tone="plain" disabled={!hits.length} onClick={() => show(at + 1)}><CaretDown size={14} /></IconButton>
        <button type="button" className={s.link} onClick={() => setShowReplace((r) => !r)}>{showReplace ? 'Hide replace' : 'Replace'}</button>
        <IconButton label="Close" hint="Esc" size="sm" tone="plain" onClick={onClose}><X size={14} /></IconButton>
      </div>
      {showReplace && (
        <div className={s.row}>
          <input className={s.input} value={rep} placeholder="Replace with" aria-label="Replace with" onChange={(e) => setRep(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (cur) { replaceIn(cur) } } }} />
          <button type="button" className={s.action} disabled={!cur} onClick={() => cur && replaceIn(cur)}>Replace</button>
          <button type="button" className={s.action} disabled={!hits.length} onClick={() => replaceIn(null)}>Replace all</button>
        </div>
      )}
    </div>
  )
}
