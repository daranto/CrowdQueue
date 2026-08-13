import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:8091",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "iphone-webkit", use: { ...devices["iPhone 13"], browserName: "webkit" } },
    { name: "android-chromium", use: { ...devices["Pixel 7"], browserName: "chromium" } },
  ],
  webServer: {
    command: "NODE_ENV=test DEMO_MODE=true PORT=8091 HOST=127.0.0.1 DATABASE_PATH=./test-results/e2e.sqlite PUBLIC_BASE_URL=http://127.0.0.1:8091 LAN_BASE_URL=http://127.0.0.1:8091 node --experimental-sqlite dist-server/server/index.js",
    // Playwright unterstützt für den Bereitschafts-Poll keine eigenen Header.
    // Der echte /healthz-Endpunkt bleibt deshalb auch in Tests token-geschützt.
    url: "http://127.0.0.1:8091/",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
