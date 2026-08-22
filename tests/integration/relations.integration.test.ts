import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  confirmCausalRelation,
  createRelation,
  createTriggerActivation,
} from "@/lib/service/relations";
import { createCoreNode } from "@/lib/service/core-nodes";
import { createTrigger } from "@/lib/service/life-events";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("core node relations + trigger activations (ticket 27)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Relations Org" });
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
      p_display_name: "Relations Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates a relation with an allowed type", async () => {
    const a = await createCoreNode(specialist.client, orgId, { clientId, title: "Узел A" });
    const b = await createCoreNode(specialist.client, orgId, { clientId, title: "Узел B" });

    const relId = await createRelation(specialist.client, orgId, {
      clientId,
      fromCoreNodeId: a,
      toCoreNodeId: b,
      relationType: "may_contribute_to",
      strength: 50,
      confidence: 60,
    });

    const { data: rel } = await specialist.client
      .from("core_node_relations")
      .select("relation_type, strength, confidence")
      .eq("id", relId)
      .maybeSingle();
    expect(rel?.relation_type).toBe("may_contribute_to");
    expect(rel?.strength).toBe(50);
  });

  it("rejects the forbidden causal types from the AI/service path", async () => {
    const a = await createCoreNode(specialist.client, orgId, { clientId, title: "C1" });
    const b = await createCoreNode(specialist.client, orgId, { clientId, title: "C2" });

    await expect(
      createRelation(specialist.client, orgId, {
        clientId,
        fromCoreNodeId: a,
        toCoreNodeId: b,
        relationType: "causes",
      })
    ).rejects.toThrow();
    await expect(
      createRelation(specialist.client, orgId, {
        clientId,
        fromCoreNodeId: a,
        toCoreNodeId: b,
        relationType: "causes_confirmed",
      })
    ).rejects.toThrow();
  });

  it("human confirmation sets causes_confirmed with an audit reason", async () => {
    const a = await createCoreNode(specialist.client, orgId, { clientId, title: "D1" });
    const b = await createCoreNode(specialist.client, orgId, { clientId, title: "D2" });
    const relId = await createRelation(specialist.client, orgId, {
      clientId,
      fromCoreNodeId: a,
      toCoreNodeId: b,
      relationType: "associated_with",
    });

    await expect(confirmCausalRelation(specialist.client, orgId, relId, "")).rejects.toThrow();

    await confirmCausalRelation(specialist.client, orgId, relId, "подтверждено специалистом");
    const { data: rel } = await specialist.client
      .from("core_node_relations")
      .select("relation_type")
      .eq("id", relId)
      .maybeSingle();
    expect(rel?.relation_type).toBe("causes_confirmed");
  });

  it("stores trigger activation delta, confidence and rationale", async () => {
    const triggerId = await createTrigger(specialist.client, orgId, {
      clientId,
      title: "Триггер начальника",
    });
    const actId = await createTriggerActivation(specialist.client, orgId, {
      triggerId,
      activationDelta: 35,
      confidence: 70,
      rationale: "активация при контакте с начальником",
    });

    const { data: act } = await specialist.client
      .from("trigger_activations")
      .select("activation_delta, confidence, rationale")
      .eq("id", actId)
      .maybeSingle();
    expect(act?.activation_delta).toBe(35);
    expect(act?.confidence).toBe(70);
    expect(act?.rationale).toBe("активация при контакте с начальником");
  });
});
