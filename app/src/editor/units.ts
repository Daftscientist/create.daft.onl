// PowerPoint's units for X/Y/W/H: inches in the US, centimetres elsewhere (96px = 1in = 2.54cm).
// Fields accept any unit ("2.5cm", "1in", "40px", "12pt") and arithmetic ("120+40", "*2").
export type Unit = 'in' | 'cm'
export const localUnit = (): Unit => (/^en-(US|LR|MM)$/i.test(navigator.language) ? 'in' : 'cm')

const PX: Record<string, number> = { px: 1, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, pt: 96 / 72 }

export function formatLength(px: number, unit: Unit = localUnit()): string {
  const v = px / PX[unit]
  return `${(Math.round(v * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${unit}`
}

/** Parses a length (with arithmetic) into px. `current` is the value an operator-first input applies to. */
export function parseLength(input: string, current: number, unit: Unit = localUnit()): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '.')
  if (!s) return null
  const expr = /^[*/+-]/.test(s) ? `${current / PX[unit]}${unit}${s}` : s
  // Tokenize: numbers with an optional unit, and operators.
  const tokens = expr.match(/(\d*\.?\d+)\s*(px|in|cm|mm|pt|")?|[*/+\-()]/g)
  if (!tokens || tokens.join('').replace(/\s/g, '') !== expr.replace(/\s/g, '')) return null
  const vals = tokens.map((t) => {
    const m = /^(\d*\.?\d+)\s*(px|in|cm|mm|pt|")?$/.exec(t)
    if (!m) return t
    return String(parseFloat(m[1]) * PX[m[2] === '"' ? 'in' : m[2] ?? unit])
  })
  return evaluate(vals.join(''))
}

/** + - * / and parentheses over plain numbers (no eval). */
function evaluate(src: string): number | null {
  const t = src.match(/\d*\.?\d+(?:e[+-]?\d+)?|[*/+\-()]/g) ?? []
  let i = 0
  const num = (): number => {
    const x = t[i++]
    if (x === '(') { const v = sum(); i++; return v }
    if (x === '-') return -num()
    return parseFloat(x)
  }
  const prod = (): number => { let v = num(); while (t[i] === '*' || t[i] === '/') { const op = t[i++]; const r = num(); v = op === '*' ? v * r : v / r } return v }
  const sum = (): number => { let v = prod(); while (t[i] === '+' || t[i] === '-') { const op = t[i++]; const r = prod(); v = op === '+' ? v + r : v - r } return v }
  const v = sum()
  return i === t.length && Number.isFinite(v) ? v : null
}

export function parseNumber(input: string, current: number): number | null {
  const s = input.trim().replace(/,/g, '.').replace(/[°%]|pt/g, '')
  if (!s) return null
  const expr = /^[*/+-]/.test(s) ? `${current}${s}` : s
  if (!/^[\d.+\-*/() ]+$/.test(expr)) return null
  return evaluate(expr)
}
