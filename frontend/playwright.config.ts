import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  globalSetup: './tests/e2e/global-setup.ts',
  // Backend cold start can take ~5–15s on a fresh runner before /api/health
  // returns. The fixture polls for boot inside this budget.
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  // Keep the suite serial. Each Electron worker spawns its own backend, which
  // means parallel workers each open a Python process and an isolated DB.
  // For a small Tier 1+2 suite, single-worker is simpler and avoids races.
  workers: 1,
  fullyParallel: false,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list']],
  use: {
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
})
