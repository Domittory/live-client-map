/**
 * Module resolver for standalone Node entries (ticket 20).
 *
 * The Next.js build and Vitest resolve TypeScript with the `@/*` path alias and
 * bundler-style extensionless imports, but a plain `node scripts/….ts` process
 * knows neither. This loader teaches the Node ESM resolver those two rules so the
 * retention CLI imports the real service module instead of re-implementing it.
 *
 * Usage:
 *   node --experimental-strip-types --import ./scripts/support/register-alias.mjs scripts/reap-exports.ts
 *
 * It resolves module specifiers only. It reads no file and changes no project
 * state, so it is safe to load in any environment.
 */
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** `<repo root>/scripts/support` → `<repo root>`. */
const workspaceRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A specifier that names a file, not a directory: `./errors`, `@/lib/telemetry`. */
const EXTENSIONLESS = /(^|\/)[^./]+$/;

/** Try each candidate in order and return the first one Node can resolve. */
async function firstResolvable(candidates, context, nextResolve) {
  let lastError;
  for (const candidate of candidates) {
    try {
      return await nextResolve(candidate, context);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function resolve(specifier, context, nextResolve) {
  // Already-resolved URLs and node: builtins need no help — and must not be
  // rewritten, because appending `.ts` to `file:///…/x.mjs` breaks it.
  if (specifier.includes(":")) {
    return nextResolve(specifier, context);
  }

  if (specifier.startsWith("@/")) {
    const target = pathToFileURL(join(workspaceRoot, specifier.slice(2))).href;
    return firstResolvable([target, `${target}.ts`, `${target}/index.ts`], context, nextResolve);
  }

  if (specifier.startsWith("./") || specifier.startsWith("../") || isAbsolute(specifier)) {
    if (EXTENSIONLESS.test(specifier)) {
      const base = specifier;
      return firstResolvable(
        [base, `${base}.ts`, `${base}.mjs`, `${base}/index.ts`],
        context,
        nextResolve
      );
    }
  }

  return nextResolve(specifier, context);
}
