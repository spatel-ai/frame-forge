// One test per screen and project (engine x width). Inside, every check is reported separately
// (soft), so one run lists all the faults. Run one screen: E2E_SCREENS=wallet npm run e2e
import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { PHONE_BELOW } from '../config/matrix.ts'
import { SCREENS, type SeedState } from '../config/screens.ts'
import { CHECKS, measureBottom, measureTop, type CheckResult } from '../support/checks.ts'
import { LOGIN_STATE, RESULTS_DIR, SEED_STATE } from '../support/env.ts'

const only = (process.env.E2E_SCREENS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const screens = only.length ? SCREENS.filter((s) => only.includes(s.id)) : SCREENS
if (only.length && screens.length !== only.length) {
  throw new Error(`E2E_SCREENS names an unknown screen. Known: ${SCREENS.map((s) => s.id).join(', ')}`)
}

for (const screen of screens) {
  test.describe(screen.id, () => {
    test.use({ storageState: screen.auth ? LOGIN_STATE : { cookies: [], origins: [] } })

    test(`${screen.id}`, { tag: ['@s-' + screen.id, '@g-' + screen.group] }, async ({ page }, testInfo) => {
      const { engine, device } = testInfo.project.metadata as { engine: string; device: { id: string; width: number } }
      const seed = JSON.parse(readFileSync(SEED_STATE, 'utf8')) as SeedState
      const reason = screen.unavailable?.(seed)
      testInfo.annotations.push({ type: 'screen', description: screen.id })
      if (reason) {
        testInfo.annotations.push({ type: 'unavailable', description: reason })
        test.skip(true, reason)
      }
      const phone = device.width < PHONE_BELOW
      const opts = { phone, dialog: !!screen.dialog }
      const results: CheckResult[] = []

      await page.goto(screen.path(seed))
      // Hard guard on every logged-in screen: the paid provider must never be behind it.
      if (screen.auth) await expect(page.getByText(/Mock mode/).first()).toBeVisible({ timeout: 20_000 })

      let loadFailure: string | null = null
      try {
        await screen.ready(page, seed)
        await page.waitForTimeout(400) // fonts and transitions settle
      } catch (e) {
        loadFailure = `screen did not reach its ready state: ${String(e instanceof Error ? e.message : e).split('\n')[0]}`
      }

      results.push(...(await measureTop(page, opts)))
      const shot = `${RESULTS_DIR}/screenshots/${screen.id}/${engine}/${device.id}.png`
      await page.screenshot({ path: shot, fullPage: true })
      results.push(await measureBottom(page, opts))

      await testInfo.attach('checks', {
        body: JSON.stringify({ screen: screen.id, group: screen.group, engine, device: device.id, loadFailure, results }),
        contentType: 'application/json',
      })
      for (const r of results) {
        if (!r.applies) continue
        const title = CHECKS.find((c) => c.id === r.id)!.title
        expect.soft(r.offenders, `${title}: ${r.offenders.map((o) => `${o.selector} "${o.text}" ${o.size}${o.detail ? ` (${o.detail})` : ''}`).join('; ')}`).toEqual([])
      }
      expect.soft(loadFailure, 'ready state').toBeNull()
    })
  })
}
