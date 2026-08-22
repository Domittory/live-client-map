import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AiProvider, AiProviderCall, AiProviderResponse } from "@/lib/ai/provider";
import { updateResources } from "@/lib/service/ai-resources";

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

describe.skipIf(!available)("updateResources (ticket 36)", () => {
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

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "AI Resource Org" });
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
      p_display_name: "AI Resource Client",
    });
    clientId = cid;

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

  it("creates a pending resource with independent evidence refs", async () => {
    const provider = new StubProvider();
    const evidence = [crypto.randomUUID(), crypto.randomUUID()];
    provider.results["ai.update-resources.v1"] = {
      resource_proposals: [
        {
          candidate_key: "r1",
          action: "create",
          existing_resource_id: null,
          name: "Здоровые границы",
          description: "навык выстраивать границы",
          domain: "relationships",
          proposed_strength: 55,
          proposed_confidence: 60,
          proposed_trend: "stable",
          evidence_refs: evidence,
          rationale: "наблюдения",
        },
      ],
    };

    const ids = await updateResources(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      existingResources: [],
      positiveEvidence: [],
      observations: [],
      behavioralMarkers: [],
      coreNodeChanges: [],
      existingLinks: [],
    });

    expect(ids).toHaveLength(1);
    const { data: resource } = await specialist.client
      .from("resources")
      .select("name, review_status, evidence_refs, strength_score")
      .eq("id", ids[0])
      .maybeSingle();
    expect(resource?.name).toBe("Здоровые границы");
    expect(resource?.review_status).toBe("pending");
    expect(resource?.evidence_refs).toEqual(evidence);
    expect(resource?.strength_score).toBe(55);
  });

  it("never auto-creates a resource from a weakening CoreNode change", async () => {
    const provider = new StubProvider();
    // The AI returns no proposals even though a CoreNode weakened.
    provider.results["ai.update-resources.v1"] = { resource_proposals: [] };

    const ids = await updateResources(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      existingResources: [],
      positiveEvidence: [],
      observations: [],
      behavioralMarkers: [],
      coreNodeChanges: [{ id: crypto.randomUUID(), status: "weakened" }],
      existingLinks: [],
    });

    expect(ids).toHaveLength(0);
  });

  it("links evidence to an existing resource instead of creating a duplicate", async () => {
    const { data: created } = await specialist.client
      .from("resources")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: "Внутренняя опора",
        evidence_refs: [crypto.randomUUID()],
      })
      .select("id")
      .single();
    const existingId = created!.id;

    const newEvidence = crypto.randomUUID();
    const provider = new StubProvider();
    provider.results["ai.update-resources.v1"] = {
      resource_proposals: [
        {
          candidate_key: "r2",
          action: "link_existing",
          existing_resource_id: existingId,
          name: "Внутренняя опора",
          description: "",
          domain: null,
          proposed_strength: null,
          proposed_confidence: null,
          proposed_trend: "unknown",
          evidence_refs: [newEvidence],
          rationale: "связь с существующим",
        },
      ],
    };

    const ids = await updateResources(specialist.client, provider, {
      organizationId: orgId,
      clientId,
      existingResources: [{ id: existingId, name: "Внутренняя опора", domain: null }],
      positiveEvidence: [],
      observations: [],
      behavioralMarkers: [],
      coreNodeChanges: [],
      existingLinks: [],
    });

    expect(ids).toEqual([existingId]);
    const { data: resource } = await specialist.client
      .from("resources")
      .select("evidence_refs")
      .eq("id", existingId)
      .maybeSingle();
    expect(resource?.evidence_refs).toContain(newEvidence);
    // Still only one resource — no duplicate was created.
    const { count } = await specialist.client
      .from("resources")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("name", "Внутренняя опора");
    expect(count).toBe(1);
  });
});
