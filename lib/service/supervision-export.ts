import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Anonymized supervision export (ticket 57 → hardened by ticket 18,
 * docs/data-exchange-contracts.md §14).
 *
 * A permitted Supervisor receives a minimized allowlist-only dataset with no
 * direct identifiers, raw statements, exact dates, relationship data or any
 * content belonging to a second client. The payload is built from an explicit
 * allowlist and then re-validated against it, so a future field cannot leak into
 * the projection by accident. Requires an active supervisor assignment AND active
 * `supervisor_access` + `anonymized_analytics` consent. Every export writes an
 * audit trail; the audit payload and the filename carry no identifers or content.
 */

export const SUPERVISION_CONTRACT = "live-client-map.supervision-export";
export const SUPERVISION_VERSION = "1.0";

/** The exact `case` keys of §14. Nothing else may appear at that level. */
export const SUPERVISION_CASE_KEYS = [
  "generalized_requests",
  "generalized_goals",
  "evidence_summary",
  "themes",
  "core_hypotheses",
  "contradictions",
  "resources",
  "development_targets",
  "corrections_and_outcomes",
  "trend_summary",
  "supervision_questions",
] as const;

export type SupervisionCaseKey = (typeof SUPERVISION_CASE_KEYS)[number];

/** Allowlisted item shape per collection: every other field is a leak. */
export const SUPERVISION_ITEM_KEYS: Record<SupervisionCaseKey, readonly string[]> = {
  generalized_requests: ["life_areas", "priority"],
  generalized_goals: ["importance"],
  evidence_summary: ["evidence_level", "count"],
  themes: ["name", "confidence_score"],
  core_hypotheses: ["title", "confidence_score"],
  contradictions: ["summary", "confidence_score"],
  resources: ["name", "strength_score"],
  development_targets: ["name", "current_level", "target_level"],
  corrections_and_outcomes: ["status"],
  trend_summary: [],
  supervision_questions: [],
};

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

/** Rows the §14 projection needs, already filtered and deterministically ordered. */
export interface SupervisionSource {
  organizationId: string;
  themes: Record<string, unknown>[];
  coreNodes: Record<string, unknown>[];
  resources: Record<string, unknown>[];
  developmentTargets: Record<string, unknown>[];
  corrections: Record<string, unknown>[];
  signals: Record<string, unknown>[];
}

/**
 * Supervisor authorization plus the exact §14 read set. Exported so the
 * synchronous export and the asynchronous ExportRequest (ticket 19) read one
 * identical, `sensitive`-free projection instead of drifting apart.
 */
export async function loadSupervisionSource(
  client: SupabaseClient,
  clientId: string
): Promise<SupervisionSource> {
  const organizationId = await requireSupervisor(client, clientId);

  // Deterministic ordering everywhere, so two exports of unchanged data differ
  // only in the export metadata. `sensitive` rows never reach a Supervisor.
  const [themes, coreNodes, resources, targets, corrections, signals] = await Promise.all([
    client
      .from("themes")
      .select("name, confidence_score")
      .eq("client_id", clientId)
      .eq("review_status", "approved")
      .neq("visibility", "sensitive")
      .order("name", { ascending: true }),
    client
      .from("core_nodes")
      .select("title, confidence_score")
      .eq("client_id", clientId)
      .eq("status", "active")
      .neq("visibility", "sensitive")
      .order("title", { ascending: true }),
    client
      .from("resources")
      .select("name, strength_score")
      .eq("client_id", clientId)
      .eq("status", "active")
      .neq("visibility", "sensitive")
      .order("name", { ascending: true }),
    client
      .from("development_targets")
      .select("name, current_level, target_level")
      .eq("client_id", clientId)
      .eq("status", "active")
      .order("name", { ascending: true }),
    client
      .from("corrections")
      .select("status")
      .eq("client_id", clientId)
      .is("archived_at", null)
      .order("id", { ascending: true }),
    client
      .from("signals")
      .select("evidence_level")
      .eq("client_id", clientId)
      .eq("review_status", "approved")
      .neq("visibility", "sensitive")
      .order("id", { ascending: true }),
  ]);

  const results = [themes, coreNodes, resources, targets, corrections, signals];
  for (const result of results) {
    if (result.error)
      throw new ServiceError("INTERNAL_ERROR", "Failed to assemble supervision export");
  }

  return {
    organizationId,
    themes: (themes.data ?? []) as Record<string, unknown>[],
    coreNodes: (coreNodes.data ?? []) as Record<string, unknown>[],
    resources: (resources.data ?? []) as Record<string, unknown>[],
    developmentTargets: (targets.data ?? []) as Record<string, unknown>[],
    corrections: (corrections.data ?? []) as Record<string, unknown>[],
    signals: (signals.data ?? []) as Record<string, unknown>[],
  };
}

