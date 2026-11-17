import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Development only. `/api` is forwarded to API_TARGET from frontend/.env (git-ignored). Empty or
// missing: a backend on this machine. (The deployed site's address is in vercel.json.)
//
//   API_TARGET=https://api.example.com
//
// When the target is another machine, the dev server drops the browser's `Origin` header (which
// would say http://localhost:5173). A deployed backend refuses origins that are not its own
// website, and accepts a request that carries none, exactly as it does behind its own proxy.
// The value never reaches the browser bundle (it is not a VITE_ variable).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = (env.API_TARGET || 'http://127.0.0.1:8000').trim().replace(/\/+$/, '')
  const remote = !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(target)
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
              if (remote) proxyReq.removeHeader('origin')
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
