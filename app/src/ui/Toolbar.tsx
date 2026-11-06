// A toolbar with one tab stop (ARIA toolbar pattern): ←/→ (and Home/End) move between its controls,
// except inside a text field, where the keys belong to the field. The last focused control keeps the stop.
import { forwardRef, useEffect, useImperativeHandle, useRef, type ReactNode } from 'react'

const items = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')]
  .filter((el) => !el.closest('[data-ream-layer]') && el.offsetParent !== null && el.closest('[data-toolbar]') === root)

export type ToolbarHandle = { focus: () => void }

export const Toolbar = forwardRef<ToolbarHandle, { label: string; className?: string; children: ReactNode; region?: string; inert?: boolean }>(
  function Toolbar({ label, className, children, region, inert }, handle) {
    const ref = useRef<HTMLDivElement>(null)
    const current = useRef<HTMLElement | null>(null)
    useImperativeHandle(handle, () => ({ focus: () => { const root = ref.current; if (root) (current.current && root.contains(current.current) ? current.current : items(root)[0])?.focus() } }))
    // Keep exactly one tab stop as controls come and go with the selection.
    useEffect(() => {
      const root = ref.current
      if (!root) return
      const sync = () => {
        const list = items(root)
        const stop = current.current && list.includes(current.current) ? current.current : list[0]
        for (const el of list) el.tabIndex = el === stop ? 0 : -1
      }
      sync()
      const mo = new MutationObserver(sync)
      mo.observe(root, { childList: true, subtree: true })
      return () => mo.disconnect()
    })
    return (
      <div
        ref={ref}
        role="toolbar"
        aria-label={label}
        data-toolbar=""
        data-region={region}
        className={className}
        inert={inert || undefined}
        onFocus={(e) => {
          const root = ref.current!
          const list = items(root)
          if (!list.includes(e.target as HTMLElement)) return
          current.current = e.target as HTMLElement
          for (const el of list) el.tabIndex = el === e.target ? 0 : -1
        }}
        onKeyDown={(e) => {
          const t = e.target as HTMLElement
          if (t instanceof HTMLInputElement && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return
          const list = items(ref.current!)
          const i = list.indexOf(t)
          if (i < 0) return
          const go = (k: number) => { e.preventDefault(); list[(k + list.length) % list.length]?.focus() }
          if (e.key === 'ArrowRight') go(i + 1)
          else if (e.key === 'ArrowLeft') go(i - 1)
          else if (e.key === 'Home' && !(t instanceof HTMLInputElement)) go(0)
          else if (e.key === 'End' && !(t instanceof HTMLInputElement)) go(list.length - 1)
        }}
      >
        {children}
      </div>
    )
  },
)
