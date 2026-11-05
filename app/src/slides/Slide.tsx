// Renders one sample slide. Sizes are in container-query units so the same markup is crisp as a
// 48px list thumbnail or a full-screen Quick Look. In the engine phase this becomes domOXML's HTML.
import type { CSSProperties } from 'react'
import type { SlideSpec, SlideTheme } from '../data/types'
import s from './Slide.module.css'

export function Slide({ spec, theme, className }: { spec: SlideSpec; theme: SlideTheme; className?: string }) {
  const style = {
    '--bg': theme.bg, '--fg': theme.fg, '--muted': theme.muted, '--accent': theme.accent, '--surface': theme.surface,
  } as CSSProperties
  return (
    <div className={`${s.slide} ${theme.serif ? s.serif : ''} ${className ?? ''}`} style={style} aria-hidden>
      <div className={s.inner}>{body(spec)}</div>
    </div>
  )
}

function body(spec: SlideSpec) {
  switch (spec.kind) {
    case 'title':
      return (
        <div className={s.title}>
          {spec.eyebrow && <span className={s.eyebrow}>{spec.eyebrow}</span>}
          <h1>{spec.title}</h1>
          {spec.subtitle && <p>{spec.subtitle}</p>}
          <i className={s.rule} />
        </div>
      )
    case 'section':
      return (
        <div className={s.section}>
          <span>{spec.index}</span>
          <h1>{spec.title}</h1>
        </div>
      )
    case 'bullets':
      return (
        <div className={s.bullets}>
          <h2>{spec.title}</h2>
          <ol>{spec.items.map((it) => <li key={it}>{it}</li>)}</ol>
        </div>
      )
    case 'stat':
      return (
        <div className={s.stat}>
          <strong>{spec.value}</strong>
          <p>{spec.label}</p>
          {spec.note && <span>{spec.note}</span>}
        </div>
      )
    case 'chart': {
      const max = Math.max(...spec.bars)
      return (
        <div className={s.chart}>
          <h2>{spec.title}</h2>
          <div className={s.bars}>
            {spec.bars.map((v, i) => (
              <div key={i} className={s.bar} data-hi={i === spec.highlight || undefined}>
                <em>{v.toLocaleString()}</em>
                <i style={{ height: `${(v / max) * 100}%` }} />
                <span>{spec.labels[i]}</span>
              </div>
            ))}
          </div>
        </div>
      )
    }
    case 'quote':
      return (
        <figure className={s.quote}>
          <blockquote>“{spec.text}”</blockquote>
          <figcaption>{spec.by}</figcaption>
        </figure>
      )
    case 'split':
      return (
        <div className={s.split}>
          <div>
            {spec.tag && <span className={s.tag}>{spec.tag}</span>}
            <h2>{spec.title}</h2>
          </div>
          <p>{spec.body}</p>
        </div>
      )
    case 'grid':
      return (
        <div className={s.grid}>
          <h2>{spec.title}</h2>
          <dl>
            {spec.cells.map((c) => (
              <div key={c.label}><dt>{c.label}</dt><dd>{c.value}</dd></div>
            ))}
          </dl>
        </div>
      )
  }
}
