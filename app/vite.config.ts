import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5180,
    strictPort: true,
    allowedHosts: ['leovm.tail53f5e9.ts.net', 'localhost'],
  },
})
