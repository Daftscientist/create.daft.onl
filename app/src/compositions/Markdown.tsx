// Markdown for chat answers (spec: projects): paragraphs, headings, lists, quotes, code, bold, italic, inline code and
// links, rendered as React elements (never innerHTML), so half-streamed text is always safe and simply grows.
import type { ReactNode } from 'react'
import s from './Markdown.module.css'

type Block =
  | { kind: 'p' | 'quote'; text: string }
  | { kind: 'h'; level: number; text: string }
  | { kind: 'ul' | 'ol'; items: string[]; start: number }
  | { kind: 'code'; text: string }
  | { kind: 'hr' }

function blocks(src: string): Block[] {
  const out: Block[] = []
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      i++ // closing fence (absent while streaming: the block just ends)
      out.push({ kind: 'code', text: body.join('\n') })
      continue
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line)
    if (h) { out.push({ kind: 'h', level: h[1].length, text: h[2] }); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ kind: 'hr' }); i++; continue }
    const bullet = /^\s*[-*+]\s+/, number = /^\s*(\d+)[.)]\s+/
    if (bullet.test(line) || number.test(line)) {
      const ordered = number.test(line)
      const re = ordered ? number : bullet
      const items: string[] = []
      const start = ordered ? Number(number.exec(line)![1]) : 1
      while (i < lines.length && (re.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (re.test(lines[i])) items.push(lines[i].replace(re, ''))
        else items[items.length - 1] += ` ${lines[i].trim()}`
        i++
      }
      out.push({ kind: ordered ? 'ol' : 'ul', items, start })
      continue
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', text: body.join(' ') })
      continue
    }
    // Always takes at least this line, so the loop can never stall on something no rule above claimed.
    const para: string[] = [lines[i++]]
    while (i < lines.length && lines[i].trim() && !/^\s*(```|#{1,6}\s|[-*+]\s|\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++])
    out.push({ kind: 'p', text: para.join('\n') })
  }
  return out
}

/** Inline marks: `code`, **bold**, *italic* / _italic_, [text](https://…). Unclosed marks stay as typed. */
function inline(text: string, key = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  let last = 0, n = 0
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const k = `${key}-${n++}`
    if (m[1] !== undefined) out.push(<code key={k}>{m[1]}</code>)
    else if (m[2] !== undefined || m[3] !== undefined) out.push(<strong key={k}>{inline(m[2] ?? m[3], k)}</strong>)
    else if (m[4] !== undefined || m[5] !== undefined) out.push(<em key={k}>{inline(m[4] ?? m[5], k)}</em>)
    else out.push(<a key={k} href={m[7]} target="_blank" rel="noreferrer noopener">{m[6]}</a>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  // Single line breaks inside a paragraph are kept.
  return out.flatMap<ReactNode>((part, j) => (typeof part === 'string' ? part.split("\n").flatMap<ReactNode>((seg, k, all) => (k < all.length - 1 ? [seg, <br key={`${key}-br-${j}-${k}`} />] : [seg])) : [part]))
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={`${s.md} ${className ?? ''}`}>
      {blocks(text).map((b, i) => {
        switch (b.kind) {
          case 'p': return <p key={i}>{inline(b.text, `p${i}`)}</p>
          case 'quote': return <blockquote key={i}>{inline(b.text, `q${i}`)}</blockquote>
          case 'h': return <p key={i} className={s.h} role="heading" aria-level={Math.min(6, b.level + 2)}>{inline(b.text, `h${i}`)}</p>
          case 'ul': return <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, `u${i}-${j}`)}</li>)}</ul>
          case 'ol': return <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}>{inline(it, `o${i}-${j}`)}</li>)}</ol>
          case 'code': return <pre key={i}><code>{b.text}</code></pre>
          case 'hr': return <hr key={i} />
        }
      })}
    </div>
  )
}
