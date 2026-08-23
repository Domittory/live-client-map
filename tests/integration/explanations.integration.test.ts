import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { FakeAiProvider } from "@/lib/ai/provider";
import {
  explainModelChanges,
  getModelExplanation,
  listModelExplanations,
  reviewModelExplanation,
} from "@/lib/service/explanations";
import { listModelChanges, recordModelChange } from "@/lib/service/model-changes";
import { generateSnapshot } from "@/lib/service/snapshots";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

type StubMode = "ok" | "fabricated_change" | "fabricated_evidence";

/** Fake provider that explains the first model change of the payload. */
class ExplainingProvider extends FakeAiProvider {
  lastPayload: Record<string, unknown> | null = null;

  constructor(private readonly mode: StubMode = "ok") {
    super();
  }

  override async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    this.calls += 1;
    const envelope = call.envelope as {
      contract_version: string;
      request_id: string;
      payload: {
        model_changes: { id: string; evidence_refs: string[] }[];
      };
    };
    this.lastPayload = envelope.payload as Record<string, unknown>;
    const change = envelope.payload.model_changes[0];
    const modelChangeId = this.mode === "fabricated_change" ? crypto.randomUUID() : change.id;
    const evidenceRef =
      this.mode === "fabricated_evidence"
        ? crypto.randomUUID()
        : (change.evidence_refs[0] ?? crypto.randomUUID());
    return {
      ok: true,
      output: {
        contract_version: envelope.contract_version,
        request_id: envelope.request_id,
        warnings: [],
        safety: { review_required: true, categories: [], rationale: "" },
        result: {
          explanations: [
            {
              model_change_id: modelChangeId,
              headline: "Confidence узла вырос",
              explanation: "Новые независимые сигналы в контекстах работа и авторитет.",
              evidence_refs: [evidenceRef],
              score_breakdown_summary: "confidence_score 72 -> 88",
              uncertainty: "Один контекст пока без независимого подтверждения.",
              missing_evidence: [],
            },
          ],
        },
      },
      inputTokens: 10,
      outputTokens: 5,
    };
  }
}

