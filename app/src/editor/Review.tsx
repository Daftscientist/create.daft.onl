// Review (spec phase 6): comments on slides and objects, the accessibility checker, and local version
// history. The context bar opens slide and object comments; the deck menu opens the checker and history.
import { ArrowCounterClockwise, Check, ChatCircle, Trash, Warning } from '@phosphor-icons/react'
import { useEffect, useMemo, useState } from 'react'
import type { Deck, SlideDoc } from '../data/types'
import { relTimeInline } from '../lib/format'
import { Button, IconButton } from '../ui/Button'
import { Dialog } from '../ui/Dialog'
import { Row, Section } from '../ui/Inspector'
import { DeckThumb } from '../compositions/DeckThumb'
import { checkDeck } from './a11y'
import { transact } from './history'
import { addComment, commentTargets, deleteComment, replyComment, resolveComment } from './ops'
import { getEditor, setEditor } from './session'
import { listVersions, type Version } from './versions'
import s from './Sections.module.css'

type Sec = { open: boolean; onToggle: () => void }

/** Unsent comments and replies, by slide and object (or comment), so closing the popover never loses them. */
const drafts = new Map<string, string>()
function useDraft(key: string): [string, (v: string) => void] {
  const [v, setV] = useState(() => drafts.get(key) ?? '')
  useEffect(() => setV(drafts.get(key) ?? ''), [key])
  return [v, (x: string) => { if (x) drafts.set(key, x); else drafts.delete(key); setV(x) }]
}

export function CommentsSection({ slide, sec, objectIds, objectName }: { slide: SlideDoc; sec: Sec; objectIds?: string[]; objectName?: string }) {
  const [text, setText] = useDraft(`${slide.id}:${objectIds?.join(',') ?? ''}`)
  const all = slide.comments ?? []
  const shown = objectIds?.length ? all.filter((c) => commentTargets(c).some((id) => objectIds.includes(id))) : all
  const open = shown.filter((c) => !c.resolved)
  return (
    <Section title="Comments" {...sec} aside={open.length ? <span className={s.badge}>{open.length}</span> : undefined}>
      {shown.map((c) => (
        <div key={c.id} className={s.comment} data-resolved={c.resolved || undefined}>
          <div className={s.commentHead}>
            <span>{relTimeInline(c.at)}{commentTargets(c).length && !objectIds?.length ? ` · on ${commentTargets(c).length === 1 ? 'an object' : `${commentTargets(c).length} objects`}` : c.pin && !objectIds?.length ? ' · pinned' : ''}{c.by === 'ai' ? ' · Ream' : ''}</span>
            <IconButton label={c.resolved ? 'Reopen' : 'Resolve'} size="sm" tone="plain" onClick={() => resolveComment(slide.id, c.id, !c.resolved)}>{c.resolved ? <ArrowCounterClockwise size={13} /> : <Check size={13} />}</IconButton>
            <IconButton label="Delete comment" size="sm" tone="plain" onClick={() => deleteComment(slide.id, c.id)}><Trash size={13} /></IconButton>
          </div>
          <p className={s.commentText} onClick={() => commentTargets(c).length && setEditor({ sel: commentTargets(c), scope: null })}>{c.text}</p>
          {(c.replies ?? []).map((r) => <p key={r.id} className={s.reply}>{r.text}<span> · {relTimeInline(r.at)}</span></p>)}
          {!c.resolved && (
            <ReplyField slideId={slide.id} commentId={c.id} />
          )}
        </div>
      ))}
      <textarea className={s.notes} style={{ minHeight: 56 }} value={text} placeholder={objectName ? `Comment on ${objectName}` : 'Comment on this slide'} aria-label="New comment" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) { addComment(slide.id, text.trim(), { objectIds }); setText('') } }} />
      <Row><Button variant="secondary" icon={<ChatCircle size={14} />} disabled={!text.trim()} onClick={() => { addComment(slide.id, text.trim(), { objectIds }); setText('') }}>Comment</Button></Row>
    </Section>
  )
}

function ReplyField({ slideId, commentId }: { slideId: string; commentId: string }) {
  const [reply, setReply] = useDraft(`reply:${commentId}`)
  return (
    <input className={s.replyInput} placeholder="Reply" aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && reply.trim()) { replyComment(slideId, commentId, reply.trim()); setReply('') } }} />
  )
}

export function AccessibilitySection({ deck, sec }: { deck: Deck; sec: Sec }) {
  const issues = useMemo(() => (sec.open ? checkDeck(deck) : []), [deck, sec.open])
  return (
    <Section title="Accessibility" {...sec} aside={sec.open && issues.length ? <span className={s.badge}>{issues.length}</span> : undefined}>
      {!issues.length && <p className={s.note}>No issues found by these checks: alt text on pictures and charts, a title on each slide, text size, and text contrast against a plain background. Text over pictures isn’t checked.</p>}
      <ul className={s.issues} style={{ maxHeight: 320, overflowY: 'auto' }}>
        {issues.map((i, k) => (
          <li key={k}>
            <button type="button" className={s.issue} onClick={() => setEditor({ slideId: i.slideId, railSel: [i.slideId], railAnchor: i.slideId, sel: i.objectId ? [i.objectId] : [], scope: null, editing: null })}>
              <Warning size={13} weight="fill" /><span><b>Slide {i.slideIndex + 1}</b> · {i.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function VersionsDialog({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null)
  useEffect(() => { void listVersions(deck.id).then(setVersions) }, [deck.id])
  const restore = (v: Version) => {
    const { slideId } = getEditor()
    transact(deck.id, v.slides, { label: 'Restore version', extra: { css: v.css, size: v.size }, selBefore: { slide: slideId!, ids: [] }, selAfter: { slide: v.slides[0]?.id ?? slideId!, ids: [] } })
    setEditor({ slideId: v.slides.some((x) => x.id === slideId) ? slideId : v.slides[0]?.id ?? null, sel: [] })
    onClose()
  }
  return (
    <Dialog title="Version history" width={560} onClose={onClose} actions={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <p className={s.note}>Copies kept in this browser while you edit, about every 10 minutes. Restoring can be undone.</p>
      {versions === null ? null : !versions.length ? <p className={s.note}>No earlier versions yet.</p> : (
        <ul className={s.versions}>
          {versions.map((v) => (
            <li key={v.id} className={s.version}>
              <DeckThumb deck={{ ...deck, slides: v.slides, css: v.css, size: v.size }} slide={0} className={s.versionThumb} />
              <span className={s.versionText}><b>{new Date(v.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</b><span>{v.count} slide{v.count === 1 ? '' : 's'} · {relTimeInline(v.at)}</span></span>
              <Button variant="secondary" onClick={() => restore(v)}>Restore</Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
