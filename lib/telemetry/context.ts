import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Request-scoped telemetry context (ticket 62). Holds the correlation id for the
 * current request so every log/metric emitted during it is traceable to one
 * safe, random identifier — never an org/client id.
 */
export interface TelemetryContext {
  correlationId: string | undefined;
}

export const telemetryContext = new AsyncLocalStorage<TelemetryContext>();

export function getCorrelationId(): string | undefined {
  return telemetryContext.getStore()?.correlationId;
}

/** Run `fn` inside a fresh telemetry context with the given correlation id. */
export function runWithCorrelationId<T>(correlationId: string, fn: () => Promise<T>): Promise<T> {
  return telemetryContext.run({ correlationId }, fn);
}
