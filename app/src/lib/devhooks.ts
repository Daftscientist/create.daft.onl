// Development only: the app's own module instances for end-to-end tests (window.__ream).
import * as L from '../data/library'
import * as S from '../data/sync'
import * as P from '../data/prefs'
;(window as unknown as { __ream: unknown }).__ream = { L, S, P }
