// Motion tokens (DESIGN.md §5).
import type { Transition } from 'motion/react'

export const snappy: Transition = { type: 'spring', stiffness: 560, damping: 40, mass: 0.9 }
export const gentle: Transition = { type: 'spring', stiffness: 280, damping: 34 }
export const fade: Transition = { duration: 0.12, ease: [0.2, 0.8, 0.2, 1] }
