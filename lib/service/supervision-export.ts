import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Anonymized supervision export (ticket 57, docs/data-exchange-contracts.md
 * §14). A permitted Supervisor receives a minimized allowlist-only dataset with
 * no direct identifiers, raw statements, exact dates, or relationship data.
 * Requires a supervisor assignment AND active supervisor_access +
 * anonymized_analytics consent. Every export writes an audit trail.
 */

const supervisionExportSchema = z
  .object({
    clientId: uuid,
  })
  .strict();

async function requireSupervisor(client: SupabaseClient, clientId: string): Promise<string> {
  const { data: clientRow, error } = await client
    .from("clients")
    .select("organization_id")
    .eq("id", clientId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  if (!clientRow) throw new ServiceError("NOT_FOUND", "Client not found");
  const organizationId = (clientRow as { organization_id: string }).organization_id;

  const {
    data: { user },
  } = await client.auth.getUser();
  const { data: assignment } = await client
    .from("client_assignments")
    .select("access_role")
    .eq("client_id", clientId)
    .eq("user_id", user?.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (!assignment || (assignment as { access_role: string }).access_role !== "supervisor") {
    throw new ServiceError("FORBIDDEN", "Supervisor assignment required");
  }

  await requireConsent(client, clientId, "supervisor_access");
  await requireConsent(client, clientId, "anonymized_analytics");

  return organizationId;
}

export async function exportSupervision(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<unknown> {
  const query = validate(supervisionExportSchema, rawQuery ?? {});
  const organizationId = await requireSupervisor(client, query.clientId);

  const [themes, coreNodes, resources, targets, corrections, signals] = await Promise.all([
    client
      .from("themes")
      .select("name, confidence_score")
      .eq("client_id", query.clientId)
      .eq("review_status", "approved"),
    client
      .from("core_nodes")
      .select("title, confidence_score")
      .eq("client_id", query.clientId)
      .eq("status", "active"),
    client
      .from("resources")
      .select("name, strength_score")
      .eq("client_id", query.clientId)
      .eq("status", "active"),
    client
      .from("development_targets")
      .select("name, current_level, target_level")
      .eq("client_id", query.clientId)
      .eq("status", "active"),
    client
      .from("corrections")
      .select("status")
      .eq("client_id", query.clientId)
      .is("archived_at", null),
    client
      .from("signals")
      .select("evidence_level")
      .eq("client_id", query.clientId)
      .eq("review_status", "approved"),
  ]);

  const results = [themes, coreNodes, resources, targets, corrections, signals];
  for (const result of results) {
    if (result.error)
      throw new ServiceError("INTERNAL_ERROR", "Failed to assemble supervision export");
  }

  // Aggregate evidence by evidence level — counts only, never raw statements.
  const evidenceCounts = new Map<string, number>();
  for (const signal of (signals.data ?? []) as { evidence_level: string }[]) {
    evidenceCounts.set(signal.evidence_level, (evidenceCounts.get(signal.evidence_level) ?? 0) + 1);
  }

  const payload = {
    contract: "live-client-map.supervision-export",
    version: "1.0",
    export_id: randomUUID(),
    case_key: randomUUID(),
    generated_at: new Date().toISOString(),
    language: "ru",
    case: {
      generalized_requests: [],
      generalized_goals: [],
      evidence_summary: [...evidenceCounts.entries()].map(([evidence_level, count]) => ({
        evidence_level,
        count,
      })),
      themes: (themes.data ?? []).map((t) => ({
        name: (t as { name: string }).name,
        confidence_score: (t as { confidence_score: number | null }).confidence_score,
      })),
      core_hypotheses: (coreNodes.data ?? []).map((n) => ({
        title: (n as { title: string }).title,
        confidence_score: (n as { confidence_score: number | null }).confidence_score,
      })),
      contradictions: [],
      resources: (resources.data ?? []).map((r) => ({
        name: (r as { name: string }).name,
        strength_score: (r as { strength_score: number | null }).strength_score,
      })),
      development_targets: (targets.data ?? []).map((t) => ({
        name: (t as { name: string }).name,
        current_level: (t as { current_level: number | null }).current_level,
        target_level: (t as { target_level: number | null }).target_level,
      })),
      corrections_and_outcomes: (corrections.data ?? []).map((c) => ({
        status: (c as { status: string }).status,
      })),
      trend_summary: null,
      supervision_questions: [],
    },
  };

  await recordAudit(client, {
    organizationId,
    entityType: "client",
    entityId: query.clientId,
    action: "export.supervision",
    after: { export_id: payload.export_id },
  });

  return payload;
}
