// Child layers: a colour popover, menu or dialog opened from inside a Popover registers with it through React
// context (which crosses portals), so clicks in it don't dismiss the parent. Any other surface does.
import { createContext, useContext, useEffect, type RefObject } from 'react'

export type RegisterLayer = (el: HTMLElement) => () => void
export const LayerContext = createContext<RegisterLayer | null>(null)

/** Registers `ref`'s element as a child of the nearest Popover while it's mounted. */
export function useChildLayer(ref: RefObject<HTMLElement | null>) {
  const register = useContext(LayerContext)
  useEffect(() => { const el = ref.current; if (register && el) return register(el) }, [register, ref])
}
