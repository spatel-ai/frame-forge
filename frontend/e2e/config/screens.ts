// Every customer screen and dialog the checks open, in one place so later tasks can filter
// (`npx playwright test --grep "@wallet"` or by screen id). Tags are the screen id plus its group.
import type { Page } from '@playwright/test'

/** Ids found in the seeded account (see seed/seed.ts); filled in by the global setup. */
export type SeedState = {
  reviewJobId: string
  progressJobId: string
  finishedJobId: string
  failedJobId: string
}

export type Screen = {
  /** Folder name in the screenshots and the `--grep` handle. */
  id: string
  /** Where it appears in the summary. */
  group: 'auth' | 'app' | 'create' | 'dialog'
  /** Runs before the address is opened (for example, to route one network call). */
  prepare?: (page: Page) => Promise<void>
  /** The address to open. */
  path: (seed: SeedState) => string
  /** Logged-out screens run without the saved login. */
  auth: boolean
  /** Waits until the screen is really showing (not a skeleton), and opens a dialog if it is one. */
  ready: (page: Page, seed: SeedState) => Promise<void>
  /** True for screens whose checks are scoped to the open dialog. */
  dialog?: boolean
  /** Returns a reason to skip (shown in the summary), when the state cannot be reached. */
  unavailable?: (seed: SeedState) => string | null
  note?: string
}

const heading = (page: Page, name: string | RegExp) =>
  page.getByRole('heading', { name }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15_000 })

const text = (page: Page, t: string | RegExp) =>
  page.getByText(t).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 15_000 })

/** Waits for the page's skeletons and busy spinners to go. */
async function settled(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.locator('[aria-busy="true"]').first().waitFor({ state: 'detached', timeout: 15_000 }).catch(() => {})
}

