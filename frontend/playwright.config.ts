import { defineConfig } from '@playwright/test';

const python = process.platform === 'win32' ? '.venv\\Scripts\\python.exe' : 'python';

/**
 * Browser tests against a real API and a throwaway PostgreSQL database (myterra_e2e, wiped on start).
 * Run: npx playwright test
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }], ['json', { outputFile: 'e2e-report/results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4300',
    channel: 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `${python} scripts/e2e_server.py`,
      cwd: '../backend',
      url: 'http://127.0.0.1:8011/api/health',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx ng serve --port 4300 --host 127.0.0.1 --proxy-config proxy.e2e.json',
      url: 'http://127.0.0.1:4300',
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
