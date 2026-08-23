import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { withAudit } from "./audit";
import { ServiceError } from "./errors";
import { decodeCursor, encodeCursor, pageQuerySchema, toPage, type Page } from "./pagination";
import { clampScore, REACTIVATION_CONFIG, type ReactivationConfig } from "./scoring";
import { contributesIndependentEvidence, type EvidenceLevel } from "./signal-interpretation";
import { uuid, validate } from "./validation";

/**
 * Reactivation rules (ticket 42, SPEC §24, ticket 06 scoring model).
 *
 * A CoreNode in status "weakened" can return to "reactivated" when new
 * evidence arrives: a fresh TriggerActivation plus fresh eligible Signals
 * raise activation_score to the configured activation threshold with at least
 * the configured minimum increase. The evaluator is deterministic (no AI),
 * uses the versioned scoring configuration (REACTIVATION_CONFIG) and records
 * the config version plus the full calculation in every proposal.
 *
 * Hard guarantees:
 *   - The evaluator NEVER changes core_nodes by itself: it creates a pending
 *     core_node_reactivations proposal that a specialist must approve
 *     (reviewCoreNodeReactivation). Only approval applies the status change.
 *   - Lifecycle guard: reactivation is only possible weakened → reactivated;
 *     the guard is checked on evaluation and again on approval.
 *   - AI-only evidence (evidence_level L0_AI_ONLY) and stale evidence (older
 *     than the configured freshness window) never trigger a reactivation.
 */

export type ReactivationStatus = "pending" | "approved" | "rejected";

/** Signal row as fed into the evaluator (already joined to the core node). */
export interface ReactivationSignalEvidence {
  id: string;
  evidenceLevel: EvidenceLevel;
  intensity: number | null;
  reviewStatus: string;
  createdAt: string;
}

/** TriggerActivation row as fed into the evaluator. */
export interface ReactivationTriggerEvidence {
  id: string;
  triggerId: string;
  activationDelta: number | null;
  createdAt: string;
}

/** Full calculation snapshot stored in the proposal (calculation jsonb). */
export interface ReactivationCalculation {
  baseScore: number;
  newScore: number;
  increase: number;
  activationThreshold: number;
  minIncrease: number;
  freshEvidenceWindowDays: number;
  signalPoints: number;
  triggerPoints: number;
  signalPointsTotal: number;
  triggerActivations: {
    id: string;
    triggerId: string;
    activationDelta: number;
    createdAt: string;
  }[];
  signals: {
    id: string;
    evidenceLevel: EvidenceLevel;
    intensity: number | null;
    createdAt: string;
  }[];
  excluded: {
    staleSignals: number;
    aiOnlySignals: number;
    notApprovedSignals: number;
    staleTriggerActivations: number;
  };
}

export interface ReactivationEvaluation {
  /** Lifecycle guard: only a weakened CoreNode can be reactivated. */
  eligible: boolean;
  proposed: boolean;
  reason: string;
  configVersion: string;
  calculation: ReactivationCalculation;
}

