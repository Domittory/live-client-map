import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
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

export async function createTheme(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<string> {
  const input = validate(createThemeSchema, rawInput);
  const { data, error } = await client
    .from("themes")
    .insert({
      organization_id: organizationId,
      client_id: input.clientId,
      name: input.name,
      description: input.description ?? null,
      domain: input.domain ?? null,
      first_seen_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create theme");
  }
  await recordAudit(client, {
    organizationId,
    entityType: "theme",
    entityId: data.id,
    action: "theme.created",
    after: { name: input.name },
  });
  return data.id;
}

export async function linkSignal(
  client: SupabaseClient,
  organizationId: string,
  rawInput: unknown
): Promise<void> {
  const input = validate(linkSignalSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { error } = await client.from("signal_theme_links").insert({
    signal_id: input.signalId,
    theme_id: input.themeId,
    relevance_score: input.relevanceScore ?? null,
    link_rationale: input.linkRationale ?? null,
    created_by: user?.id ?? null,
  });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to link signal");

  await recordAudit(client, {
    organizationId,
    entityType: "signal_theme_link",
    entityId: input.themeId,
    action: "theme.signal_linked",
    after: { signal_id: input.signalId },
  });

  await recomputeThemeAggregates(client, input.themeId);
}

export async function unlinkSignal(
  client: SupabaseClient,
  organizationId: string,
  themeId: string,
  signalId: string
): Promise<void> {
  const { error } = await client
    .from("signal_theme_links")
    .delete()
    .eq("theme_id", themeId)
    .eq("signal_id", signalId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to unlink signal");

  await recordAudit(client, {
    organizationId,
    entityType: "signal_theme_link",
    entityId: themeId,
    action: "theme.signal_unlinked",
    after: { signal_id: signalId },
  });

  await recomputeThemeAggregates(client, themeId);
}

/**
 * Recompute theme aggregates only from confirmed evidence: approved signals
 * that are not AI-only hypotheses (SPEC §3.5). Rejected and pending signals
 * never increase counts.
 */
export async function recomputeThemeAggregates(
  client: SupabaseClient,
  themeId: string
): Promise<void> {
  const { data: links } = await client
    .from("signal_theme_links")
    .select("signal_id")
    .eq("theme_id", themeId);
  const signalIds = (links ?? []).map((l) => l.signal_id);

  let confirmedCount = 0;
  const contexts = new Set<string>();

  if (signalIds.length > 0) {
    const { data: signals } = await client
      .from("signals")
      .select("review_status, source_type, diagnostic_session_id")
      .in("id", signalIds);
    for (const s of signals ?? []) {
      if (s.review_status === "approved" && s.source_type !== "ai_hypothesis") {
        confirmedCount += 1;
        contexts.add(s.diagnostic_session_id ?? "no-session");
      }
    }
  }

  const { error } = await client
    .from("themes")
    .update({
      evidence_count: confirmedCount,
      independent_evidence_count: contexts.size,
      contexts_count: contexts.size,
      last_seen_at: new Date().toISOString(),
    })
    .eq("id", themeId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to recompute theme aggregates");
}
