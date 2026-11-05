// Preview features (not in normal navigation until they really work). Enable with ?preview=<name>;
// remembered for this browser session.
export function isPreview(name: string): boolean {
  try {
    const q = new URLSearchParams(location.search).get('preview')
    if (q) sessionStorage.setItem(`ream.preview.${q}`, '1')
    return sessionStorage.getItem(`ream.preview.${name}`) === '1'
  } catch {
    return false
  }
}