async function openDialog(page: Page, opener: string | RegExp, title: string | RegExp, role: 'button' | 'radio' = 'button') {
  // A radio card hides its input; the visible label is what a customer taps.
  const target = role === 'radio' ? page.locator('label', { hasText: opener }).first() : page.getByRole(role, { name: opener }).first()
  await target.click()
  await page.getByRole('dialog').getByRole('heading', { name: title }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(300) // the dialog's opening animation
}

export const SCREENS: Screen[] = [
  // ---- auth (logged out) -------------------------------------------------------------------
  { id: 'login', group: 'auth', auth: false, path: () => '/login', ready: (p) => heading(p, /log in/i) },
  { id: 'signup', group: 'auth', auth: false, path: () => '/signup', ready: (p) => heading(p, /sign up|create your account|create account/i) },
  { id: 'forgot-password', group: 'auth', auth: false, path: () => '/forgot-password', ready: (p) => heading(p, /forgot|reset/i) },
  {
    id: 'forgot-password-sent', group: 'auth', auth: false, path: () => '/forgot-password',
    // The page needs the entered email in the router state (opened directly it goes back to the form).
    // Submitting the form would send a reset email each time and hit the backend's 3 an hour limit,
    // so the router state is set the way the form's own navigation sets it.
    ready: async (p) => {
      await heading(p, /forgot|reset/i)
      await p.evaluate(() => {
        window.history.pushState({ usr: { email: 'customer@example.com' }, key: 'e2e', idx: 1 }, '', '/forgot-password/sent')
        window.dispatchEvent(new PopStateEvent('popstate', { state: window.history.state }))
      })
      await heading(p, /check your email/i)
    },
    note: 'opened on the form, then moved to the sent page with the router state the form sets (no email is sent)',
  },
  {
    id: 'reset-password-expired', group: 'auth', auth: false, path: () => '/reset-password',
    ready: (p) => heading(p, /expired|invalid|link/i),
    note: 'no token: the "link expired" state',
  },
  {
    id: 'reset-password-form', group: 'auth', auth: false,
    path: () => '/reset-password?token=e2e-layout-check-token',
    // Only the token check is answered here (the form's own "For <email>" line); a real token is single use
    // and the backend allows three reset emails an hour, so a fresh one is not always available. The page,
    // form, validation and layout are the real ones; no email is sent and no password is changed.
    prepare: async (p) => {
      await p.route('**/api/v1/auth/password/reset/check', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ email: 'e2e-layout@example.com' }) }))
    },
    ready: async (p) => { await p.locator('input[type="password"]').first().waitFor({ state: 'visible', timeout: 15_000 }) },
    note: 'the reset-token check answer is shaped by Playwright routing (nothing else is faked)',
  },
  {
    id: 'verify-email-expired', group: 'auth', auth: false, path: () => '/verify-email',
    ready: (p) => heading(p, /expired|link|confirm/i),
    note: 'no token: the "link expired" state. The "confirmed" state needs a single-use token and is not covered',
  },

  // ---- app (logged in) ---------------------------------------------------------------------
  { id: 'home', group: 'app', auth: true, path: () => '/', ready: async (p) => { await settled(p); await text(p, /in progress|recent|create/i) } },
  { id: 'create', group: 'create', auth: true, path: () => '/create', ready: async (p) => { await heading(p, /photo/i); await settled(p) } },
  { id: 'create-review', group: 'create', auth: true, path: (s) => `/create/${s.reviewJobId}`, ready: async (p) => { await heading(p, /approve/i); await settled(p) }, note: 'voice ready, includes the banner picker section' },
  { id: 'create-progress', group: 'create', auth: true, path: (s) => `/create/${s.progressJobId}`, ready: async (p) => { await settled(p); await heading(p, /making your video/i) } },
  { id: 'create-finished', group: 'create', auth: true, path: (s) => `/create/${s.finishedJobId}`, ready: async (p) => { await settled(p); await text(p, /ready|download|finished/i) } },
  { id: 'create-failed', group: 'create', auth: true, path: (s) => `/create/${s.failedJobId}`, ready: async (p) => { await settled(p); await text(p, /went wrong|failed|could not|not made/i) } },
  { id: 'videos', group: 'app', auth: true, path: () => '/videos', ready: async (p) => { await heading(p, /videos/i); await settled(p) } },
  { id: 'video-detail', group: 'app', auth: true, path: (s) => `/videos/${s.finishedJobId}`, ready: async (p) => { await settled(p); await text(p, /download|created|script/i) } },
  { id: 'scripts', group: 'app', auth: true, path: () => '/scripts', ready: async (p) => { await heading(p, /scripts/i); await settled(p) } },
  { id: 'banners', group: 'app', auth: true, path: () => '/banners', ready: async (p) => { await heading(p, /banners/i); await settled(p) } },
  { id: 'wallet', group: 'app', auth: true, path: () => '/wallet', ready: async (p) => { await heading(p, /wallet|credits/i); await settled(p); await text(p, /grant|credits added|added/i) } },
  { id: 'account', group: 'app', auth: true, path: () => '/account', ready: async (p) => { await heading(p, /account/i); await settled(p) } },
  { id: 'not-found', group: 'app', auth: true, path: () => '/no-such-page', ready: (p) => heading(p, /not found|can.t find|404/i) },

  // ---- dialogs -----------------------------------------------------------------------------
  { id: 'scripts-new-dialog', group: 'dialog', dialog: true, auth: true, path: () => '/scripts', ready: async (p) => { await settled(p); await openDialog(p, /^new script$/i, /new script/i) } },
  { id: 'scripts-delete-dialog', group: 'dialog', dialog: true, auth: true, path: () => '/scripts', ready: async (p) => { await settled(p); await openDialog(p, /delete script/i, /delete this script/i) } },
  { id: 'banners-upload-dialog', group: 'dialog', dialog: true, auth: true, path: () => '/banners', ready: async (p) => { await settled(p); await openDialog(p, /^upload banner$/i, /upload banner/i) } },
  { id: 'banners-delete-dialog', group: 'dialog', dialog: true, auth: true, path: () => '/banners', ready: async (p) => { await settled(p); await openDialog(p, /delete banner/i, /delete this banner/i) } },
  { id: 'wallet-buy-dialog', group: 'dialog', dialog: true, auth: true, path: () => '/wallet', ready: async (p) => { await settled(p); await openDialog(p, /^buy credits$/i, /buy credits/i) } },
  {
    id: 'create-script-picker-dialog', group: 'dialog', dialog: true, auth: true, path: () => '/create',
    ready: async (p) => { await settled(p); await openDialog(p, /choose from my scripts/i, /choose from my scripts/i, 'radio') },
  },
  {
    id: 'create-banner-picker', group: 'dialog', auth: true, path: (s) => `/create/${s.reviewJobId}`,
    ready: async (p) => { await heading(p, /choose a banner/i); await settled(p) },
    note: 'today the banner picker is a section of the review screen, not a dialog; this entry becomes a dialog entry if a later task makes it one',
  },
]
