import { defineConfig, devices } from "@playwright/test";
import { DEFAULT_E2E_PORT, chooseE2ePort } from "./e2e/support/ports";

/**
 * E2E harness (ticket 02).
 *
 * - the application instance runs on its own port, never the development port;
 * - a busy port is never reused: the harness moves to the next free port;
 * - `reuseExistingServer: false` in every environment, so CI and local runs
 *   behave the same and an unknown server can never be mistaken for this app;
 * - every run passes a unique RELEASE_ID, and the readiness checks compare it
 *   against the payload the server reports.
 *
 * The port and build id are resolved once and cached in the environment:
 * Playwright loads this config in the runner *and* in every worker process, and
 * re-probing in a worker would observe the already running E2E server as "busy"
 * and silently point that worker at a different port.
 */
function resolvePort(): number {
  const cached = Number(process.env.E2E_APP_PORT ?? "");
  if (Number.isInteger(cached) && cached > 0) return cached;

  const port = chooseE2ePort(Number(process.env.E2E_PORT ?? DEFAULT_E2E_PORT));
  process.env.E2E_APP_PORT = String(port);
  return port;
}

function resolveReleaseId(): string {
  const releaseId =
    process.env.E2E_RELEASE_ID ?? process.env.RELEASE_ID ?? `e2e-${Date.now().toString(36)}`;
  process.env.E2E_RELEASE_ID = releaseId;
  return releaseId;
}

const port = resolvePort();
const releaseId = resolveReleaseId();
const baseUrl = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
  },
  webServer: {
    command: `pnpm dev --port ${port} --hostname 127.0.0.1`,
    url: `${baseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { ...(process.env as Record<string, string>), RELEASE_ID: releaseId },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
