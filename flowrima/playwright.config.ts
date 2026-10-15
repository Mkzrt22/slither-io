import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// Same env as the app (service key + webhook secret are needed by flow.spec.ts).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

/**
 * End-to-end tests. They expect the app running on BASE_URL (default
 * http://localhost:3000) against a local Supabase (`npx supabase start`) with
 * LLM_PROVIDER=mock. See docs/TESTING.md.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    // Optional: reuse a system Chromium (CI images with preinstalled browsers)
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  },
  projects: [
    { name: "mobile-375", use: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 }, defaultBrowserType: "chromium" } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testMatch: /marketing\.spec\.ts/ },
  ],
});
