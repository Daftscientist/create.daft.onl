// domOXML's normalized HTML carries per-node payloads (base64 JSON) beside the visible HTML, and its
// capture trusts a payload over what's on screen. When a node's text changes, its text payload no longer
// describes it, so it's dropped and the capture reads the real text. (The editor rewrites payloads
// precisely; this is the safety net for every other writer, e.g. the AI agent.)
const TEXT_PAYLOADS = ['data-domoxml-text-payload', 'data-domoxml-text-body']

function textByNode(root: ParentNode): Map<string, string> {
  const out = new Map<string, string>()
  for (const el of root.querySelectorAll<HTMLElement>('[data-domoxml-node-id]')) {
    const text = el.querySelector('.domoxml-text')
    if (text) out.set(el.dataset.domoxmlNodeId!, text.innerHTML)
  }
  return out
}

/** Returns `next` with stale text payloads removed (unchanged string when nothing is stale). */
export function dropStalePayloads(prev: string, next: string): string {
  if (prev === next || !next.includes('data-domoxml-text-payload')) return next
  const parse = (h: string) => new DOMParser().parseFromString(`<body>${h}</body>`, 'text/html').body
  const before = textByNode(parse(prev))
  const body = parse(next)
  let changed = false
  for (const el of body.querySelectorAll<HTMLElement>('[data-domoxml-text-payload]')) {
    const id = el.dataset.domoxmlNodeId
    const text = el.querySelector('.domoxml-text')
    if (id && text && before.get(id) !== text.innerHTML) {
      TEXT_PAYLOADS.forEach((a) => el.removeAttribute(a))
      changed = true
    }
  }
  return changed ? body.innerHTML : next
}
