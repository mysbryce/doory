import { defineConfig, devices } from '@playwright/test'

/** Run local web/API plus backend/apps/ai/tests/provider_server.py; see docs/ai-assistant.md. */
export default defineConfig({
  testDir: './e2e/ai',
  timeout: 90_000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
})
