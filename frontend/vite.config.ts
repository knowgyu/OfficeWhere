import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const host = process.env.HOST || '127.0.0.1'
const backendPort = process.env.BACKEND_PORT || process.env.ODJ_PORT || '8765'
const frontendPort = Number(process.env.FRONTEND_PORT || process.env.VITE_PORT || 5173)
const backendUrl = process.env.VITE_BACKEND_URL || `http://${host}:${backendPort}`

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host,
    port: frontendPort,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: './dist',
  },
})
