// Small, recognisable cloud-provider marks for connect buttons and provider cards.
import type { ProviderId } from '../data/sync'

export function ProviderMark({ id, size = 28 }: { id: ProviderId; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden style={{ flex: 'none' }}>
      <rect width="28" height="28" rx="7" fill="var(--fill)" />
      {id === 'dropbox' && (
        <g fill="#0061FE" transform="translate(5.5 6.5)">
          <path d="M4.3 0 0 2.8l4.3 2.8 4.3-2.8zM12.9 0 8.6 2.8l4.3 2.8 4.3-2.8zM0 8.4l4.3 2.8 4.3-2.8-4.3-2.8zM12.9 5.6 8.6 8.4l4.3 2.8 4.3-2.8zM4.3 12.1l4.3 2.8 4.3-2.8-4.3-2.8z" />
        </g>
      )}
      {id === 'google' && (
        <g transform="translate(5 6.5)">
          <path d="M6 0h6l6 10.4h-6z" fill="#FFBA00" />
          <path d="M6 0 0 10.4l3 5.2 6-10.4z" fill="#0F9D58" />
          <path d="M3 15.6h12l3-5.2H6z" fill="#4285F4" />
        </g>
      )}
      {id === 'onedrive' && (
        <path d="M11.4 10.2a5.2 5.2 0 0 1 9.4 2.5 3.6 3.6 0 0 1 .2 7.2H8.6a3.9 3.9 0 0 1-.9-7.7 4.8 4.8 0 0 1 3.7-2z" fill="#0364B8" />
      )}
    </svg>
  )
}
