const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 8124);
const BASE_URL = process.env.E2E_BASE_URL || 'http://127.0.0.1:' + PORT;

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
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    },
  },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/e2e-server.mjs',
        url: BASE_URL + '/api/prices/',
        reuseExistingServer: true,
        timeout: 120000,
      },
});
