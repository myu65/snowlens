import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3001", trace: "retain-on-failure" },
  webServer: {
    command: "npm start -- --port 3001",
    url: "http://127.0.0.1:3001",
    reuseExistingServer: false,
    env: { SNOWLENS_MODE: "mock", SNOWLENS_MOCK_FILE: ".snowlens-e2e.json" },
    timeout: 60000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/setup.ts",
  globalTeardown: "./e2e/teardown.ts",
});
