import http from "node:http";
import net, { type AddressInfo, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import globalSetup from "@/e2e/global-setup";
import { chooseE2ePort, DEFAULT_DEV_PORT, DEFAULT_E2E_PORT, isPortFree } from "@/e2e/support/ports";
import {
  assertServiceIdentity,
  describeOccupant,
  fetchHealth,
} from "@/e2e/support/service-identity";
import { SERVICE_NAME } from "@/lib/health";

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()));
});

/** Bind a server to a free port and track its sockets so cleanup never hangs. */
function listen(server: net.Server | http.Server, host = "127.0.0.1"): Promise<TestServer> {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  return new Promise((resolve) => {
    server.listen(0, host, () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            sockets.clear();
            server.close(() => done());
          }),
      });
    });
  });
}

/** An unrelated service that happens to answer on /api/health. */
function foreignService(payload: Record<string, unknown>): http.Server {
  return http.createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(payload));
  });
}

describe("E2E port isolation", () => {
  it("never uses the default development port for the E2E instance", () => {
    expect(DEFAULT_E2E_PORT).not.toBe(DEFAULT_DEV_PORT);
  });

  it("skips a busy port instead of reusing the process that holds it", async () => {
    const occupant = await listen(net.createServer());
    cleanups.push(occupant.close);

    const chosen = chooseE2ePort(occupant.port, 5);

    expect(chosen).not.toBe(occupant.port);
    expect(await isPortFree(chosen)).toBe(true);
  });

  it("keeps the configured port when it is free", async () => {
    const released = await listen(net.createServer());
    await released.close();

    expect(chooseE2ePort(released.port, 5)).toBe(released.port);
  });

  it("treats an IPv6-only listener as busy", async () => {
    // Next binds `::`; a bind-only probe on 127.0.0.1 would call this port free
    // and let Playwright talk to a stale server.
    const occupant = await listen(net.createServer(), "::1");
    cleanups.push(occupant.close);

    expect(await isPortFree(occupant.port)).toBe(false);
    expect(chooseE2ePort(occupant.port, 3)).not.toBe(occupant.port);
  });
});

describe("service identity verification", () => {
  it("accepts this application with the expected build", async () => {
    const server = await listen(
      foreignService({
        status: "ok",
        service: SERVICE_NAME,
        version: "0.1.0",
        build: "run-42",
        database: "ok",
      })
    );
    cleanups.push(server.close);

    const health = await fetchHealth(`http://127.0.0.1:${server.port}`);

    expect(health.service).toBe(SERVICE_NAME);
    expect(() => assertServiceIdentity(health, { build: "run-42" })).not.toThrow();
  });

  it("rejects a different service on the same readiness path", async () => {
    const server = await listen(
      foreignService({
        status: "ok",
        service: "unrelated-app",
        version: "9.9.9",
        build: "other",
        database: "ok",
      })
    );
    cleanups.push(server.close);
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const health = await fetchHealth(baseUrl);

    expect(() => assertServiceIdentity(health, { build: "run-42" })).toThrow(
      /Service identity mismatch/
    );
    expect(await describeOccupant(baseUrl)).toContain("unrelated-app");
  });

  it("rejects the same application running a different build", async () => {
    const server = await listen(
      foreignService({
        status: "ok",
        service: SERVICE_NAME,
        version: "0.1.0",
        build: "stale-run",
        database: "ok",
      })
    );
    cleanups.push(server.close);

    const health = await fetchHealth(`http://127.0.0.1:${server.port}`);

    expect(() => assertServiceIdentity(health, { build: "run-42" })).toThrow(
      /Build identity mismatch/
    );
  });

  it("describes an occupant that does not speak the readiness contract", async () => {
    const server = await listen(net.createServer());
    cleanups.push(server.close);

    expect(await describeOccupant(`http://127.0.0.1:${server.port}`, 300)).toMatch(
      /unidentified process/
    );
  });
});

describe("E2E preflight environment", () => {
  const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const originalPort = process.env.E2E_APP_PORT;
  const originalRelease = process.env.E2E_RELEASE_ID;

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
    if (originalPort === undefined) delete process.env.E2E_APP_PORT;
    else process.env.E2E_APP_PORT = originalPort;
    if (originalRelease === undefined) delete process.env.E2E_RELEASE_ID;
    else process.env.E2E_RELEASE_ID = originalRelease;
  });

  it("refuses to run against a non-local Supabase host", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://production-project.supabase.co";
    process.env.E2E_APP_PORT = String(DEFAULT_E2E_PORT);

    await expect(globalSetup()).rejects.toThrow(/non-local Supabase host/);
  });

  it("accepts an instance answering with the expected build identity", async () => {
    // Starting the harness's own webServer is outside a unit test, so stand in
    // for it: an occupied port is accepted only when the readiness contract
    // reports the build id this run expects.
    const server = await listen(
      foreignService({
        status: "ok",
        service: SERVICE_NAME,
        version: "0.1.0",
        build: "run-42",
        database: "ok",
      })
    );
    cleanups.push(server.close);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.E2E_APP_PORT = String(server.port);
    process.env.E2E_RELEASE_ID = "run-42";

    await expect(globalSetup()).resolves.toBeUndefined();
  });

  it("refuses an instance that reports a different build", async () => {
    const server = await listen(
      foreignService({
        status: "ok",
        service: SERVICE_NAME,
        version: "0.1.0",
        build: "stale-run",
        database: "ok",
      })
    );
    cleanups.push(server.close);

    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.E2E_APP_PORT = String(server.port);
    process.env.E2E_RELEASE_ID = "run-42";

    await expect(globalSetup()).rejects.toThrow(/already in use/);
  });
});
