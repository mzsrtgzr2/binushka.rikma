const fs = require('node:fs');
const { defineConfig } = require('@playwright/test');

/* A system chromium where one exists, playwright's own download otherwise. */
const CHROMIUM = process.env.CHROMIUM_PATH || (fs.existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);

/* The payment-callback run uses its own port so it can never reuse a server
 * started without the stub (reuseExistingServer would mask the missing env). */
const STUB = process.env.E2E_NOTIFY_STUB === '1';
const PORT = Number(process.env.E2E_PORT || (STUB ? 8125 : 8124));
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:' + PORT;
if (!process.env.E2E_BASE_URL) process.env.E2E_PORT = String(PORT);

module.exports = defineConfig({
  testDir: './e2e',
  timeout: 90000,
  expect: { timeout: 15000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/e2e-server.mjs',
        url: BASE_URL + '/api/prices/',
        reuseExistingServer: !STUB,
        timeout: 120000,
      },
});
