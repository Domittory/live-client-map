import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { FakeAiProvider } from "@/lib/ai/provider";
import { updateCorrection } from "@/lib/service/corrections";
import {
  cancelFollowUp,
  completeFollowUp,
  evaluateCorrection,
  getFollowUp,
  listFollowUps,
  reviewFollowUpAssessment,
  scheduleFollowUp,
} from "@/lib/service/follow-ups";
import { createObservation } from "@/lib/service/observations";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

/** Fake provider variant whose assessment proposes "effective". */
class EffectiveProvider extends FakeAiProvider {
  override async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    const response = await super.complete(call);
    if (response.ok) {
      const output = response.output as {
        result: { assessment: { proposed_result_status: string } };
      };
      output.result.assessment.proposed_result_status = "effective";
    }
    return response;
  }
}

describe.skipIf(!available)("FollowUp and evaluateCorrection (ticket 41)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
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

  async function grantConsent(type: string) {
    const { error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  async function insertCorrection(title: string, status: string): Promise<string> {
    const { data, error } = await admin
      .from("corrections")
      .insert({ organization_id: orgId, client_id: clientId, title, status })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  /** A completed follow-up with full objective evidence and both feedbacks. */
  async function completedWithEvidence(correctionId: string): Promise<string> {
    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    const completed = await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      retestResult: {
        summary: "Стресс-реакция снизилась",
        stress_before: 80,
        stress_after: 40,
        contexts: ["работа"],
      },
      behavioralResult: { summary: "Конфликты сократились" },
      clientFeedback: { summary: "Стало легче", perceived_effect: "positive" },
      specialistAssessment: { summary: "Динамика подтверждается" },
    });
    return completed.id;
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `FollowUps Org ${crypto.randomUUID()}`,
    });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: clientData, error: clientError } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `Client ${crypto.randomUUID()}`,
    });
    if (clientError) throw new Error(clientError.message);
    clientId = clientData;

    await grantConsent("data_storage");
    await grantConsent("sensitive_psychological_data");
    await grantConsent("ai_analysis");
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("runs the full lifecycle: schedule → complete → evaluate → approve", async () => {
    const correctionId = await insertCorrection("Lifecycle correction", "in_progress");

    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    expect(scheduled.result_status).toBe("scheduled");
    expect(scheduled.completed_at).toBeNull();

    const completed = await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      retestResult: { summary: "Стресс снизился", stress_before: 80, stress_after: 40 },
      behavioralResult: { summary: "Меньше конфликтов" },
      clientFeedback: { summary: "Лучше", perceived_effect: "positive" },
      specialistAssessment: { summary: "Есть динамика" },
    });
    expect(completed.result_status).toBe("completed");
    expect(completed.completed_at).not.toBeNull();
    // Client feedback, specialist assessment and (later) AI assessment stay
    // in separate columns.
    expect(completed.client_feedback?.perceived_effect).toBe("positive");
    expect(completed.specialist_assessment?.summary).toBe("Есть динамика");
    expect(completed.ai_assessment).toBeNull();

    const provider = new FakeAiProvider();
    const evaluated = await evaluateCorrection(specialist.client, provider, scheduled.id);
    expect(provider.calls).toBe(1);
    expect(evaluated.result_status).toBe("completed"); // still pending human approval
    expect(evaluated.ai_assessment?.approval_status).toBe("pending");
    expect(evaluated.ai_assessment?.proposed_result_status).toBe("unclear");
    expect(evaluated.ai_assessment?.source).toBe("ai");
    expect(evaluated.ai_assessment?.run_id).not.toBeNull();

    const approved = await reviewFollowUpAssessment(specialist.client, {
      followUpId: scheduled.id,
      decision: "approve",
    });
    expect(approved.result_status).toBe("unclear"); // fake proposes unclear
    expect(approved.ai_assessment?.approval_status).toBe("approved");
    expect(approved.ai_assessment?.decided_by).toBe(specialist.id);
    expect(approved.ai_assessment?.decided_at).not.toBeNull();
  });

  it("approves an AI-proposed effective result when evidence exists", async () => {
    const correctionId = await insertCorrection("Effective correction", "completed");
    const followUpId = await completedWithEvidence(correctionId);

    const evaluated = await evaluateCorrection(
      specialist.client,
      new EffectiveProvider(),
      followUpId
    );
    expect(evaluated.ai_assessment?.proposed_result_status).toBe("effective");

    const approved = await reviewFollowUpAssessment(specialist.client, {
      followUpId,
      decision: "approve",
    });
    expect(approved.result_status).toBe("effective");
    expect(approved.ai_assessment?.approval_status).toBe("approved");
  });

  it("rejection keeps result_status completed; re-evaluation needs new evidence", async () => {
    const correctionId = await insertCorrection("Reject correction", "completed");
    const followUpId = await completedWithEvidence(correctionId);

    await evaluateCorrection(specialist.client, new FakeAiProvider(), followUpId);
    const rejected = await reviewFollowUpAssessment(specialist.client, {
      followUpId,
      decision: "reject",
    });
    expect(rejected.result_status).toBe("completed");
    expect(rejected.ai_assessment?.approval_status).toBe("rejected");

    // Gateway idempotency: unchanged evidence cannot be re-evaluated.
    await expect(
      evaluateCorrection(specialist.client, new EffectiveProvider(), followUpId)
    ).rejects.toThrow(/identical evaluation/i);

    // New evidence changes the payload, so a fresh evaluation runs.
    await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      sourceType: "specialist_observation",
      description: "Новое наблюдение после отклонения",
      valence: "positive",
      intensity: 6,
      confidence: 75,
    });
    const reevaluated = await evaluateCorrection(
      specialist.client,
      new EffectiveProvider(),
      followUpId
    );
    expect(reevaluated.ai_assessment?.approval_status).toBe("pending");
    expect(reevaluated.ai_assessment?.proposed_result_status).toBe("effective");
  });

  it("insufficient follow-up evidence short-circuits the AI and forbids effective", async () => {
    const correctionId = await insertCorrection("No evidence correction", "completed");
    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    // Only subjective feedback: no retest, no behavioral result, no
    // observations, no measured markers.
    await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      clientFeedback: { summary: "Кажется, помогло", perceived_effect: "positive" },
    });

    const provider = new EffectiveProvider();
    const evaluated = await evaluateCorrection(specialist.client, provider, scheduled.id);
    // The deterministic guard fires before the provider is called.
    expect(provider.calls).toBe(0);
    expect(evaluated.ai_assessment?.source).toBe("deterministic_guard");
    expect(evaluated.ai_assessment?.proposed_result_status).toBe("unclear");
    expect(evaluated.ai_assessment?.missing_evidence).toContain("retest_result");
    expect(evaluated.ai_assessment?.missing_evidence).toContain("observations");

    // A human cannot override to effective without evidence either.
    await expect(
      reviewFollowUpAssessment(specialist.client, {
        followUpId: scheduled.id,
        decision: "approve",
        finalStatus: "effective",
      })
    ).rejects.toThrow(/without follow-up evidence/i);

    // Plain approval of the guard's "unclear" still works.
    const approved = await reviewFollowUpAssessment(specialist.client, {
      followUpId: scheduled.id,
      decision: "approve",
    });
    expect(approved.result_status).toBe("unclear");
  });

  it("counts observations linked to the correction as objective evidence", async () => {
    const correctionId = await insertCorrection("Observed correction", "completed");
    await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      sourceType: "specialist_observation",
      description: "Спокойнее в конфликте",
      valence: "positive",
      intensity: 5,
      confidence: 70,
    });

    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      specialistAssessment: { summary: "Есть наблюдение" },
    });

    const provider = new EffectiveProvider();
    const evaluated = await evaluateCorrection(specialist.client, provider, scheduled.id);
    // The observation is objective evidence, so the AI is actually called and
    // its "effective" proposal survives the guard.
    expect(provider.calls).toBe(1);
    expect(evaluated.ai_assessment?.proposed_result_status).toBe("effective");
  });

  it("enforces lifecycle transitions", async () => {
    const plannedCorrectionId = await insertCorrection("Planned correction", "planned");
    await expect(
      scheduleFollowUp(specialist.client, {
        organizationId: orgId,
        clientId,
        correctionId: plannedCorrectionId,
        scheduledAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/in_progress or completed/i);

    const correctionId = await insertCorrection("Transitions correction", "in_progress");
    const scheduled = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });

    // Cannot evaluate before completion.
    await expect(
      evaluateCorrection(specialist.client, new FakeAiProvider(), scheduled.id)
    ).rejects.toThrow(/cannot be evaluated/i);

    const completed = await completeFollowUp(specialist.client, {
      followUpId: scheduled.id,
      retestResult: { summary: "Retest" },
    });
    // Cannot complete twice.
    await expect(
      completeFollowUp(specialist.client, {
        followUpId: completed.id,
        retestResult: { summary: "Again" },
      })
    ).rejects.toThrow(/cannot be completed/i);

    // Cannot review without an assessment.
    await expect(
      reviewFollowUpAssessment(specialist.client, { followUpId: completed.id, decision: "approve" })
    ).rejects.toThrow(/no assessment/i);

    await evaluateCorrection(specialist.client, new FakeAiProvider(), completed.id);
    // Cannot evaluate twice while an assessment is pending.
    await expect(
      evaluateCorrection(specialist.client, new FakeAiProvider(), completed.id)
    ).rejects.toThrow(/pending assessment/i);

    await reviewFollowUpAssessment(specialist.client, {
      followUpId: completed.id,
      decision: "approve",
    });
    // Cannot review twice.
    await expect(
      reviewFollowUpAssessment(specialist.client, { followUpId: completed.id, decision: "approve" })
    ).rejects.toThrow(/no assessment|already reviewed/i);

    // Cannot cancel a finalized follow-up.
    await expect(cancelFollowUp(specialist.client, completed.id)).rejects.toThrow(
      /cannot be cancelled/i
    );
  });

  it("preserves follow-up history per correction without overwriting", async () => {
    const correctionId = await insertCorrection("History correction", "completed");
    const first = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date().toISOString(),
    });
    const second = await scheduleFollowUp(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    await completeFollowUp(specialist.client, {
      followUpId: first.id,
      retestResult: { summary: "Первый retest" },
    });

    const page = await listFollowUps(specialist.client, {
      organizationId: orgId,
      correctionId,
    });
    expect(page.items).toHaveLength(2);
    const byId = new Map(page.items.map((item) => [item.id, item]));
    // The first follow-up keeps its own results; the second is untouched.
    expect(byId.get(first.id)?.result_status).toBe("completed");
    expect(byId.get(first.id)?.retest_result?.summary).toBe("Первый retest");
    expect(byId.get(second.id)?.result_status).toBe("scheduled");
    expect(byId.get(second.id)?.retest_result).toBeNull();
  });

  it("RLS: another organization cannot read or write follow-ups", async () => {
    const correctionId = await insertCorrection("RLS correction", "completed");
    const followUpId = await completedWithEvidence(correctionId);

    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    const { error: orgError } = await outsider.client.rpc("create_organization", {
      org_name: `Other Org ${crypto.randomUUID()}`,
    });
    if (orgError) throw new Error(orgError.message);

    const page = await listFollowUps(outsider.client, {
      organizationId: orgId,
      correctionId,
    });
    expect(page.items).toHaveLength(0);

    await expect(getFollowUp(outsider.client, followUpId)).rejects.toThrow(/not found/i);

    await expect(
      scheduleFollowUp(outsider.client, {
        organizationId: orgId,
        clientId,
        correctionId,
        scheduledAt: new Date().toISOString(),
      })
    ).rejects.toThrow();
  });

  it("completing a correction never changes the targeted core node status", async () => {
    const { data: coreNode, error: coreNodeError } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Core node for completion guard",
        status: "active",
      })
      .select("id")
      .single();
    if (coreNodeError) throw new Error(coreNodeError.message);

    const { data: correction, error: correctionError } = await admin
      .from("corrections")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Core node guard correction",
        status: "in_progress",
      })
      .select("id")
      .single();
    if (correctionError) throw new Error(correctionError.message);

    const { error: targetError } = await admin.from("correction_targets").insert({
      correction_id: correction!.id,
      target_type: "core_node",
      target_id: coreNode!.id,
      role: "primary",
    });
    if (targetError) throw new Error(targetError.message);

    const { error: markerError } = await admin.from("correction_expected_markers").insert({
      correction_id: correction!.id,
      marker: "Конфликты",
      expected_direction: "decrease",
      measurement_type: "frequency",
    });
    if (markerError) throw new Error(markerError.message);

    const completed = await updateCorrection(specialist.client, {
      correctionId: correction!.id,
      status: "completed",
    });
    expect(completed.status).toBe("completed");

    const { data: after } = await admin
      .from("core_nodes")
      .select("status")
      .eq("id", coreNode!.id)
      .single();
    // SPEC §51.9: a completed correction alone never makes a CoreNode integrated.
    expect(after!.status).toBe("active");
  });
});
