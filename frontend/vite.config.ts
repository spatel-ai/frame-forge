import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Development only. By default `/api` goes to a backend on this machine. To run the local
// frontend against a deployed backend, put these two lines in frontend/.env.local (git-ignored):
//
//   API_TARGET=https://api.example.com        the deployed API
//   API_ORIGIN=https://your-site.example.com  the site address that API allows
//                                             (its AVATAR_ALLOWED_ORIGINS)
//
// The dev server then forwards `/api` there and presents API_ORIGIN as the request's origin, so
// the API's "other website" check accepts it. Neither value reaches the browser bundle (they
// are not VITE_ variables), and production builds ignore this file.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.API_TARGET || 'http://127.0.0.1:8000'
  const origin = env.API_ORIGIN
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (origin && proxyReq.getHeader('origin')) proxyReq.setHeader('origin', origin)
            })
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test-setup.ts'],
    },
  }
})
