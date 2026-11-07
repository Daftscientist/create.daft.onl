// A project just made opens with its name ready to type (spec: projects). Read by the page that shows it; kept a
// moment (not cleared on first read) so React's doubled first render in development sees it too.
let next: string | null = null
export const renameOnArrival = (id: string) => { next = id; setTimeout(() => { if (next === id) next = null }, 1500) }
export const takeRenameOnArrival = (id: string): boolean => next === id
