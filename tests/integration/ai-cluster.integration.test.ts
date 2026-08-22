import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { classifyThemes, clusterEvidence } from "@/lib/service/ai-cluster";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

class StubProvider implements AiProvider {
  readonly providerKey = "stub";
  readonly modelSnapshot = "stub-1";
  readonly reasoningEffort = "none";
  results: Record<string, unknown> = {};

  async complete(call: AiProviderCall): Promise<AiProviderResponse> {
    const result = this.results[call.functionId] ?? {};
    return {
      ok: true,
      output: {
        contract_version: call.contractVersion,
        request_id: (call.envelope as { request_id: string }).request_id,
        warnings: [],
        safety: { review_required: false, categories: [], rationale: "" },
        result,
      },
      inputTokens: 1,
      outputTokens: 1,
    };
  }
}

describe.skipIf(!available)("clusterEvidence + classifyThemes (ticket 34)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let sessionId: string;
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

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "AI Cluster Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "AI Cluster Client",
    });
    clientId = cid;

    const { data: sid } = await specialist.client
      .from("diagnostic_sessions")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "s",
        session_type: "individual",
      })
      .select("id")
      .single();
    sessionId = sid!.id;

    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "ai_analysis",
      document_version: "1.0",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("clusterEvidence creates a cluster with deterministic (non-inflated) weight", async () => {
    const provider = new StubProvider();
    provider.results["ai.cluster-evidence.v1"] = {
      clusters: [
        {
          candidate_key: "c1",
          action: "create",
          existing_cluster_id: null,
          semantic_topic: "fear_of_authority",
          signal_ids: [crypto.randomUUID(), crypto.randomUUID()],
          context_key: "work|",
          independence_assessment: "same_context",
          rationale: "одна тема",
        },
      ],
    };

    const ids = await clusterEvidence(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      diagnosticSessionId: sessionId,
      signals: [],
      existingClusters: [],
    });

    expect(ids).toHaveLength(1);
    const { data: cluster } = await specialist.client
      .from("evidence_clusters")
      .select("signals_count, independent_weight, semantic_topic")
      .eq("id", ids[0])
      .maybeSingle();
    expect(cluster?.signals_count).toBe(2);
    // AI never inflates independence: deterministic weight is 1.
    expect(cluster?.independent_weight).toBe(1);
    expect(cluster?.semantic_topic).toBe("fear_of_authority");
  });

  it("classifyThemes creates a pending theme with a link rationale", async () => {
    const provider = new StubProvider();
    const { data: sig } = await specialist.client
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "утверждение",
        review_status: "approved",
      })
      .select("id")
      .single();
    const signalId = sig!.id;
    provider.results["ai.classify-themes.v1"] = {
      theme_proposals: [
        {
          candidate_key: "t1",
          action: "create",
          existing_theme_id: null,
          name: "Страх авторитета",
          description: "тема",
          domain: null,
          confidence: 60,
          signal_links: [
            { signal_id: signalId, relevance_score: 80, link_rationale: "подтверждает" },
          ],
          rationale: "кластеризация",
        },
      ],
    };

    const themeIds = await classifyThemes(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      reviewedSignals: [],
      evidenceClusters: [],
      existingThemes: [],
      currentModelSummary: "",
    });

    expect(themeIds).toHaveLength(1);
    const { data: theme } = await specialist.client
      .from("themes")
      .select("name, review_status")
      .eq("id", themeIds[0])
      .maybeSingle();
    expect(theme?.name).toBe("Страх авторитета");
    expect(theme?.review_status).toBe("pending");
  });
});