describe.skipIf(!available)("explainModelChanges (ticket 44)", () => {
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

  async function grantConsent(type: string, targetClientId: string) {
    const { error } = await specialist.client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: targetClientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  async function createClientRow(): Promise<string> {
    const { data, error } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `Client ${crypto.randomUUID()}`,
    });
    if (error) throw new Error(error.message);
    return data as string;
  }

  async function insertCoreNode(targetClientId: string, confidence: number): Promise<string> {
    const { data, error } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: targetClientId,
        title: `Node ${crypto.randomUUID()}`,
        status: "active",
        confidence_score: confidence,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  async function insertSignal(targetClientId: string): Promise<string> {
    const { data, error } = await admin
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: targetClientId,
        source_type: "kinesiology_test",
        epistemic_type: "test_result",
        raw_statement: `Сигнал ${crypto.randomUUID()}`,
        evidence_level: "L1_SINGLE_SIGNAL",
        review_status: "approved",
        intensity: 50,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return data!.id;
  }

  /**
   * A real model transition between two snapshots: node confidence 72 → 88
   * with a ModelChange record in between. Returns the change id.
   */
  async function makeModelTransition(): Promise<{
    nodeId: string;
    changeId: string;
    signalId: string;
  }> {
    const nodeId = await insertCoreNode(clientId, 72);
    const signalId = await insertSignal(clientId);
    await generateSnapshot(specialist.client, { clientId, reason: "before explain" });

    await admin.from("core_nodes").update({ confidence_score: 88 }).eq("id", nodeId);
    const change = await recordModelChange(specialist.client, {
      organizationId: orgId,
      clientId,
      entityType: "core_node",
      entityId: nodeId,
      previousState: { confidence_score: 72 },
      newState: { confidence_score: 88 },
      changeReason: "Новые независимые сигналы в контекстах работа и авторитет",
      evidenceRefs: [signalId],
    });
    await generateSnapshot(specialist.client, { clientId, reason: "after explain" });
    return { nodeId, changeId: change.id, signalId };
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Explanations Org ${crypto.randomUUID()}`,
    });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    clientId = await createClientRow();
    await grantConsent("data_storage", clientId);
    await grantConsent("sensitive_psychological_data", clientId);
    await grantConsent("ai_analysis", clientId);
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("full flow: model change → snapshot diff → pending explanation → approve", async () => {
    const { nodeId, changeId, signalId } = await makeModelTransition();

    const nodeBefore = await admin.from("core_nodes").select("*").eq("id", nodeId).single();
    const changesBefore = await listModelChanges(specialist.client, {
      organizationId: orgId,
      clientId,
    });

    const provider = new ExplainingProvider("ok");
    const explanation = await explainModelChanges(specialist.client, provider, { clientId });

    expect(provider.calls).toBe(1);
    expect(explanation.status).toBe("pending");
    expect(explanation.source).toBe("ai");
    expect(explanation.run_id).not.toBeNull();
    expect(explanation.grounding_errors).toEqual([]);
    expect(explanation.before_snapshot_id).not.toBeNull();
    expect(explanation.after_snapshot_id).not.toBeNull();

    // The explanation only references the real ModelChange record.
    expect(explanation.explanations).toHaveLength(1);
    expect(explanation.explanations[0].model_change_id).toBe(changeId);
    expect(explanation.explanations[0].evidence_refs).toEqual([signalId]);
    expect(explanation.grounding.model_change_ids).toContain(changeId);
    expect(explanation.grounding.evidence_ids).toContain(signalId);

    // Before/after accuracy: the AI input carried the deterministic values.
    const payload = provider.lastPayload as {
      model_changes: {
        id: string;
        previous_state: { confidence_score: number };
        new_state: { confidence_score: number };
      }[];
      score_diffs: Record<string, number>;
      before_snapshot: { version: number };
      after_snapshot: { version: number };
      supporting_evidence: { id: string }[];
    };
    const payloadChange = payload.model_changes.find((change) => change.id === changeId)!;
    expect(payloadChange.previous_state.confidence_score).toBe(72);
    expect(payloadChange.new_state.confidence_score).toBe(88);
    expect(payload.score_diffs[`active_core_nodes.${nodeId}.confidence_score`]).toBe(16);
    expect(payload.after_snapshot.version).toBe(payload.before_snapshot.version + 1);
    expect(payload.supporting_evidence.map((item) => item.id)).toContain(signalId);

    // The AI explanation never touches domain tables.
    const nodeAfter = await admin.from("core_nodes").select("*").eq("id", nodeId).single();
    expect(nodeAfter.data).toEqual(nodeBefore.data);
    const changesAfter = await listModelChanges(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(changesAfter.items.map((change) => change.id)).toEqual(
      changesBefore.items.map((change) => change.id)
    );

    // Human review: approve.
    const approved = await reviewModelExplanation(specialist.client, {
      explanationId: explanation.id,
      decision: "approve",
    });
    expect(approved.status).toBe("approved");
    expect(approved.decided_by).toBe(specialist.id);
    expect(approved.decided_at).not.toBeNull();

    // Reviewing twice is rejected.
    await expect(
      reviewModelExplanation(specialist.client, {
        explanationId: explanation.id,
        decision: "approve",
      })
    ).rejects.toThrow(/already reviewed/i);
  });

  it("fabricated-change rejection: invented change ids are rejected and can never be approved", async () => {
    await makeModelTransition();

    const provider = new ExplainingProvider("fabricated_change");
    const explanation = await explainModelChanges(specialist.client, provider, { clientId });

    expect(provider.calls).toBe(1);
    expect(explanation.status).toBe("rejected");
    expect(explanation.grounding_errors).toHaveLength(1);
    expect(explanation.grounding_errors[0]).toContain("fabricated model_change_id");

    // A human cannot approve a grounded-out explanation.
    await expect(
      reviewModelExplanation(specialist.client, {
        explanationId: explanation.id,
        decision: "approve",
      })
    ).rejects.toThrow(/already reviewed/i);
  });

  it("fabricated evidence refs are rejected even on a real change", async () => {
    await makeModelTransition();

    const provider = new ExplainingProvider("fabricated_evidence");
    const explanation = await explainModelChanges(specialist.client, provider, { clientId });

    expect(explanation.status).toBe("rejected");
    expect(explanation.grounding_errors[0]).toContain("fabricated evidence_ref");
  });

  it("insufficient data is named explicitly and the AI is not called", async () => {
    // Fresh client: no snapshots, no model changes.
    const emptyClientId = await createClientRow();
    await grantConsent("data_storage", emptyClientId);
    await grantConsent("sensitive_psychological_data", emptyClientId);
    await grantConsent("ai_analysis", emptyClientId);

    const provider = new ExplainingProvider("ok");
    const explanation = await explainModelChanges(specialist.client, provider, {
      clientId: emptyClientId,
    });

    expect(provider.calls).toBe(0);
    expect(explanation.source).toBe("deterministic_guard");
    expect(explanation.status).toBe("pending");
    expect(explanation.explanations).toEqual([]);
    expect(explanation.missing_evidence).toEqual(
      expect.arrayContaining(["snapshots", "previous_snapshot", "model_changes"])
    );

    // Snapshots exist but nothing changed since the previous one.
    await generateSnapshot(specialist.client, { clientId: emptyClientId, reason: "v1" });
    await generateSnapshot(specialist.client, { clientId: emptyClientId, reason: "v2" });
    const noChanges = await explainModelChanges(specialist.client, provider, {
      clientId: emptyClientId,
    });
    expect(provider.calls).toBe(0);
    expect(noChanges.source).toBe("deterministic_guard");
    expect(noChanges.missing_evidence).toContain("model_changes");
    expect(noChanges.missing_evidence).not.toContain("previous_snapshot");
  });

  it("lists explanations for a client and reads one back", async () => {
    const page = await listModelExplanations(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(page.items.length).toBeGreaterThanOrEqual(3);
    for (const item of page.items) {
      expect(item.client_id).toBe(clientId);
    }

    const reread = await getModelExplanation(specialist.client, page.items[0].id);
    expect(reread.id).toBe(page.items[0].id);

    const rejectedOnly = await listModelExplanations(specialist.client, {
      organizationId: orgId,
      clientId,
      status: "rejected",
    });
    expect(rejectedOnly.items.length).toBeGreaterThanOrEqual(2);
    for (const item of rejectedOnly.items) {
      expect(item.status).toBe("rejected");
    }
  });

  it("RLS: another organization cannot read, explain or review", async () => {
    const page = await listModelExplanations(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    const existing = page.items[0];

    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    await outsider.client.rpc("create_organization", {
      org_name: `Other Org ${crypto.randomUUID()}`,
    });

    const foreignPage = await listModelExplanations(outsider.client, {
      organizationId: orgId,
      clientId,
    });
    expect(foreignPage.items).toHaveLength(0);

    await expect(getModelExplanation(outsider.client, existing.id)).rejects.toThrow(/not found/i);
    await expect(
      explainModelChanges(outsider.client, new ExplainingProvider("ok"), { clientId })
    ).rejects.toThrow();
    await expect(
      reviewModelExplanation(outsider.client, {
        explanationId: existing.id,
        decision: "reject",
      })
    ).rejects.toThrow(/not found/i);
  });
});
