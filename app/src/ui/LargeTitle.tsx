// Mobile large-title header (iOS convention): a big title that collapses into a solid bar with a
// small centred title once it scrolls away. Leading and trailing slots stay put.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import s from './LargeTitle.module.css'

export function LargeTitle({ title, leading, trailing, children }: { title: string; leading?: ReactNode; trailing?: ReactNode; children?: ReactNode }) {
  const sentinel = useRef<HTMLHeadingElement>(null)
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setCollapsed(!e.isIntersecting), { rootMargin: '-56px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <>
      <div className={s.bar} data-collapsed={collapsed || undefined}>
        <div className={s.side}>{leading}</div>
        <span className={s.small} aria-hidden={!collapsed}>{title}</span>
        <div className={`${s.side} ${s.trailing}`}>{trailing}</div>
      </div>
      <h1 ref={sentinel} className={s.large}>{title}</h1>
      {children}
    </>
  )
}
