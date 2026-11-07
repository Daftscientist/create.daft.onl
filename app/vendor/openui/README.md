# OpenUI (vendored)

Pinned copies of OpenUI's built files (MIT, Thesys), used for interactive answers (docs/design/specs/generative-ui.md).
Vendored instead of installed from npm so nothing runs at install time: `@openuidev/lang-core`'s postinstall sends
installation telemetry to PostHog, and `.npmrc` can't switch that off.

| Folder | Package | Version | Files |
|---|---|---|---|
| `lang-core/` | @openuidev/lang-core | 1.1.0 | dist/index.mjs, index.d.mts, shared-tgSjXCMf.mjs, LICENSE |
| `react-lang/` | @openuidev/react-lang | 1.1.0 | dist/index.mjs, index.d.mts, LICENSE |
| `observability/` | @openuidev/observability | 0.0.4 | dist/index.mjs, index.d.mts, LICENSE (a local event bus, no network) |
| `devtools-stub/` | replaces @openuidev/devtools | — | no-op (the real one loads a remote script in development) |

Wired by aliases in `vite.config.ts` and `paths` in `tsconfig.app.json`.

## Patches
- `lang-core/shared-tgSjXCMf.mjs`: `isRuntimeTelemetryEnabled()` returns `false`. (Runtime telemetry is opt-in upstream
  and already skips browsers; this makes it impossible anywhere, including Node test runs.)

- `react-lang/index.mjs`: the development devtools auto-mount block is removed, and libraries aren't published to
  the global registry/observability bus. (Also avoids `process.env` in the browser.)

## Updating
Download the new tarballs with `npm pack` (no install), copy the same files, re-apply the patch, and run the golden
corpus of saved blocks before committing.
