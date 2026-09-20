import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import {
  archiveCorrection,
  createCorrectionFromRecommendation,
  getCorrection,
  updateCorrection,
} from "@/lib/service/corrections";
import {
  cancelFollowUp,
  completeFollowUp,
  evaluateCorrection,
  reviewFollowUpAssessment,
  scheduleFollowUp,
} from "@/lib/service/follow-ups";
import {
  createMarker,
  createObservation,
  getMarker,
  recordMarkerValue,
  updateMarker,
  updateObservation,
} from "@/lib/service/observations";
import {
  evaluateCoreNodeReactivation,
  reviewCoreNodeReactivation,
} from "@/lib/service/reactivation";
import { connectFaultInjection, type FaultInjection } from "./support/fault-injection";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

/** Stub whose stored assessment carries a caller-chosen rationale marker. */
class RationaleProvider implements AiProvider {
  readonly providerKey = "stub";
  readonly modelSnapshot = "stub-1";
  readonly reasoningEffort = "none";
  rationale = "stub rationale";
  proposedStatus = "unclear";

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result: {
          assessment: {
            proposed_result_status: this.proposedStatus,
            confidence: 55,
            evidence_refs: [],
            context_changes: [],
            marker_changes: [],
            missing_evidence: [],
            proposed_core_node_status: null,
            rationale: this.rationale,
            follow_up_recommendation: "Продолжить наблюдение",
          },
        },
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

/**
 * Ticket 07: Corrections, observations/behavioral markers, follow-up
 * transitions and reactivation decisions must commit their domain rows, child
 * rows, audit rows and (where the model itself changes) ModelChange rows in one
 * transaction — or roll all of them back.
 *
 * Faults are injected through the local-only `test_support` schema created by
 * supabase/seed.sql (never present in a deployed database, never exposed through
 * PostgREST). When that support is missing the fault cases are skipped.
 *
 * Fault markers must only appear in the row the fault is aimed at: the trigger
 * matches a marker against the serialized written row, so a marker shared with
 * a parent row would abort one step earlier than the step under test.
 */
describe.skipIf(!available)("atomic corrections, observations and history (ticket 07)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let faults: FaultInjection;
  let orgId: string;
  let clientId: string;
  let specialist: { id: string; client: SupabaseClient };

  function anonClient() {
    return createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }

  async function createUser(email: string): Promise<{ id: string; client: SupabaseClient }> {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "password123",
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(data.user!.id);

    const client = anonClient();
    await client.auth.signInWithPassword({ email, password: "password123" });
    return { id: data.user!.id, client };
  }

  /**
   * Run `action` with one or more `(point, marker)` faults registered,
   * expecting it to fail and roll back.
   */
  async function withFaults(
    entries: [string, string][],
    action: () => PromiseLike<unknown>
  ): Promise<void> {
    for (const [point, marker] of entries) await faults.register(point, marker);
    try {
      await expect(Promise.resolve(action())).rejects.toThrow();
    } finally {
      await faults.clear();
    }
  }

  /** Fault a specific `"column": value` pair of the serialized written row. */
  function fault(point: string, column: string, value: string | number | null): [string, string] {
    const encoded = value === null ? "null" : JSON.stringify(value);
    return [point, `"${column}": ${encoded}`];
  }

  async function grantConsent(type: string, targetClientId = clientId): Promise<void> {
    const { error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: targetClientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  async function auditRows(entityType: string, entityId: string, action?: string) {
    let query = admin
      .from("audit_log")
      .select("id, action, actor_user_id, entity_id")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    if (action) query = query.eq("action", action);
    const { data } = await query;
    return data ?? [];
  }

  async function createCoreNode(title: string): Promise<string> {
    const { data, error } = await admin
      .from("core_nodes")
      .insert({ organization_id: orgId, client_id: clientId, title, status: "active" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  async function createApprovedRecommendation(score = 72.5): Promise<string> {
    const { data, error } = await admin
      .from("recommendations")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        proposed_correction: `Рекомендация ${crypto.randomUUID()}`,
        final_priority_score: score,
        status: "approved",
        visibility: "internal",
        created_by: specialist.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  /** A correction created through the public service boundary. */
  async function createCorrection() {
    const recommendationId = await createApprovedRecommendation();
    const targetId = await createCoreNode(`target-${crypto.randomUUID()}`);
    const title = `correction-${crypto.randomUUID()}`;
    const correction = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      title,
      targets: [{ targetType: "core_node", targetId, role: "primary" }],
      expectedMarkers: [
        {
          marker: `Маркер ${crypto.randomUUID()}`,
          expectedDirection: "increase",
          measurementType: "scale",
        },
      ],
    });
    return correction;
  }

  /** A completed correction that follow-up tests can schedule against. */
  async function createCompletedCorrection(title: string): Promise<string> {
    const { data, error } = await admin
      .from("corrections")
      .insert({ organization_id: orgId, client_id: clientId, title, status: "completed" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  /**
   * A completed follow-up with a pending AI assessment. `effective` selects the
   * objective-evidence payload so the "effective" guard is satisfied.
   */
  async function pendingAssessment(
    correctionId: string,
    options: { effective: boolean; rationale: string }
  ) {
    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      ...(options.effective
        ? { retestResult: { summary: "Стресс снизился", stress_before: 80, stress_after: 40 } }
        : { clientFeedback: { summary: "Кажется, помогло" } }),
    });
    const provider = new RationaleProvider();
    provider.rationale = options.rationale;
    provider.proposedStatus = options.effective ? "effective" : "unclear";
    const evaluated = await evaluateCorrection(specialist.client, provider, scheduled.id);
    expect(evaluated.ai_assessment?.approval_status).toBe("pending");
    return evaluated;
  }

  /** Fresh trigger activation + signal so a weakened node can be reactivated. */
  async function makeReactivatable(nodeId: string): Promise<string> {
    const { data: theme, error: themeError } = await admin
      .from("themes")
      .insert({ organization_id: orgId, client_id: clientId, name: `Тема ${crypto.randomUUID()}` })
      .select("id")
      .single();
    if (themeError) throw new Error(themeError.message);
    await admin
      .from("theme_core_node_links")
      .insert({ theme_id: theme!.id, core_node_id: nodeId, relationship_type: "expresses" });
    const { data: signal } = await admin
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: "kinesiology_test",
        epistemic_type: "test_result",
        raw_statement: `Сигнал ${crypto.randomUUID()}`,
        evidence_level: "L1_SINGLE_SIGNAL",
        review_status: "approved",
        intensity: 50,
      })
      .select("id")
      .single();
    await admin.from("signal_theme_links").insert({ signal_id: signal!.id, theme_id: theme!.id });
    const { data: trigger } = await admin
      .from("triggers")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: `Триггер ${crypto.randomUUID()}`,
      })
      .select("id")
      .single();
    await admin.from("trigger_activations").insert({
      trigger_id: trigger!.id,
      core_node_id: nodeId,
      activation_delta: 25,
    });
    return signal!.id;
  }

  async function createWeakenedNode(score = 25): Promise<string> {
    const nodeId = await createCoreNode(`weakened-${crypto.randomUUID()}`);
    await admin
      .from("core_nodes")
      .update({ status: "weakened", activation_score: score })
      .eq("id", nodeId);
    return nodeId;
  }

  beforeAll(async () => {
    faults = await connectFaultInjection();

    const owner = await createUser(`corr-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Atomic Corrections Org",
    });
    orgId = org as string;

    specialist = await createUser(`corr-spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid, error: clientError } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Atomic History Client",
    });
    if (clientError) throw new Error(clientError.message);
    clientId = cid as string;

    await grantConsent("data_storage");
    await grantConsent("sensitive_psychological_data");
    await grantConsent("ai_analysis");
  });