/**
 * §14 allowlist check. Runs on the assembled payload BEFORE it leaves the
 * service, so a stray field is a typed failure rather than a disclosure.
 */
export function assertAllowlistedProjection(payload: Record<string, unknown>): void {
  const keys = Object.keys(payload).sort();
  const expected = [...SUPERVISION_CASE_KEYS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new ServiceError("INTERNAL_ERROR", "Supervision projection is not allowlisted");
  }
  for (const key of SUPERVISION_CASE_KEYS) {
    const value = payload[key];
    if (key === "trend_summary") {
      if (value !== null) {
        throw new ServiceError("INTERNAL_ERROR", "Supervision trend_summary must be null");
      }
      continue;
    }
    if (!Array.isArray(value)) {
      throw new ServiceError("INTERNAL_ERROR", `Supervision ${key} must be an array`);
    }
    const allowedItems = new Set(SUPERVISION_ITEM_KEYS[key]);
    for (const item of value) {
      if (item === null || typeof item !== "object") {
        throw new ServiceError("INTERNAL_ERROR", `Supervision ${key} item must be an object`);
      }
      for (const field of Object.keys(item)) {
        if (!allowedItems.has(field)) {
          throw new ServiceError(
            "INTERNAL_ERROR",
            `Supervision ${key} has a non-allowlisted field`
          );
        }
      }
    }
  }
}

/**
 * The §14 `case` object, projected from already-read rows. Pure on purpose: the
 * asynchronous ExportRequest path (ticket 19) reuses exactly this function, so a
 * synchronous and an asynchronous supervision export cannot drift apart.
 * `sensitive` rows never reach a Supervisor; the caller is responsible for
 * excluding them (see `loadSupervisionSource`).
 */
export function projectSupervisionCase(rows: {
  themes: readonly Record<string, unknown>[];
  coreNodes: readonly Record<string, unknown>[];
  resources: readonly Record<string, unknown>[];
  developmentTargets: readonly Record<string, unknown>[];
  corrections: readonly Record<string, unknown>[];
  signals: readonly Record<string, unknown>[];
}): Record<string, unknown> {
  // Aggregate evidence by evidence level — counts only, never raw statements.
  const evidenceCounts = new Map<string, number>();
  for (const signal of rows.signals) {
    const level = String(signal.evidence_level);
    evidenceCounts.set(level, (evidenceCounts.get(level) ?? 0) + 1);
  }

  return {
    generalized_requests: [],
    generalized_goals: [],
    evidence_summary: [...evidenceCounts.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([evidence_level, count]) => ({ evidence_level, count })),
    themes: rows.themes.map((t) => ({
      name: t.name,
      confidence_score: t.confidence_score,
    })),
    core_hypotheses: rows.coreNodes.map((n) => ({
      title: n.title,
      confidence_score: n.confidence_score,
    })),
    contradictions: [],
    resources: rows.resources.map((r) => ({
      name: r.name,
      strength_score: r.strength_score,
    })),
    development_targets: rows.developmentTargets.map((t) => ({
      name: t.name,
      current_level: t.current_level,
      target_level: t.target_level,
    })),
    corrections_and_outcomes: rows.corrections.map((c) => ({ status: c.status })),
    trend_summary: null,
    supervision_questions: [],
  };
}

export async function exportSupervision(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<unknown> {
  const query = validate(supervisionExportSchema, rawQuery ?? {});
  const source = await loadSupervisionSource(client, query.clientId);

  const casePayload = projectSupervisionCase(source);

  assertAllowlistedProjection(casePayload);

  const payload = {
    contract: SUPERVISION_CONTRACT,
    version: SUPERVISION_VERSION,
    export_id: randomUUID(),
    case_key: randomUUID(),
    generated_at: new Date().toISOString(),
    language: "ru",
    case: casePayload,
  };

  await recordAudit(client, {
    organizationId: source.organizationId,
    entityType: "client",
    entityId: query.clientId,
    action: "export.supervision",
    after: { export_id: payload.export_id },
  });

  return payload;
}
