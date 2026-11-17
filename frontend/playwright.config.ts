// Browser layout checks for M3.5 (T-351). The suite never starts servers: point E2E_BASE_URL at a
// running dev server whose /api goes to a mock-mode backend. See e2e/README.md.
import { defineConfig } from '@playwright/test'
import { DEVICES, ENGINES } from './e2e/config/matrix.ts'
import { BASE_URL, RESULTS_DIR } from './e2e/support/env.ts'

export default defineConfig({
  testDir: './e2e/tests',
  outputDir: `${RESULTS_DIR}/pw-output`,
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  workers: Number(process.env.E2E_WORKERS ?? 3),
  timeout: 90_000,
  retries: 0,
  // One reporter: a dot per run on the terminal, then the summary. Faults are listed in results/summary.md.
  reporter: [['./e2e/reporter/summary.ts']],
  use: {
    baseURL: BASE_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    deviceScaleFactor: 1,
    // Transitions off, so a measurement never catches a dialog half-open.
    reducedMotion: 'reduce',
  },
  // Project name: <engine>-<width>, for example `--project=webkit-390`.
  projects: ENGINES.flatMap((engine) =>
    DEVICES.map((device) => ({
      name: `${engine}-${device.id}`,
      metadata: { engine, device },
      use: { browserName: engine, viewport: { width: device.width, height: device.height } },
    })),
  ),
})
