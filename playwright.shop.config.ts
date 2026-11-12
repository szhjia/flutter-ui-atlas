import {defineConfig} from '@playwright/test';

export default defineConfig({
  outputDir: '.runtime/shop-test-results',
  testDir: 'tests/shop-browser',
  fullyParallel: false,
  workers: 1,
  timeout: 180000,
  expect: {timeout: 15000},
  use: {
    baseURL: 'http://127.0.0.1:60212',
    channel: 'chrome',
    headless: true,
    actionTimeout: 15000,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node tests/helpers/shop-server.mjs 60212',
    url: 'http://127.0.0.1:60212',
    reuseExistingServer: false
  },
  reporter: 'list'
});
