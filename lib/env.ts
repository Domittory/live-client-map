import { z } from "zod";

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

const serverEnvSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  // AI gateway (ticket 32): server-only. Absent key => FakeAiProvider.
  OPENAI_API_KEY: z.string().min(1).optional(),
  AI_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
  AI_PRODUCTION_ENABLED: z.enum(["true", "false"]).default("false"),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Environment available to the browser (only NEXT_PUBLIC_* keys).
 * Never returns secrets.
 */
export function getClientEnv(): ClientEnv {
  return clientEnvSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}

/**
 * Server-only environment. Throws if required secrets are missing.
 * Never import this from client code — non-NEXT_PUBLIC_* vars are stripped
 * from client bundles by Next.js anyway.
 */
export function getServerEnv(): ServerEnv {
  return serverEnvSchema.parse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_DB_URL: process.env.SUPABASE_DB_URL,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_PRODUCTION_ENABLED: process.env.AI_PRODUCTION_ENABLED,
  });
}
