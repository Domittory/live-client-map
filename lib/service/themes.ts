import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

export const createThemeSchema = z
  .object({
    clientId: uuid,
    name: z.string().trim().min(1).max(200),
    description: z.string().max(5000).nullable().optional(),
    domain: z.string().max(200).nullable().optional(),
  })
  .strict();

export const linkSignalSchema = z
  .object({
    themeId: uuid,
    signalId: uuid,
    relevanceScore: z.number().int().min(0).max(100).nullable().optional(),
    linkRationale: z.string().max(2000).nullable().optional(),
  })
  .strict();

/** Create a Theme and its AuditLog row in one transaction. */
export async function createTheme(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createThemeSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_theme",
    {
      p_org_id: organizationId,
      p_client_id: input.clientId,
      p_name: input.name,
      p_description: input.description ?? null,
      p_domain: input.domain ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to create theme",
    }
  );
}

/**
 * Link one Signal to a Theme. The link, the recomputed aggregates and the audit
 * row are one transaction: a failure leaves neither a link nor an audit entry.
 */
export async function linkSignal(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(linkSignalSchema, rawInput);

  await runAtomicRpc<void>(
    client,
    "link_theme_signal",
    {
      p_org_id: organizationId,
      p_theme_id: input.themeId,
      p_signal_id: input.signalId,
      p_relevance_score: input.relevanceScore ?? null,
      p_link_rationale: input.linkRationale ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to link signal",
    }
  );
}

export async function unlinkSignal(
  client: SupabaseClient,
  organizationId: string,
  themeId: string,
  signalId: string
): Promise<void> {
  await runAtomicRpc<void>(
    client,
    "unlink_theme_signal",
    {
      p_org_id: organizationId,
      p_theme_id: themeId,
      p_signal_id: signalId,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to unlink signal",
    }
  );
}

/**
 * Recompute theme aggregates only from confirmed evidence: approved signals
 * that are not AI-only hypotheses (SPEC §3.5). Rejected and pending signals
 * never increase counts. Runs inside one atomic RPC so the aggregates can never
 * be left half-updated.
 */
export async function recomputeThemeAggregates(
  client: SupabaseClient,
  themeId: string
): Promise<void> {
  await runAtomicRpc<void>(
    client,
    "recompute_theme_aggregates",
    { p_theme_id: themeId },
    {
      forbidden: "No write access to this client",
      failure: "Failed to recompute theme aggregates",
    }
  );
}
