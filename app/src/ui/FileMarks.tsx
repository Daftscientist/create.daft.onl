// Format marks for one-click downloads. A PowerPoint-style tile (orange, "P" plate) and an HTML tile.
// These are faithful format badges, not Microsoft's trademarked logo (DESIGN.md §3 Colour note).
import { useId, type SVGProps } from 'react'

export function PptxMark(props: SVGProps<SVGSVGElement>) {
  const g = 'ppt' + useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden {...props}>
      <defs>
        <linearGradient id={g} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F07A4F" />
          <stop offset="1" stopColor="#C8401C" />
        </linearGradient>
      </defs>
      <rect x="5" y="2" width="17" height="20" rx="3.5" fill={`url(#${g})`} />
      <circle cx="16.5" cy="9.5" r="3.6" fill="#fff" opacity=".28" />
      <rect x="2" y="6" width="12" height="12" rx="2.6" fill="#B33A17" />
      <path d="M6 15V9h2.6a1.9 1.9 0 0 1 0 3.8H6" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function HtmlMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden {...props}>
      <rect x="2.5" y="2.5" width="19" height="19" rx="4.2" fill="#1F2430" stroke="rgb(255 255 255 / .16)" />
      <path d="m9 8.5-3.5 3.5L9 15.5M15 8.5l3.5 3.5-3.5 3.5" fill="none" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m13 7.5-2 9" stroke="#7FB2FF" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function DeckGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden {...props}>
      <rect x="2.5" y="5" width="19" height="13" rx="2.5" fill="var(--deck)" />
      <rect x="5.5" y="8.5" width="8" height="2" rx="1" fill="#fff" />
      <rect x="5.5" y="12.2" width="5" height="1.6" rx=".8" fill="#fff" opacity=".7" />
    </svg>
  )
}
