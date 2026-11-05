import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import { handleAuthCallback } from './cloud/oauth'

// /auth/callback is the sign-in window's landing page: hand the result back and stop. Nothing else
// (library, storage lock, UI) runs there.
void handleAuthCallback().then(async (handled) => {
  if (handled) return
  const { App } = await import('./App')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
