// =============================================================================
// vite.config.js
//
// Vite configuration for River Song AI frontend.
//
// The dev server proxies both REST and WebSocket requests to the FastAPI
// backend so the frontend never needs to hardcode the backend port or
// deal with CORS during development.
//
// Proxy rules:
//   /health  -> http://localhost:8000/health   (REST health check)
//   /ws      -> ws://localhost:8000/ws         (WebSocket conversation)
//
// In production, serve the built frontend behind the same reverse proxy
// as the backend (e.g., nginx), and these proxy rules are no longer needed.
// =============================================================================

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  server: {
    port: 5173,
    proxy: {
      // All REST API endpoints
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      // WebSocket endpoint -- must use ws: target and ws: true
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
