// Runs once before the suite. Refuses to go on unless the backend behind BASE_URL is in mock mode,
// then logs the seeded account in (saved as the logged-in state) and finds the seeded videos.
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { call, login, SESSION_COOKIE } from './support/api.ts'
import { ACCOUNT, BASE_URL, LOGIN_STATE, SEED_STATE, STATE_DIR } from './support/env.ts'
import type { SeedState } from './config/screens.ts'

function abort(message: string): never {
  const line = '='.repeat(78)
  throw new Error(`\n${line}\nE2E ABORTED: ${message}\n${line}\n`)
}

export default async function globalSetup() {
  mkdirSync(STATE_DIR, { recursive: true })

  // 1. Mock-mode guard (D-021, Gate C). Nothing else runs before this passes.
  let config: { provider?: string; payments?: string }
  try {
    const { res, body } = await call('/api/v1/config')
    if (!res.ok || typeof body !== 'object') abort(`${BASE_URL}/api/v1/config answered ${res.status}. Is the dev server forwarding /api to the e2e backend?`)
    config = body
  } catch (e) {
    if (e instanceof Error && e.message.includes('E2E ABORTED')) throw e
    abort(`cannot reach ${BASE_URL} (${e instanceof Error ? e.message : e}). Start the dev server and the e2e backend (see e2e/README.md).`)
  }
  if (config.provider !== 'mock' || config.payments !== 'mock') {
    abort(
      `the backend behind ${BASE_URL} is NOT in mock mode (provider=${config.provider}, payments=${config.payments}). ` +
        'Nothing was run. This suite never talks to fal.ai or Razorpay.',
    )
  }

  // 2. Login state.
  const session = await login(ACCOUNT.email, ACCOUNT.password)
  if (!session) abort(`cannot log in as ${ACCOUNT.email}. Run e2e/scripts/e2e-backend.sh up to seed the account.`)
  const host = new URL(BASE_URL).hostname
  writeFileSync(
    LOGIN_STATE,
    JSON.stringify({
      cookies: [
        {
          name: SESSION_COOKIE, value: session.cookie, domain: host, path: '/',
          expires: Math.floor(Date.now() / 1000) + 28 * 86400, httpOnly: true, secure: false, sameSite: 'Lax',
        },
      ],
      origins: [],
    }),
  )

  // 3. Seeded videos, found by status.
  const { body } = await call('/api/v1/jobs?page_size=100', { headers: { cookie: `${SESSION_COOKIE}=${session.cookie}` } })
  const jobs: { id: string; status: string }[] = body?.items ?? []
  const pick = (status: string) => jobs.find((j) => j.status === status)?.id
  const reviewJobId = pick('audio_ready'), progressJobId = pick('video_generating')
  const finishedJobId = pick('completed'), failedJobId = pick('failed')
  if (!reviewJobId || !progressJobId || !finishedJobId || !failedJobId) {
    abort(`the account is missing seeded videos (found: ${jobs.map((j) => j.status).join(', ') || 'none'}). Run e2e/scripts/e2e-backend.sh up.`)
  }

  // 4. Seed state. (The reset-password-form screen needs no token from the backend: see config/screens.ts.)
  const seed: SeedState = { reviewJobId, progressJobId, finishedJobId, failedJobId }
  writeFileSync(SEED_STATE, JSON.stringify(seed))

  // 5. The "Mock mode" pill must be on screen for the logged-in account (frontend/CLAUDE.md).
  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ storageState: LOGIN_STATE })
    const page = await context.newPage()
    await page.goto(`${BASE_URL}/wallet`)
    try {
      await page.getByText(/Mock mode/).first().waitFor({ state: 'visible', timeout: 15_000 })
    } catch {
      abort('the "Mock mode" pill is not showing in the app. Stop: this may be the paid provider.')
    }
  } finally {
    await browser.close()
  }
  console.log(`[e2e] mock-mode guard passed at ${BASE_URL} (provider=mock, payments=mock, "Mock mode" pill visible)`)
}
