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
import s from './FindBar.module.css'

/** One match: its object, and which match it is inside that object (so Replace changes exactly it). */
type Hit = { slideId: string; slideIndex: number; objectId: string; occ: number }
const TEXT = '.domoxml-text, li, td, th'

function textNodesOf(root: Element): Text[] {
  const out: Text[] = []
  for (const block of root.querySelectorAll(TEXT)) {
    const w = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) if (!out.includes(n as Text)) out.push(n as Text)
  }
  return out
}
const escapeRe = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

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
        for (const t of textNodesOf(el)) {
          const n = t.data.match(re)?.length ?? 0
          for (let i = 0; i < n; i++) out.push({ slideId: sl.id, slideIndex, objectId, occ: occ++ })
        }
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
  }

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
        for (const t of textNodesOf(el)) {
          const next = t.data.replace(re, (m) => { const mine = !only || occ === only.occ; occ++; if (!mine) return m; count++; return rep })
          if (next !== t.data) { t.data = next; changed = true }
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
