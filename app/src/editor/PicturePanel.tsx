// Picture (spec: Insert, image generation): from this device, or generated from a description with the
// picture model, optionally guided by reference pictures. The result previews first; Insert puts it on the
// slide like any picture.
import { ArrowsClockwise, ImageSquare, Plus, UploadSimple, X } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { ASPECTS, makePicture, pictureModel, type Aspect } from '../data/ai/images'
import { navigate } from '../lib/router'
import { Button, IconButton } from '../ui/Button'
import s from './PicturePanel.module.css'

const readUrl = (f: File) => new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(f) })

export function PicturePanel({ onFile, onPicture }: { onFile: () => void; onPicture: (dataUrl: string, name: string) => void }) {
  const model = pictureModel()
  const [prompt, setPrompt] = useState('')
  const [refs, setRefs] = useState<string[]>([])
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'working'; since: number } | { kind: 'done'; url: string } | { kind: 'failed'; message: string }>({ kind: 'idle' })
  const abort = useRef<AbortController | null>(null)
  const pick = useRef<HTMLInputElement>(null)
  const [, tick] = useState(0)
  useEffect(() => { if (state.kind !== 'working') return; const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t) }, [state.kind])
  useEffect(() => () => abort.current?.abort(), [])

  const go = async () => {
    if (!prompt.trim()) return
    abort.current?.abort()
    const ac = new AbortController(); abort.current = ac
    setState({ kind: 'working', since: Date.now() })
    try { setState({ kind: 'done', url: await makePicture({ prompt: prompt.trim(), references: refs, aspect, signal: ac.signal }) }) }
    catch (e) { if (!ac.signal.aborted) setState({ kind: 'failed', message: (e as Error).message }) }
  }

  return (
    <div className={s.panel}>
      <Button variant="secondary" icon={<UploadSimple size={15} />} onClick={onFile}>From this device…</Button>
      <div className={s.sep}><span>or generate</span></div>
      {!model ? (
        <p className={s.note}>To generate pictures, turn on a picture model (for example OpenAI’s gpt-image) with Choose models on your provider. <button type="button" className={s.link} onClick={() => navigate({ name: 'settings', section: 'ai' })}>Settings → AI</button></p>
      ) : state.kind === 'done' ? (
        <div className={s.result}>
          <img src={state.url} alt={prompt} className={s.preview} />
          <div className={s.row}>
            <Button variant="ghost" icon={<ArrowsClockwise size={14} />} onClick={() => void go()}>Try again</Button>
            <span className={s.spacer} />
            <Button variant="primary" onClick={() => onPicture(state.url, prompt.slice(0, 40))}>Insert</Button>
          </div>
        </div>
      ) : (
        <>
          <textarea data-autofocus className={s.area} rows={3} value={prompt} placeholder="Describe the picture…" aria-label="Describe the picture" onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void go() }} />
          <div className={s.refs} aria-label="Reference pictures">
            {refs.map((r, i) => <span key={i} className={s.ref}><img src={r} alt={`Reference ${i + 1}`} /><button type="button" aria-label="Remove reference" onClick={() => setRefs(refs.filter((_, j) => j !== i))}><X size={10} weight="bold" /></button></span>)}
            {refs.length < 4 && <IconButton label="Add a reference picture" size="sm" tone="fill" onClick={() => pick.current?.click()}><Plus size={14} /></IconButton>}
            <input ref={pick} type="file" accept="image/*" multiple hidden onChange={async (e) => { const fs = [...(e.target.files ?? [])].slice(0, 4 - refs.length); setRefs([...refs, ...(await Promise.all(fs.map(readUrl)))]); e.target.value = '' }} />
          </div>
          <div className={s.aspects} role="radiogroup" aria-label="Shape">
            {ASPECTS.map((a) => <button key={a} type="button" role="radio" aria-checked={aspect === a} className={s.aspect} onClick={() => setAspect(a)}>{a}</button>)}
          </div>
          {state.kind === 'failed' && <p className={s.error} role="alert">{state.message}</p>}
          <div className={s.row}>
            <span className={s.model}><ImageSquare size={13} /> {model.id}</span>
            <span className={s.spacer} />
            {state.kind === 'working'
              ? <Button variant="secondary" onClick={() => { abort.current?.abort(); setState({ kind: 'idle' }) }}>Generating… {Math.round((Date.now() - state.since) / 1000)}s · Stop</Button>
              : <Button variant="primary" disabled={!prompt.trim()} onClick={() => void go()}>Generate</Button>}
          </div>
        </>
      )}
    </div>
  )
}
