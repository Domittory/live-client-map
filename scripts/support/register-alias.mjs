import { register } from "node:module";

/**
 * Registers the ticket-20 resolver hooks (alias-loader.mjs) so a plain
 * `node --experimental-strip-types` process resolves `@/…` and extensionless
 * TypeScript imports exactly like the Next.js build does.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/support/register-alias.mjs scripts/reap-exports.ts
 */
register("./alias-loader.mjs", import.meta.url);
