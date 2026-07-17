import { defineConfig, devices } from "@playwright/test";

/**
 * Browser e2e (tier 2) — drives the real deployed app in a browser, complementing
 * the API-level nightly journey. Target with E2E_BASE_URL (default: the deployed
 * app). Auth uses the dedicated e2e user; set E2E_PASSWORD to run (tests skip
 * without it, so the suite is safe to run anywhere).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "https://labelbee.tclab.org",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
