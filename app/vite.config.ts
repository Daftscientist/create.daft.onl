import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const vendor = (p: string) => fileURLToPath(new URL(`./vendor/openui/${p}`, import.meta.url))

export default defineConfig({
  plugins: [react()],
  // OpenUI is vendored (vendor/openui/README.md): pinned files, no install scripts, devtools replaced by a no-op.
  resolve: {
    alias: {
      '@openuidev/react-lang': vendor('react-lang/index.mjs'),
      '@openuidev/lang-core': vendor('lang-core/index.mjs'),
      '@openuidev/observability': vendor('observability/index.mjs'),
      '@openuidev/devtools': vendor('devtools-stub/index.mjs'),
      'ci-info': vendor('devtools-stub/index.mjs'),
    },
  },
  // sqlite-wasm loads its .wasm relative to itself; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    allowedHosts: ['leovm.tail53f5e9.ts.net', 'localhost'],
  },
})