export interface CoreNodeReactivation {
  id: string;
  organization_id: string;
  client_id: string;
  core_node_id: string;
  scoring_model_version: string;
  previous_activation_score: number | null;
  proposed_activation_score: number;
  calculation: ReactivationCalculation;
  reason: string;
  status: ReactivationStatus;
  created_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

const evaluateReactivationSchema = z.object({ coreNodeId: uuid }).strict();

const reviewReactivationSchema = z
  .object({
    reactivationId: uuid,
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

export type ReviewReactivationInput = z.infer<typeof reviewReactivationSchema>;

const listReactivationsQuerySchema = pageQuerySchema.extend({
  organizationId: uuid,
  coreNodeId: uuid.optional(),
  clientId: uuid.optional(),
  status: z.enum(["pending", "approved", "rejected"]).optional(),
});

// --- Deterministic evaluator (pure) ----------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Deterministic reactivation evaluation (SPEC §24). Pure function of the
 * node's current status/score, the evidence and the versioned config — same
 * inputs and config version always give the same result.
 *
 * Eligibility rules for evidence:
 *   - Signals: review_status must be "approved", evidence_level must not be
 *     L0_AI_ONLY (SPEC §3.5: AI-only evidence never counts on its own) and
 *     created_at must be inside the freshness window (stale evidence ignored).
 *   - TriggerActivations: created_at inside the freshness window with a
 *     positive activation_delta.
 *
 * Proposal rule (ticket 06): at least one fresh trigger activation AND one
 * fresh eligible signal; newScore >= activationThreshold AND
 * increase >= minIncrease.
 */
export function evaluateReactivation(
  input: {
    status: string;
    activationScore: number | null;
    signals: ReactivationSignalEvidence[];
    triggerActivations: ReactivationTriggerEvidence[];
  },
  config: ReactivationConfig = REACTIVATION_CONFIG,
  now: Date = new Date()
): ReactivationEvaluation {
  const cutoff = new Date(now.getTime() - config.freshEvidenceWindowDays * DAY_MS);

  const excluded = {
    staleSignals: 0,
    aiOnlySignals: 0,
    notApprovedSignals: 0,
    staleTriggerActivations: 0,
  };
  const freshSignals: ReactivationSignalEvidence[] = [];
  for (const signal of input.signals) {
    if (new Date(signal.createdAt) < cutoff) {
      excluded.staleSignals += 1;
    } else if (!contributesIndependentEvidence(signal.evidenceLevel)) {
      excluded.aiOnlySignals += 1;
    } else if (signal.reviewStatus !== "approved") {
      excluded.notApprovedSignals += 1;
    } else {
      freshSignals.push(signal);
    }
  }

  const freshActivations: (ReactivationTriggerEvidence & { activationDelta: number })[] = [];
  for (const activation of input.triggerActivations) {
    if (new Date(activation.createdAt) < cutoff) {
      excluded.staleTriggerActivations += 1;
    } else if (activation.activationDelta !== null && activation.activationDelta > 0) {
      freshActivations.push({ ...activation, activationDelta: activation.activationDelta });
    }
  }

  const base = input.activationScore ?? 0;
  const triggerPoints = freshActivations.reduce((sum, a) => sum + a.activationDelta, 0);
  const signalPointsTotal = freshSignals.length * config.signalPoints;
  const newScore = clampScore(base + triggerPoints + signalPointsTotal);
  const increase = newScore - base;

  const calculation: ReactivationCalculation = {
    baseScore: base,
    newScore,
    increase,
    activationThreshold: config.activationThreshold,
    minIncrease: config.minIncrease,
    freshEvidenceWindowDays: config.freshEvidenceWindowDays,
    signalPoints: config.signalPoints,
    triggerPoints,
    signalPointsTotal,
    triggerActivations: freshActivations.map((a) => ({
      id: a.id,
      triggerId: a.triggerId,
      activationDelta: a.activationDelta,
      createdAt: a.createdAt,
    })),
    signals: freshSignals.map((s) => ({
      id: s.id,
      evidenceLevel: s.evidenceLevel,
      intensity: s.intensity,
      createdAt: s.createdAt,
    })),
    excluded,
  };

  const eligible = input.status === "weakened";
  if (!eligible) {
    return {
      eligible,
      proposed: false,
      reason: `CoreNode в статусе "${input.status}" не может быть reactivated: переход разрешён только из weakened.`,
      configVersion: config.version,
      calculation,
    };
  }
  if (freshActivations.length === 0) {
    return {
      eligible,
      proposed: false,
      reason:
        "Нет свежего trigger activation в пределах окна свежести: reactivation требует нового триггера (SPEC §24).",
      configVersion: config.version,
      calculation,
    };
  }
  if (freshSignals.length === 0) {
    return {
      eligible,
      proposed: false,
      reason:
        "Нет свежих подтверждённых сигналов: AI-only и устаревшие данные не вызывают reactivation сами по себе.",
      configVersion: config.version,
      calculation,
    };
  }
  if (newScore < config.activationThreshold) {
    return {
      eligible,
      proposed: false,
      reason: `activation_score ${newScore} ниже порога реактивации ${config.activationThreshold}.`,
      configVersion: config.version,
      calculation,
    };
  }
  if (increase < config.minIncrease) {
    return {
      eligible,
      proposed: false,
      reason: `Прирост activation_score ${increase} ниже минимального ${config.minIncrease}.`,
      configVersion: config.version,
      calculation,
    };
  }
  return {
    eligible,
    proposed: true,
    reason: `activation_score вырос с ${base} до ${newScore} (прирост ${increase} ≥ ${config.minIncrease}, порог ${config.activationThreshold}): ${freshActivations.length} trigger activation + ${freshSignals.length} свежих сигналов.`,
    configVersion: config.version,
    calculation,
  };
}

// --- Internals ---------------------------------------------------------------

async function requireUserId(client: SupabaseClient): Promise<string> {
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new ServiceError("UNAUTHORIZED", "Authentication required");
  return user.id;
}

function mapWriteError(error: { code?: string }, fallback: string): ServiceError {
  if (error.code === "42501") {
    return new ServiceError("FORBIDDEN", "You do not have permission to modify this core node");
  }
  return new ServiceError("INTERNAL_ERROR", fallback);
}

function mapRow(data: unknown): CoreNodeReactivation {
  return data as CoreNodeReactivation;
}

interface CoreNodeRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: string;
  activation_score: number | null;
}

async function requireCoreNode(client: SupabaseClient, coreNodeId: string): Promise<CoreNodeRow> {
  const { data, error } = await client
    .from("core_nodes")
    .select("id, organization_id, client_id, status, activation_score")
    .eq("id", coreNodeId)
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read core node");
  if (!data) throw new ServiceError("NOT_FOUND", "Core node not found");
  return data as CoreNodeRow;
}

/** Signals linked to the core node via signal → theme → core node links. */
async function gatherSignals(
  client: SupabaseClient,
  coreNodeId: string
): Promise<ReactivationSignalEvidence[]> {
  const { data: themeLinks, error: themeError } = await client
    .from("theme_core_node_links")
    .select("theme_id")
    .eq("core_node_id", coreNodeId);
  if (themeError) throw new ServiceError("INTERNAL_ERROR", "Failed to read theme links");
  const themeIds = ((themeLinks ?? []) as { theme_id: string }[]).map((link) => link.theme_id);
  if (themeIds.length === 0) return [];

  const { data: signalLinks, error: linkError } = await client
    .from("signal_theme_links")
    .select("signal_id")
    .in("theme_id", themeIds);
  if (linkError) throw new ServiceError("INTERNAL_ERROR", "Failed to read signal links");
  const signalIds = [
    ...new Set(((signalLinks ?? []) as { signal_id: string }[]).map((link) => link.signal_id)),
  ];
  if (signalIds.length === 0) return [];

  const { data: signals, error: signalError } = await client
    .from("signals")
    .select("id, evidence_level, intensity, review_status, created_at")
    .in("id", signalIds)
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (signalError) throw new ServiceError("INTERNAL_ERROR", "Failed to read signals");

  return (
    (signals ?? []) as {
      id: string;
      evidence_level: EvidenceLevel;
      intensity: number | null;
      review_status: string;
      created_at: string;
    }[]
  ).map((signal) => ({
    id: signal.id,
    evidenceLevel: signal.evidence_level,
    intensity: signal.intensity,
    reviewStatus: signal.review_status,
    createdAt: signal.created_at,
  }));
}

async function gatherTriggerActivations(
  client: SupabaseClient,
  coreNodeId: string
): Promise<ReactivationTriggerEvidence[]> {
  const { data, error } = await client
    .from("trigger_activations")
    .select("id, trigger_id, activation_delta, created_at")
    .eq("core_node_id", coreNodeId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read trigger activations");
  return (
    (data ?? []) as {
      id: string;
      trigger_id: string;
      activation_delta: number | null;
      created_at: string;
    }[]
  ).map((activation) => ({
    id: activation.id,
    triggerId: activation.trigger_id,
    activationDelta: activation.activation_delta,
    createdAt: activation.created_at,
  }));
}

// --- Evaluation + proposal ---------------------------------------------------

export interface ReactivationRunResult {
  evaluation: ReactivationEvaluation;
  proposal: CoreNodeReactivation | null;
}

/**
 * Run the deterministic reactivation evaluation for a core node. The node
 * must be weakened (lifecycle guard). When the configured thresholds are met
 * a PENDING proposal is created — the node status is never changed here. At
 * most one pending proposal per node is allowed.
 */
export async function evaluateCoreNodeReactivation(
  client: SupabaseClient,
  rawInput: unknown
): Promise<ReactivationRunResult> {
  const input = validate(evaluateReactivationSchema, rawInput);
  const userId = await requireUserId(client);

  const node = await requireCoreNode(client, input.coreNodeId);
  const [signals, triggerActivations] = await Promise.all([
    gatherSignals(client, node.id),
    gatherTriggerActivations(client, node.id),
  ]);

  const evaluation = evaluateReactivation({
    status: node.status,
    activationScore: node.activation_score,
    signals,
    triggerActivations,
  });

  if (!evaluation.eligible) {
    throw new ServiceError("CONFLICT", evaluation.reason);
  }
  if (!evaluation.proposed) {
    return { evaluation, proposal: null };
  }

  const { data: existing } = await client
    .from("core_node_reactivations")
    .select("id")
    .eq("core_node_id", node.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    throw new ServiceError("CONFLICT", "Core node already has a pending reactivation proposal");
  }

  const proposal = await withAudit(
    client,
    {
      organizationId: node.organization_id,
      entityType: "core_node_reactivation",
      action: "core_node.reactivation_proposed",
      reason: evaluation.reason,
    },
    async () => {
      const { data, error } = await client
        .from("core_node_reactivations")
        .insert({
          organization_id: node.organization_id,
          client_id: node.client_id,
          core_node_id: node.id,
          scoring_model_version: evaluation.configVersion,
          previous_activation_score: node.activation_score,
          proposed_activation_score: evaluation.calculation.newScore,
          calculation: evaluation.calculation,
          reason: evaluation.reason,
          status: "pending",
          created_by: userId,
        })
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to create reactivation proposal");
      return mapRow(data);
    }
  );

  return { evaluation, proposal };
}

/** List reactivation proposals (history), oldest first. */
export async function listCoreNodeReactivations(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<Page<CoreNodeReactivation>> {
  const query = validate(listReactivationsQuerySchema, rawQuery ?? {});

  let request = client
    .from("core_node_reactivations")
    .select("*")
    .eq("organization_id", query.organizationId)
    .order("id", { ascending: true })
    .limit(query.limit + 1);

  if (query.coreNodeId) request = request.eq("core_node_id", query.coreNodeId);
  if (query.clientId) request = request.eq("client_id", query.clientId);
  if (query.status) request = request.eq("status", query.status);
  if (query.cursor) request = request.gt("id", decodeCursor(query.cursor));

  const { data, error } = await request;
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list reactivation proposals");

  return toPage((data ?? []).map(mapRow), query.limit, (last) => encodeCursor(last.id));
}

export async function getCoreNodeReactivation(
  client: SupabaseClient,
  reactivationId: string
): Promise<CoreNodeReactivation> {
  const { data, error } = await client
    .from("core_node_reactivations")
    .select("*")
    .eq("id", validate(uuid, reactivationId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read reactivation proposal");
  if (!data) throw new ServiceError("NOT_FOUND", "Reactivation proposal not found");
  return mapRow(data);
}

/**
 * Human approval flow. Approve applies the ONLY allowed transition
 * weakened → reactivated (re-checked here: the node may have changed since
 * the proposal was created) and stores the proposed activation_score on the
 * node. Reject marks the proposal rejected and leaves the node untouched.
 */
export async function reviewCoreNodeReactivation(
  client: SupabaseClient,
  rawInput: unknown
): Promise<CoreNodeReactivation> {
  const input = validate(reviewReactivationSchema, rawInput);
  const userId = await requireUserId(client);

  const proposal = await getCoreNodeReactivation(client, input.reactivationId);
  if (proposal.status !== "pending") {
    throw new ServiceError("CONFLICT", "Reactivation proposal was already reviewed");
  }

  const now = new Date().toISOString();

  if (input.decision === "reject") {
    return withAudit(
      client,
      {
        organizationId: proposal.organization_id,
        entityType: "core_node_reactivation",
        entityId: proposal.id,
        action: "core_node_reactivation.reject",
        before: { status: proposal.status },
        after: { status: "rejected" },
      },
      async () => {
        const { data, error } = await client
          .from("core_node_reactivations")
          .update({ status: "rejected", decided_by: userId, decided_at: now, updated_at: now })
          .eq("id", proposal.id)
          .eq("status", "pending")
          .select()
          .single();
        if (error) throw mapWriteError(error, "Failed to reject reactivation proposal");
        if (!data) throw new ServiceError("NOT_FOUND", "Reactivation proposal not found");
        return mapRow(data);
      }
    );
  }

  // Approve: the lifecycle guard is enforced again at decision time.
  const node = await requireCoreNode(client, proposal.core_node_id);
  if (node.status !== "weakened") {
    throw new ServiceError(
      "CONFLICT",
      `CoreNode в статусе "${node.status}" не может быть reactivated: переход разрешён только из weakened.`
    );
  }

  await withAudit(
    client,
    {
      organizationId: proposal.organization_id,
      entityType: "core_node",
      entityId: node.id,
      action: "core_node.reactivated",
      reason: proposal.reason,
      before: { status: node.status, activation_score: node.activation_score },
      after: { status: "reactivated", activation_score: proposal.proposed_activation_score },
    },
    async () => {
      const { error } = await client
        .from("core_nodes")
        .update({
          status: "reactivated",
          activation_score: proposal.proposed_activation_score,
          updated_at: now,
        })
        .eq("id", node.id)
        .eq("status", "weakened");
      if (error) throw mapWriteError(error, "Failed to reactivate core node");
    }
  );

  return withAudit(
    client,
    {
      organizationId: proposal.organization_id,
      entityType: "core_node_reactivation",
      entityId: proposal.id,
      action: "core_node_reactivation.approve",
      before: { status: proposal.status },
      after: { status: "approved" },
    },
    async () => {
      const { data, error } = await client
        .from("core_node_reactivations")
        .update({ status: "approved", decided_by: userId, decided_at: now, updated_at: now })
        .eq("id", proposal.id)
        .eq("status", "pending")
        .select()
        .single();
      if (error) throw mapWriteError(error, "Failed to approve reactivation proposal");
      if (!data) throw new ServiceError("NOT_FOUND", "Reactivation proposal not found");
      return mapRow(data);
    }
  );
}

export { evaluateReactivationSchema, reviewReactivationSchema, listReactivationsQuerySchema };
