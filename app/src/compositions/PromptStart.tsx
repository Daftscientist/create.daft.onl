// Home's prompt (spec: Home): describe a presentation and Ream builds it, slide by slide, in a new deck with
// Ask open, so you watch it arrive and can steer it. Shown when a model is available (a provider, or the
// browser's own); otherwise a one-line pointer to Settings.
import { scoped } from '../data/accounts'
import { ArrowUp, Paperclip, Sparkle, X } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import type { Attachment } from '../data/ai/agent'
import { setPendingAsk } from '../data/ai/pending'
import { useActiveModel } from '../data/ai/settings'
import { newDeck, rename } from '../data/library'
import { navigate } from '../lib/router'
import { IconButton } from '../ui/Button'
import { ModelPicker, ReasoningPicker } from './ModelPicker'
import s from './PromptStart.module.css'

const IDEAS = ['A 6-slide pitch for a neighbourhood bakery', 'Quarterly results for a small SaaS team', 'An onboarding deck for new designers']

export function PromptStart() {
  const ready = !!useActiveModel()
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attachment[]>([])
  const picker = useRef<HTMLInputElement>(null)
  if (!ready) {
    return (
      <div className={s.off}>
        <Sparkle size={16} /> Ream can make a presentation from a description.
        <button type="button" className={s.link} onClick={() => navigate({ name: 'settings', section: 'ai' })}>Set up AI in Settings</button>
      </div>
    )
  }
  const start = () => {
    const prompt = text.trim()
    if (!prompt) return
    const id = newDeck(null)
    rename(id, prompt.split(/\s+/).slice(0, 6).join(' ').replace(/[.,;:!?]+$/, '').slice(0, 60) || 'New presentation', { quiet: true })
    setPendingAsk(id, { prompt, files, fresh: true })
    try { localStorage.setItem(scoped('ream.editor.column'), 'ask') } catch { /* ok */ }
    navigate({ name: 'deck', deckId: id })
  }
  const attach = async (list: FileList) => {
    const out: Attachment[] = []
    for (const f of [...list].slice(0, 8)) {
      const type = f.type || (/\.(md|txt|csv|json)$/i.test(f.name) ? 'text/plain' : 'application/octet-stream')
      const data = type.startsWith('text/') || /json|xml/.test(type) ? await f.text() : await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })
      out.push({ name: f.name, mediaType: type, data })
    }
    setFiles((x) => [...x, ...out])
  }
  return (
    <form className={s.box} onSubmit={(e) => { e.preventDefault(); start() }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
      onDrop={(e) => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); void attach(e.dataTransfer.files) } }}>
      <textarea className={s.area} value={text} rows={2} aria-label="Describe a presentation" placeholder="Describe a presentation and Ream will make it…"
        onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = `${Math.min(220, e.currentTarget.scrollHeight)}px` }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); start() } e.stopPropagation() }} />
      {files.length > 0 && <div className={s.files}>{files.map((f, i) => <span key={i} className={s.file}>{f.name}<button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><X size={10} weight="bold" /></button></span>)}</div>}
      <div className={s.row}>
        <IconButton label="Attach files" size="sm" tone="plain" type="button" onClick={() => picker.current?.click()}><Paperclip size={15} /></IconButton>
        <input ref={picker} type="file" multiple hidden accept="image/*,.pdf,.txt,.md,.csv,.json" onChange={(e) => { if (e.target.files) void attach(e.target.files); e.target.value = '' }} />
        <ModelPicker variant="chip" /><ReasoningPicker />
        <span className={s.spacer} />
        <IconButton label="Make the presentation" hint="↵" size="sm" tone="fill" type="submit" disabled={!text.trim()} className={s.go}><ArrowUp size={15} weight="bold" /></IconButton>
      </div>
      {!text && <div className={s.ideas}>{IDEAS.map((x) => <button key={x} type="button" className={s.idea} onClick={() => setText(x)}>{x}</button>)}</div>}
    </form>
  )
}
