// Public OAuth client IDs (no secrets: every provider uses PKCE or a public browser client).
export const CLOUD = {
  dropbox: { appKey: 'b461estyzmw5fbt' },
  google: { clientId: '771379096205-euqrdks0h9fdunq8fe3ug2g2usni3qfr.apps.googleusercontent.com' },
  onedrive: { clientId: 'acf7cefd-ee1f-4b57-be03-270757b7b854' },
} as const

/** Registered with Dropbox and Microsoft for this origin (dev tailnet HTTPS and production). */
export const redirectUri = () => `${location.origin}/auth/callback`
