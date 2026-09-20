import { expect, test } from "@playwright/test";
import { SERVICE_NAME, SERVICE_VERSION } from "../lib/health";

test("readiness endpoint reports this application's identity, build and database", async ({
  request,
}) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  const body = await response.json();

  expect(body.status).toBe("ok");
  expect(body.service).toBe(SERVICE_NAME);
  expect(body.version).toBe(SERVICE_VERSION);
  // Only the instance started by this harness knows the per-run build id, so
  // this proves the suite is talking to it and not to some other server.
  expect(body.build).toBe(process.env.E2E_RELEASE_ID);
  expect(body.database).toBe("ok");
  expect(JSON.stringify(body)).not.toMatch(/service_role|secret|password/i);
});

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveURL(/\/login/);
});