  afterAll(async () => {
    await faults?.clear();
    await faults?.close();
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  // -------------------------------------------------------------------------
  // Corrections
  // -------------------------------------------------------------------------

  it("commits a Correction with its targets, expected markers and both audit rows", async () => {
    const correction = await createCorrection();

    const read = await getCorrection(specialist.client, correction.id);
    expect(read.targets).toHaveLength(1);
    expect(read.expected_markers).toHaveLength(1);
    expect(read.priority_score_before).toBe(72.5);

    const created = await auditRows(
      "correction",
      correction.id,
      "correction.create_from_recommendation"
    );
    const plan = await auditRows("correction", correction.id, "correction.plan");
    expect(created).toHaveLength(1);
    expect(plan).toHaveLength(1);
    expect(created[0].actor_user_id).toBe(specialist.id);
  });

  it("rolls the Correction and its audit rows back when a target insert fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const expectedEffect = `target-fault-${crypto.randomUUID()}`;
    const nodeId = await createCoreNode(`target-fault-node-${crypto.randomUUID()}`);
    const recommendationId = await createApprovedRecommendation();
    const title = `correction-target-fault-${crypto.randomUUID()}`;

    await withFaults([fault("correction_targets", "expected_effect", expectedEffect)], () =>
      createCorrectionFromRecommendation(specialist.client, {
        organizationId: orgId,
        clientId,
        recommendationId,
        title,
        targets: [{ targetType: "core_node", targetId: nodeId, role: "primary", expectedEffect }],
        expectedMarkers: [
          {
            marker: `Маркер ${crypto.randomUUID()}`,
            expectedDirection: "increase",
            measurementType: "scale",
          },
        ],
      })
    );

    const { data: targets } = await admin
      .from("correction_targets")
      .select("id, correction_id")
      .eq("expected_effect", expectedEffect);
    expect(targets ?? []).toHaveLength(0);
    const { data: corrections } = await admin.from("corrections").select("id").eq("title", title);
    expect(corrections ?? []).toHaveLength(0);
    // The plan audit row cannot survive a correction that was rolled back.
    for (const target of targets ?? []) {
      expect(
        await auditRows("correction", target.correction_id as string, "correction.plan")
      ).toHaveLength(0);
    }
  });

  it("rolls the Correction back when an expected-marker insert fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const markerName = `marker-fault-${crypto.randomUUID()}`;
    const nodeId = await createCoreNode(`marker-node-${crypto.randomUUID()}`);
    const recommendationId = await createApprovedRecommendation();
    const title = `correction-marker-fault-${crypto.randomUUID()}`;

    await withFaults([fault("correction_expected_markers", "marker", markerName)], () =>
      createCorrectionFromRecommendation(specialist.client, {
        organizationId: orgId,
        clientId,
        recommendationId,
        title,
        targets: [{ targetType: "core_node", targetId: nodeId, role: "primary" }],
        expectedMarkers: [
          { marker: markerName, expectedDirection: "increase", measurementType: "scale" },
        ],
      })
    );

    const { data: markers } = await admin
      .from("correction_expected_markers")
      .select("id")
      .eq("marker", markerName);
    expect(markers ?? []).toHaveLength(0);
    const { data: corrections } = await admin.from("corrections").select("id").eq("title", title);
    expect(corrections ?? []).toHaveLength(0);
    const { data: targets } = await admin
      .from("correction_targets")
      .select("id")
      .eq("target_id", nodeId);
    expect(targets ?? []).toHaveLength(0);
  });

