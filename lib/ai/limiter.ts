/**
 * Per-organization application limits (docs/ai-contracts.md, Execution
 * policy): max 2 concurrent AI calls and max 10 calls/minute per org.
 * In-memory is sufficient for the single-instance dev/test deployment;
 * a multi-instance deployment must replace this with a shared store.
 */
export interface RateLimiter {
  acquire(orgId: string): boolean;
  release(orgId: string): void;
}

export interface RateLimitConfig {
  maxConcurrent: number;
  maxPerMinute: number;
}

export const DEFAULT_AI_RATE_LIMITS: RateLimitConfig = {
  maxConcurrent: 2,
  maxPerMinute: 10,
};

export function createInMemoryRateLimiter(
  config: RateLimitConfig = DEFAULT_AI_RATE_LIMITS
): RateLimiter {
  const state = new Map<string, { active: number; stamps: number[] }>();

  return {
    acquire(orgId) {
      const now = Date.now();
      const entry = state.get(orgId) ?? { active: 0, stamps: [] };
      entry.stamps = entry.stamps.filter((stamp) => now - stamp < 60_000);
      if (entry.active >= config.maxConcurrent || entry.stamps.length >= config.maxPerMinute) {
        state.set(orgId, entry);
        return false;
      }
      entry.active += 1;
      entry.stamps.push(now);
      state.set(orgId, entry);
      return true;
    },
    release(orgId) {
      const entry = state.get(orgId);
      if (entry) entry.active = Math.max(0, entry.active - 1);
    },
  };
}
