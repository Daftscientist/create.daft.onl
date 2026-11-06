// Comments on the slide itself (spec v3: comments anywhere): each open comment is a pin, at the point it was
// dropped or at the top-right of the objects it's on. A pin opens its thread (reply, resolve, delete). Placing
// a comment: "Comment" (or ⌥⌘M) then click the slide; with objects selected, ⌥⌘M comments on them.
import { ChatCircle, Check, Trash } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import type { SlideComment, SlideDoc } from '../data/types'
import { relTimeInline } from '../lib/format'
import { Button, IconButton } from '../ui/Button'
import { Popover } from '../ui/Popover'
import { bounds, boxOf, unionBox } from './geometry'
import { addComment, commentTargets, deleteComment, find, replyComment, resolveComment } from './ops'
import { getEditor, setEditor, useEditor } from './session'
import s from './CommentPins.module.css'

type Draft = { x: number; y: number; objectIds?: string[] }

export function CommentPins({ slide, stage, z, readOnly }: { slide: SlideDoc; stage: HTMLElement | null; z: number; readOnly?: boolean }) {
  const [open, setOpen] = useState<{ id: string; anchor: HTMLElement } | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftPin, setDraftPin] = useState<HTMLSpanElement | null>(null)
  const commenting = useEditor((e) => e.commenting)

  // A click on the slide in comment mode (from the canvas), or ⌥⌘M on a selection.
  useEffect(() => {
    const pin = (e: Event) => setDraft((e as CustomEvent<Draft>).detail)
    addEventListener('ream:comment-at', pin)
    return () => removeEventListener('ream:comment-at', pin)
  }, [])
  useEffect(() => { setDraft(null); setOpen(null) }, [slide.id])

  const where = (c: SlideComment): { x: number; y: number } | null => {
    const ids = commentTargets(c)
    if (ids.length && stage) {
      const els = ids.map((id) => find(stage, id)).filter((e): e is HTMLElement => !!e)
      if (els.length) { const b = unionBox(els.map((e) => bounds(boxOf(e)))); return { x: b.x + b.w, y: b.y } }
    }
    return c.pin ?? null
  }
  const shown = (slide.comments ?? []).filter((c) => !c.resolved).map((c, i) => ({ c, i, at: where(c) })).filter((x): x is { c: SlideComment; i: number; at: { x: number; y: number } } => !!x.at)
  const current = open && slide.comments?.find((c) => c.id === open.id)

  return (
    <div className={s.layer} data-commenting={commenting || undefined}>
      {shown.map(({ c, i, at }) => (
        <button key={c.id} type="button" className={s.pin} data-ai={c.by === 'ai' || undefined} aria-expanded={open?.id === c.id}
          style={{ left: at.x * z, top: at.y * z }} aria-label={`Comment ${i + 1}: ${c.text}`} title={c.text}
          onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { const a = e.currentTarget; setDraft(null); setOpen((o) => (o?.id === c.id ? null : { id: c.id, anchor: a })) }}>
          {c.by === 'ai' ? 'R' : i + 1}{(c.replies?.length ?? 0) > 0 && <span className={s.count}>{c.replies!.length}</span>}
        </button>
      ))}
      {draft && <span ref={setDraftPin} className={s.pin} data-draft style={{ left: draft.x * z, top: draft.y * z }} aria-hidden><ChatCircle size={12} weight="fill" /></span>}

      {current && open && <Popover anchor={open.anchor} label="Comment" width={300} onClose={() => setOpen(null)}>
        <Thread slideId={slide.id} c={current} readOnly={readOnly} onDone={() => setOpen(null)} />
      </Popover>}
      {draft && draftPin && <Popover anchor={draftPin} label="New comment" width={300} onClose={() => setDraft(null)}>
        <Compose onCancel={() => setDraft(null)} label={draft.objectIds?.length ? `On ${draft.objectIds.length === 1 ? 'the selected object' : `${draft.objectIds.length} selected objects`}` : 'Pinned here'}
          onPost={(text) => { addComment(slide.id, text, draft.objectIds ? { objectIds: draft.objectIds } : { pin: { x: draft.x, y: draft.y } }); setDraft(null) }} />
      </Popover>}
    </div>
  )
}

/** Comment mode's click, or ⌥⌘M with objects selected: opens the composer there. */
export function startComment(at?: { x: number; y: number }) {
  if (at) { setEditor({ commenting: false }); dispatchEvent(new CustomEvent('ream:comment-at', { detail: at })); return }
  const st = getEditor()
  if (st.sel.length) {
    const stage = document.querySelector('[data-stage] [class*=paper] > div')?.shadowRoot
    const els = stage ? st.sel.map((id) => stage.querySelector<HTMLElement>(`[data-domoxml-node-id="${CSS.escape(id)}"]`)).filter((e): e is HTMLElement => !!e) : []
    if (els.length) { const b = unionBox(els.map((e) => bounds(boxOf(e)))); dispatchEvent(new CustomEvent('ream:comment-at', { detail: { x: b.x + b.w, y: b.y, objectIds: st.sel } })); return }
  }
  setEditor({ commenting: true })
}

function Compose({ label, onPost, onCancel }: { label: string; onPost: (t: string) => void; onCancel: () => void }) {
  const [text, setText] = useState('')
  return (
    <div className={s.compose}>
      <span className={s.meta}>{label}</span>
      <textarea data-autofocus className={s.area} value={text} placeholder="Add a comment" aria-label="Comment" rows={3}
        onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onPost(text.trim()) }} />
      <div className={s.actions}>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={!text.trim()} onClick={() => onPost(text.trim())}>Comment</Button>
      </div>
    </div>
  )
}

function Thread({ slideId, c, readOnly, onDone }: { slideId: string; c: SlideComment; readOnly?: boolean; onDone: () => void }) {
  const [reply, setReply] = useState('')
  const targets = commentTargets(c)
  return (
    <div className={s.thread}>
      <div className={s.head}>
        <span className={s.meta}>{c.by === 'ai' ? 'Ream' : 'You'} · {relTimeInline(c.at)}{targets.length ? ` · on ${targets.length === 1 ? 'an object' : `${targets.length} objects`}` : ''}</span>
        {!readOnly && <>
          <IconButton label="Resolve" size="sm" tone="plain" onClick={() => { resolveComment(slideId, c.id, true); onDone() }}><Check size={14} /></IconButton>
          <IconButton label="Delete comment" size="sm" tone="plain" onClick={() => { deleteComment(slideId, c.id); onDone() }}><Trash size={14} /></IconButton>
        </>}
      </div>
      <p className={s.text}>{c.text}</p>
      {targets.length > 0 && <button type="button" className={s.link} onClick={() => setEditor({ sel: targets, scope: null })}>Select {targets.length === 1 ? 'the object' : 'the objects'}</button>}
      {(c.replies ?? []).map((r) => <p key={r.id} className={s.reply}><span className={s.meta}>{r.by === 'ai' ? 'Ream' : 'You'} · {relTimeInline(r.at)}</span>{r.text}</p>)}
      {!readOnly && <input data-autofocus className={s.replyInput} placeholder="Reply" aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) { replyComment(slideId, c.id, reply.trim()); setReply('') } }} />}
    </div>
  )
}
