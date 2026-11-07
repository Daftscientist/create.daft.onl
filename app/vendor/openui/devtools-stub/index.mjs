// Ream: @openuidev/devtools is replaced by this no-op. The real package auto-mounts in development and loads an
// unpinned script from jsDelivr into the app's origin (where provider API keys live). See vendor/openui/README.md.
export function OpenUIDevtools() { return null }
export default OpenUIDevtools
