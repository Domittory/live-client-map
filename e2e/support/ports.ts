import { execFileSync } from "node:child_process";
import net from "node:net";

/** The application's default development port (`pnpm dev`). */
export const DEFAULT_DEV_PORT = 3000;

/**
 * Dedicated port for the E2E application instance. It is deliberately not the
 * development port: a dev server (or any other process) already listening there
 * must never be mistaken for the instance under test.
 */
export const DEFAULT_E2E_PORT = 3100;

/**
 * A port counts as free only when nothing answers on it (IPv4 *and* IPv6) and a
 * fresh listener can bind it. The connect probes matter: Next binds `::`, so a
 * bind-only probe on 127.0.0.1 can wrongly report a squatted port as free.
 */
const PROBE_SCRIPT = `
const net = require("node:net");

function canConnect(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(300, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

function canBind(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    server.once("error", () => done(false));
    server.listen(port, "0.0.0.0", () => server.close(() => done(true)));
  });
}

(async () => {
  const start = Number(process.argv[1]);
  const attempts = Number(process.argv[2]);
  for (let port = start; port < start + attempts; port++) {
    const reachable = (await canConnect(port, "127.0.0.1")) || (await canConnect(port, "::1"));
    if (reachable) continue;
    if (await canBind(port)) {
      console.log(port);
      return;
    }
  }
  process.exit(3);
})();
`;

/** True when a TCP connection to `port` on `host` succeeds. */
function canConnect(port: number, host: string, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host });
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** True when nothing answers on `port` over IPv4 or IPv6 and it can be bound. */
export async function isPortFree(port: number): Promise<boolean> {
  const reachable = (await canConnect(port, "127.0.0.1")) || (await canConnect(port, "::1"));
  if (reachable) return false;

  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "0.0.0.0");
  });
}

/**
 * Resolve the port the E2E instance will listen on. Playwright loads its config
 * synchronously, so the probe runs in a short-lived child process.
 *
 * A busy preferred port is never reused: the scan moves to the next free port.
 * That is what makes a foreign process on the default development port (or a
 * stale server left on the E2E port) harmless instead of a false pass.
 */
export function chooseE2ePort(startPort: number = DEFAULT_E2E_PORT, attempts = 25): number {
  try {
    const output = execFileSync(
      process.execPath,
      ["-e", PROBE_SCRIPT, String(startPort), String(attempts)],
      {
        encoding: "utf8",
        env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      }
    );
    // Tolerate colour codes a child process may add to its stdout.
    const port = Number(output.replace(/\u001b\[[0-9;]*m/g, "").trim());
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`port probe returned ${JSON.stringify(output.trim())}`);
    }
    return port;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `No free port for the E2E application instance in range ${startPort}-${
        startPort + attempts - 1
      }: ${detail}. Stop the process holding those ports or set E2E_PORT.`
    );
  }
}
