import { existsSync, readFileSync } from "node:fs";
import { isPortFree } from "./support/ports";
import { assertServiceIdentity, describeOccupant, fetchHealth } from "./support/service-identity";

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** Supabase URL from the environment, falling back to the local .env.local. */
function supabaseUrl(): string | undefined {
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) return process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!existsSync(".env.local")) return undefined;

  const match = readFileSync(".env.local", "utf8").match(
    /^\s*NEXT_PUBLIC_SUPABASE_URL\s*=\s*(.+?)\s*$/m
  );
  return match?.[1].replace(/^["']|["']$/g, "");
}

/**
 * E2E preflight (ticket 02).
 *
 * Guarantees the browser suite can only run against a local Supabase instance
 * and an application instance this harness started, on a dedicated port, with a
 * matching build id. A foreign process — or a remote Supabase project — produces
 * an explicit diagnostic instead of a false pass.
 *
 * Depending on the Playwright version, this runs directly before or after the
 * configured webServer starts, so an occupied port is accepted only when it
 * answers with the expected build identity.
 */
export default async function globalSetup(): Promise<void> {
  const url = supabaseUrl();
  if (!url) {
    throw new Error(
      "E2E needs a local Supabase environment: .env.local is missing and " +
        "NEXT_PUBLIC_SUPABASE_URL is not set. Run `supabase start` first."
    );
  }

  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${JSON.stringify(url)}`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `E2E refuses to run against a non-local Supabase host (${host}). ` +
        "Browser tests may only touch the local development instance."
    );
  }

  const port = Number(process.env.E2E_APP_PORT ?? "");
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("playwright.config.ts did not resolve E2E_APP_PORT");
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  if (await isPortFree(port)) return;

  try {
    const health = await fetchHealth(baseUrl, 5_000);
    assertServiceIdentity(health, { build: process.env.E2E_RELEASE_ID });
  } catch {
    const occupant = await describeOccupant(baseUrl);
    throw new Error(
      `E2E port ${port} is already in use by ${occupant}. ` +
        "The harness never reuses an existing server; stop that process or set E2E_PORT."
    );
  }
}
