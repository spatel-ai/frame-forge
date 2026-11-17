// Settings shared by the global setup, the seed script and the tests. Everything can be
// overridden by an environment variable, so several worktrees can each run their own dev server
// (E2E_BASE_URL) and share one backend.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

export const E2E_DIR = resolve(here, '..')
export const FRONTEND_DIR = resolve(E2E_DIR, '..')
export const BACKEND_DIR = resolve(FRONTEND_DIR, '..', 'backend')
/** Git-ignored: login state, backend pid/log, the backend's data folder. */
export const STATE_DIR = resolve(E2E_DIR, '.state')
/** Git-ignored: screenshots, results.json, summary.md. */
export const RESULTS_DIR = resolve(E2E_DIR, 'results')

export const BASE_URL = (process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5171').replace(/\/+$/, '')
export const BACKEND_PORT = process.env.E2E_BACKEND_PORT ?? '8010'
export const BACKEND_LOG = process.env.E2E_BACKEND_LOG ?? resolve(STATE_DIR, 'backend.log')

/** The seeded customer. Fixed so every run and every worktree uses the same account. */
export const ACCOUNT = {
  name: 'Layout Tester',
  email: process.env.E2E_EMAIL ?? 'e2e-layout@example.com',
  password: process.env.E2E_PASSWORD ?? 'correct horse battery',
}

export const LOGIN_STATE = resolve(STATE_DIR, 'login.json')
export const SEED_STATE = resolve(STATE_DIR, 'seed-state.json')