  it("rolls the Correction, targets and markers back when the audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const nodeId = await createCoreNode(`audit-node-${crypto.randomUUID()}`);
    const recommendationId = await createApprovedRecommendation();
    const title = `correction-audit-fault-${crypto.randomUUID()}`;

    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      createCorrectionFromRecommendation(specialist.client, {
        organizationId: orgId,
        clientId,
        recommendationId,
        title,
        targets: [{ targetType: "core_node", targetId: nodeId, role: "primary" }],
        expectedMarkers: [
          {
            marker: `Маркер ${crypto.randomUUID()}`,
            expectedDirection: "increase",
            measurementType: "scale",
          },
        ],
      })
    );

    const { data: corrections } = await admin.from("corrections").select("id").eq("title", title);
    expect(corrections ?? []).toHaveLength(0);
    const { data: targets } = await admin
      .from("correction_targets")
      .select("id")
      .eq("target_id", nodeId);
    expect(targets ?? []).toHaveLength(0);
  });

  it("updates a Correction with its audit row, or leaves the previous state untouched", async (ctx) => {
    const correction = await createCorrection();
    const originalTitle = correction.title;

    const updated = await updateCorrection(specialist.client, {
      correctionId: correction.id,
      status: "in_progress",
    });
    expect(updated.status).toBe("in_progress");
    expect(await auditRows("correction", correction.id, "correction.update")).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const newTitle = `correction-update-fault-${crypto.randomUUID()}`;
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      updateCorrection(specialist.client, { correctionId: correction.id, title: newTitle })
    );
    const after = await admin
      .from("corrections")
      .select("title, status")
      .eq("id", correction.id)
      .single();
    expect(after.data?.title).toBe(originalTitle);
    expect(after.data?.status).toBe("in_progress");
    expect(await auditRows("correction", correction.id, "correction.update")).toHaveLength(1);
  });

  it("archives a Correction with its audit row, or neither", async (ctx) => {
    const archived = await createCorrection();
    await archiveCorrection(specialist.client, archived.id);
    const { data: archivedRow } = await admin
      .from("corrections")
      .select("archived_at")
      .eq("id", archived.id)
      .single();
    expect(archivedRow?.archived_at).not.toBeNull();
    expect(await auditRows("correction", archived.id, "correction.archive")).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const failing = await createCorrection();
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      archiveCorrection(specialist.client, failing.id)
    );
    const { data: notArchived } = await admin
      .from("corrections")
      .select("archived_at")
      .eq("id", failing.id)
      .single();
    expect(notArchived?.archived_at).toBeNull();
    expect(await auditRows("correction", failing.id, "correction.archive")).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Observations
  // -------------------------------------------------------------------------

  it("commits an Observation with its audit row, and rolls it back when the audit append fails", async (ctx) => {
    const description = `observation-ok-${crypto.randomUUID()}`;
    const observation = await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      sourceType: "specialist_observation",
      description,
      valence: "positive",
      intensity: 6,
      confidence: 70,
    });
    expect(observation.description).toBe(description);
    expect(await auditRows("observation", observation.id, "observation.create")).toHaveLength(1);

    const updated = await updateObservation(specialist.client, {
      observationId: observation.id,
      intensity: 8,
    });
    expect(updated.intensity).toBe(8);
    expect(await auditRows("observation", observation.id, "observation.update")).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const failing = `observation-audit-fault-${crypto.randomUUID()}`;
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      createObservation(specialist.client, {
        organizationId: orgId,
        clientId,
        sourceType: "specialist_observation",
        description: failing,
        valence: "neutral",
        intensity: 4,
        confidence: 50,
      })
    );
    const { data: rows } = await admin.from("observations").select("id").eq("description", failing);
    expect(rows ?? []).toHaveLength(0);

    // An update whose audit append fails keeps the previous observation.
    const second = await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      sourceType: "measurement",
      description: `observation-update-fault-${crypto.randomUUID()}`,
      valence: "neutral",
      intensity: 3,
      confidence: 50,
    });
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      updateObservation(specialist.client, { observationId: second.id, intensity: 9 })
    );
    const { data: unchanged } = await admin
      .from("observations")
      .select("intensity")
      .eq("id", second.id)
      .single();
    expect(unchanged?.intensity).toBe(3);
  });

  it("rejects an observation linked to another client's correction without writing anything", async () => {
    const { data: otherClient } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `Other ${crypto.randomUUID()}`,
    });
    const otherClientId = otherClient as string;
    await grantConsent("data_storage", otherClientId);
    await grantConsent("sensitive_psychological_data", otherClientId);

    const { data: foreignCorrection } = await admin
      .from("corrections")
      .insert({
        organization_id: orgId,
        client_id: otherClientId,
        title: `foreign-${crypto.randomUUID()}`,
        status: "planned",
      })
      .select("id")
      .single();

    await expect(
      createObservation(specialist.client, {
        organizationId: orgId,
        clientId,
        correctionId: foreignCorrection!.id,
        sourceType: "measurement",
        description: "Чужая коррекция",
        valence: "neutral",
        intensity: 4,
        confidence: 80,
      })
    ).rejects.toThrow(/Invalid correction reference/i);

    const { data: rows } = await admin
      .from("observations")
      .select("id")
      .eq("correction_id", foreignCorrection!.id);
    expect(rows ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // BehavioralMarkers
  // -------------------------------------------------------------------------

  it("commits a marker with its baseline entry and audit row, or neither", async (ctx) => {
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name: `marker-ok-${crypto.randomUUID()}`,
      markerType: "scale",
      scaleMin: 0,
      scaleMax: 10,
      baselineValue: 4,
      currentValue: 4,
    });
    expect(marker.entries).toHaveLength(1);
    expect(marker.entries[0].value).toBe(4);
    expect(
      await auditRows("behavioral_marker", marker.id, "behavioral_marker.create")
    ).toHaveLength(1);

    if (!faults.available) return ctx.skip();

    // A failure while writing the baseline entry rolls the marker back, so a
    // marker with a baseline but no history entry can never be observed.
    const entryFaultName = `marker-entry-fault-${crypto.randomUUID()}`;
    await withFaults([fault("behavioral_marker_entries", "note", "baseline")], () =>
      createMarker(specialist.client, {
        organizationId: orgId,
        clientId,
        name: entryFaultName,
        markerType: "scale",
        scaleMin: 0,
        scaleMax: 10,
        baselineValue: 4,
      })
    );
    const { data: noMarker } = await admin
      .from("behavioral_markers")
      .select("id")
      .eq("name", entryFaultName);
    expect(noMarker ?? []).toHaveLength(0);

    // A failure on the audit append rolls the marker and its baseline back.
    const auditFaultName = `marker-audit-fault-${crypto.randomUUID()}`;
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      createMarker(specialist.client, {
        organizationId: orgId,
        clientId,
        name: auditFaultName,
        markerType: "scale",
        scaleMin: 0,
        scaleMax: 10,
        baselineValue: 4,
      })
    );
    const { data: noMarkerAfterAudit } = await admin
      .from("behavioral_markers")
      .select("id")
      .eq("name", auditFaultName);
    expect(noMarkerAfterAudit ?? []).toHaveLength(0);
  });

  it("records a marker value with history, marker row and audit in one transaction", async (ctx) => {
    const name = `marker-value-${crypto.randomUUID()}`;
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name,
      markerType: "scale",
      scaleMin: 0,
      scaleMax: 10,
      baselineValue: 4,
      currentValue: 4,
    });

    const recorded = await recordMarkerValue(specialist.client, {
      markerId: marker.id,
      value: 8,
      note: `note-${crypto.randomUUID()}`,
    });
    expect(recorded.current_value).toBe(8);
    expect(recorded.trend).toBe("improving");
    expect(recorded.entries).toHaveLength(2);
    expect(
      await auditRows("behavioral_marker", marker.id, "behavioral_marker.record_value")
    ).toHaveLength(1);

    const updated = await updateMarker(specialist.client, {
      markerId: marker.id,
      description: "Обновлённое описание",
    });
    expect(updated.description).toBe("Обновлённое описание");
    expect(
      await auditRows("behavioral_marker", marker.id, "behavioral_marker.update")
    ).toHaveLength(1);

    if (!faults.available) return ctx.skip();

    // The value that would have been written, so the entry note and the marker
    // row can be faulted independently.
    const blockedValue = 9;
    await withFaults([fault("behavioral_marker_entries", "value", blockedValue)], () =>
      recordMarkerValue(specialist.client, { markerId: marker.id, value: 9 })
    );
    const unchanged = await admin
      .from("behavioral_markers")
      .select("current_value, trend")
      .eq("id", marker.id)
      .single();
    expect(unchanged.data?.current_value).toBe(8);
    expect(unchanged.data?.trend).toBe("improving");
    expect((await getMarker(specialist.client, marker.id)).entries).toHaveLength(2);

    // A failure on the marker update path rolls the history entry back with it.
    const entryFaultNote = `note-fault-${crypto.randomUUID()}`;
    await withFaults([fault("behavioral_markers", "current_value", 10)], () =>
      recordMarkerValue(specialist.client, {
        markerId: marker.id,
        value: 10,
        note: entryFaultNote,
      })
    );
    const entries = await admin
      .from("behavioral_marker_entries")
      .select("id")
      .eq("note", entryFaultNote);
    expect(entries.data ?? []).toHaveLength(0);
    const stillUnchanged = await admin
      .from("behavioral_markers")
      .select("current_value")
      .eq("id", marker.id)
      .single();
    expect(stillUnchanged.data?.current_value).toBe(8);

    // A failure on the audit append rolls both the entry and the update back.
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      recordMarkerValue(specialist.client, { markerId: marker.id, value: 9.5 })
    );
    const afterAuditFault = await admin
      .from("behavioral_markers")
      .select("current_value")
      .eq("id", marker.id)
      .single();
    expect(afterAuditFault.data?.current_value).toBe(8);
    expect((await getMarker(specialist.client, marker.id)).entries).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Follow-ups
  // -------------------------------------------------------------------------

  it("commits follow-up lifecycle transitions with their audit rows", async () => {
    const correctionId = await createCompletedCorrection(`fu-schedule-${crypto.randomUUID()}`);
    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    expect(scheduled.result_status).toBe("scheduled");
    expect(await auditRows("follow_up", scheduled.id, "follow_up.schedule")).toHaveLength(1);

    const completed = await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      clientFeedback: { summary: "Стало легче" },
    });
    expect(completed.result_status).toBe("completed");
    expect(await auditRows("follow_up", scheduled.id, "follow_up.complete")).toHaveLength(1);

    const cancelling = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    const cancelled = await cancelFollowUp(specialist.client, cancelling.id);
    expect(cancelled.result_status).toBe("cancelled");
    expect(await auditRows("follow_up", cancelling.id, "follow_up.cancel")).toHaveLength(1);
  });

  it("rolls a scheduled follow-up back when its audit append fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const correctionId = await createCompletedCorrection(`fu-fault-${crypto.randomUUID()}`);

    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      scheduleFollowUp(specialist.client, {
        organizationId: orgId,
        clientId,
        correctionId,
        scheduledAt: new Date().toISOString(),
      })
    );

    const { data: rows } = await admin
      .from("follow_ups")
      .select("id")
      .eq("correction_id", correctionId);
    expect(rows ?? []).toHaveLength(0);
  });

  it("rolls a follow-up transition back when the follow-up row write fails", async (ctx) => {
    if (!faults.available) return ctx.skip();
    const correctionId = await createCompletedCorrection(`fu-row-fault-${crypto.randomUUID()}`);
    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });

    await withFaults([fault("follow_ups", "result_status", "completed")], () =>
      completeFollowUp(specialist.client, {
        followUpId: scheduled.id,
        clientFeedback: { summary: "Не должно сохраниться" },
      })
    );

    const { data: row } = await admin
      .from("follow_ups")
      .select("result_status, client_feedback")
      .eq("id", scheduled.id)
      .single();
    expect(row?.result_status).toBe("scheduled");
    expect(row?.client_feedback).toBeNull();
    expect(await auditRows("follow_up", scheduled.id, "follow_up.complete")).toHaveLength(0);
  });

  it("commits an approved follow-up verdict and its ModelChange, or neither", async (ctx) => {
    const okCorrection = await createCompletedCorrection(`fu-approve-${crypto.randomUUID()}`);
    const okAssessment = await pendingAssessment(okCorrection, {
      effective: true,
      rationale: `rationale-ok-${crypto.randomUUID()}`,
    });

    const approved = await reviewFollowUpAssessment(specialist.client, {
      followUpId: okAssessment.id,
      decision: "approve",
    });
    expect(approved.result_status).toBe("effective");
    expect(approved.ai_assessment?.approval_status).toBe("approved");
    expect(
      await auditRows("follow_up", okAssessment.id, "follow_up.assessment_approve")
    ).toHaveLength(1);

    const { data: okChanges } = await admin
      .from("model_changes")
      .select("id, entity_id, previous_state, new_state")
      .eq("entity_id", okAssessment.id)
      .eq("entity_type", "follow_up");
    expect(okChanges ?? []).toHaveLength(1);
    expect(okChanges![0].previous_state).toEqual({ result_status: "completed" });
    expect(okChanges![0].new_state).toEqual({ result_status: "effective" });

    if (!faults.available) return ctx.skip();

    // A failure while writing the ModelChange rolls the approved verdict back,
    // so a final verdict can never diverge from its ModelChange row.
    const changeFaultCorrection = await createCompletedCorrection(
      `fu-change-fault-${crypto.randomUUID()}`
    );
    const changeFaultRationale = `rationale-change-fault-${crypto.randomUUID()}`;
    const changeFaultAssessment = await pendingAssessment(changeFaultCorrection, {
      effective: true,
      rationale: changeFaultRationale,
    });
    await withFaults([fault("model_changes", "entity_id", changeFaultAssessment.id)], () =>
      reviewFollowUpAssessment(specialist.client, {
        followUpId: changeFaultAssessment.id,
        decision: "approve",
      })
    );
    const { data: rolledBack } = await admin
      .from("follow_ups")
      .select("result_status, ai_assessment")
      .eq("id", changeFaultAssessment.id)
      .single();
    expect(rolledBack?.result_status).toBe("completed");
    expect(rolledBack?.ai_assessment?.approval_status).toBe("pending");
    const { data: noChange } = await admin
      .from("model_changes")
      .select("id")
      .eq("entity_id", changeFaultAssessment.id);
    expect(noChange ?? []).toHaveLength(0);

    // A failure on the audit append rolls the verdict and the ModelChange back.
    const auditFaultCorrection = await createCompletedCorrection(
      `fu-audit-fault-${crypto.randomUUID()}`
    );
    const auditFaultAssessment = await pendingAssessment(auditFaultCorrection, {
      effective: true,
      rationale: `rationale-audit-fault-${crypto.randomUUID()}`,
    });
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      reviewFollowUpAssessment(specialist.client, {
        followUpId: auditFaultAssessment.id,
        decision: "approve",
      })
    );
    const { data: afterAuditFault } = await admin
      .from("follow_ups")
      .select("result_status")
      .eq("id", auditFaultAssessment.id)
      .single();
    expect(afterAuditFault?.result_status).toBe("completed");
    const { data: noChangeAfterAudit } = await admin
      .from("model_changes")
      .select("id")
      .eq("entity_id", auditFaultAssessment.id);
    expect(noChangeAfterAudit ?? []).toHaveLength(0);
  });

  it("rejects a follow-up assessment without writing a diverging ModelChange", async () => {
    const correctionId = await createCompletedCorrection(`fu-reject-${crypto.randomUUID()}`);
    const assessment = await pendingAssessment(correctionId, {
      effective: false,
      rationale: `rationale-reject-${crypto.randomUUID()}`,
    });

    const rejected = await reviewFollowUpAssessment(specialist.client, {
      followUpId: assessment.id,
      decision: "reject",
    });
    expect(rejected.result_status).toBe("completed");
    expect(rejected.ai_assessment?.approval_status).toBe("rejected");
    expect(await auditRows("follow_up", assessment.id, "follow_up.assessment_reject")).toHaveLength(
      1
    );

    const { data: changes } = await admin
      .from("model_changes")
      .select("id")
      .eq("entity_id", assessment.id);
    expect(changes ?? []).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Reactivation decisions
  // -------------------------------------------------------------------------

  it("commits a reactivation proposal with its audit row, or neither", async (ctx) => {
    const nodeId = await createWeakenedNode();
    await makeReactivatable(nodeId);

    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    expect(proposal).not.toBeNull();
    expect(
      await auditRows("core_node_reactivation", proposal!.id, "core_node.reactivation_proposed")
    ).toHaveLength(1);

    if (!faults.available) return ctx.skip();
    const faultNodeId = await createWeakenedNode();
    await makeReactivatable(faultNodeId);

    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      evaluateCoreNodeReactivation(specialist.client, { coreNodeId: faultNodeId })
    );
    const { data: rows } = await admin
      .from("core_node_reactivations")
      .select("id")
      .eq("core_node_id", faultNodeId);
    expect(rows ?? []).toHaveLength(0);
  });

  it("commits the approval, its audit rows and its ModelChange in one transaction", async (ctx) => {
    const nodeId = await createWeakenedNode();
    const signalId = await makeReactivatable(nodeId);

    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    expect(proposal).not.toBeNull();

    const approved = await reviewCoreNodeReactivation(specialist.client, {
      reactivationId: proposal!.id,
      decision: "approve",
    });
    expect(approved.status).toBe("approved");
    expect(approved.decided_by).toBe(specialist.id);

    const { data: node } = await admin
      .from("core_nodes")
      .select("status, activation_score")
      .eq("id", nodeId)
      .single();
    expect(node?.status).toBe("reactivated");
    expect(await auditRows("core_node", nodeId, "core_node.reactivated")).toHaveLength(1);
    expect(
      await auditRows("core_node_reactivation", proposal!.id, "core_node_reactivation.approve")
    ).toHaveLength(1);

    const { data: changes } = await admin
      .from("model_changes")
      .select("id, previous_state, new_state, evidence_refs")
      .eq("entity_id", nodeId)
      .eq("entity_type", "core_node");
    expect(changes ?? []).toHaveLength(1);
    expect(changes![0].previous_state).toEqual({ status: "weakened", activation_score: 25 });
    expect(changes![0].new_state).toEqual({
      status: "reactivated",
      activation_score: approved.proposed_activation_score,
    });
    expect(changes![0].evidence_refs).toContain(proposal!.id);
    expect(changes![0].evidence_refs).toContain(signalId);

    if (!faults.available) return ctx.skip();

    // A ModelChange failure rolls the reactivated node and the proposal
    // decision back: no transition can exist without its history row.
    const changeFaultNode = await createWeakenedNode();
    await makeReactivatable(changeFaultNode);
    const { proposal: changeFaultProposal } = await evaluateCoreNodeReactivation(
      specialist.client,
      {
        coreNodeId: changeFaultNode,
      }
    );
    await withFaults([fault("model_changes", "entity_id", changeFaultNode)], () =>
      reviewCoreNodeReactivation(specialist.client, {
        reactivationId: changeFaultProposal!.id,
        decision: "approve",
      })
    );
    const { data: stillWeakened } = await admin
      .from("core_nodes")
      .select("status, activation_score")
      .eq("id", changeFaultNode)
      .single();
    expect(stillWeakened?.status).toBe("weakened");
    expect(stillWeakened?.activation_score).toBe(25);
    const { data: stillPending } = await admin
      .from("core_node_reactivations")
      .select("status")
      .eq("id", changeFaultProposal!.id)
      .single();
    expect(stillPending?.status).toBe("pending");
    const { data: noChange } = await admin
      .from("model_changes")
      .select("id")
      .eq("entity_id", changeFaultNode);
    expect(noChange ?? []).toHaveLength(0);

    // A failure on the audit append rolls the node, the ModelChange and the
    // proposal back too.
    const auditFaultNode = await createWeakenedNode();
    await makeReactivatable(auditFaultNode);
    const { proposal: auditFaultProposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: auditFaultNode,
    });
    await withFaults([fault("audit_log", "actor_user_id", specialist.id)], () =>
      reviewCoreNodeReactivation(specialist.client, {
        reactivationId: auditFaultProposal!.id,
        decision: "approve",
      })
    );
    const { data: afterAuditFault } = await admin
      .from("core_nodes")
      .select("status")
      .eq("id", auditFaultNode)
      .single();
    expect(afterAuditFault?.status).toBe("weakened");
    const { data: noChangeAfterAudit } = await admin
      .from("model_changes")
      .select("id")
      .eq("entity_id", auditFaultNode);
    expect(noChangeAfterAudit ?? []).toHaveLength(0);
  });

  it("rejects a reactivation proposal without touching the node or the history", async () => {
    const nodeId = await createWeakenedNode();
    await makeReactivatable(nodeId);

    const { proposal } = await evaluateCoreNodeReactivation(specialist.client, {
      coreNodeId: nodeId,
    });
    const rejected = await reviewCoreNodeReactivation(specialist.client, {
      reactivationId: proposal!.id,
      decision: "reject",
    });
    expect(rejected.status).toBe("rejected");
    expect(rejected.decided_by).toBe(specialist.id);

    const { data: node } = await admin
      .from("core_nodes")
      .select("status, activation_score")
      .eq("id", nodeId)
      .single();
    expect(node?.status).toBe("weakened");
    expect(node?.activation_score).toBe(25);
    expect(
      await auditRows("core_node_reactivation", proposal!.id, "core_node_reactivation.reject")
    ).toHaveLength(1);
    const { data: changes } = await admin
      .from("model_changes")
      .select("id")
      .eq("entity_id", nodeId);
    expect(changes ?? []).toHaveLength(0);
  });
});
