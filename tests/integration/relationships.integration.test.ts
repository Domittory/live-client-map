import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createRelationship,
  createRelationshipDynamic,
  listRelationshipDynamics,
} from "@/lib/service/relationships";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Relationship + RelationshipDynamic (ticket 50)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let otherOrgId: string;
  let clientAId: string;
  let clientBId: string;
  let clientCId: string; // same org, specialist NOT assigned
  let otherOrgClientId: string;
  let relId: string;
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

  async function grantRelationshipConsent(clientId: string) {
    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "relationship_analysis",
      document_version: "1.0",
    });
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: "Relationship Org",
    });
    orgId = data;

    const otherOwner = await createUser(`owner2-${crypto.randomUUID()}@example.com`);
    const { data: other } = await otherOwner.client.rpc("create_organization", {
      org_name: "Other Org",
    });
    otherOrgId = other;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: a } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Client A",
    });
    clientAId = a;
    const { data: b } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Client B",
    });
    clientBId = b;

    // Same org, but created by a different specialist so `specialist` is not assigned.
    const otherSpecialist = await createUser(`spec2-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: otherSpecialist.id,
      role: "specialist",
      status: "active",
    });
    const { data: c } = await otherSpecialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Client C",
    });
    clientCId = c;

    const { data: otherClient } = await otherOwner.client.rpc("create_client", {
      p_organization_id: otherOrgId,
      p_display_name: "Other Org Client",
    });
    otherOrgClientId = otherClient;

    await grantRelationshipConsent(clientAId);
    await grantRelationshipConsent(clientBId);
    await grantRelationshipConsent(clientCId);

    relId = await createRelationship(specialist.client, {
      organizationId: orgId,
      clientAId,
      clientBId,
      relationshipType: "couple",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates a relationship between two permitted same-org clients", async () => {
    expect(relId).toBeTruthy();
    const { data } = await specialist.client
      .from("relationships")
      .select("client_a_id, client_b_id")
      .eq("id", relId)
      .maybeSingle();
    expect(data?.client_a_id).toBe(clientAId);
    expect(data?.client_b_id).toBe(clientBId);
  });

  it("rejects a relationship that spans organizations", async () => {
    await expect(
      createRelationship(specialist.client, {
        organizationId: orgId,
        clientAId,
        clientBId: otherOrgClientId,
        relationshipType: "couple",
      })
    ).rejects.toThrow();
  });

  it("rejects a relationship with a client the specialist is not assigned to", async () => {
    await expect(
      createRelationship(specialist.client, {
        organizationId: orgId,
        clientAId,
        clientBId: clientCId,
        relationshipType: "couple",
      })
    ).rejects.toThrow();
  });

  it("filters private signal evidence out of a dynamic", async () => {
    const { data: privateSignal } = await specialist.client
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientAId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "приватная установка",
        visibility: "internal",
      })
      .select("id")
      .single();
    const { data: visibleSignal } = await specialist.client
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientBId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "открытая установка",
        visibility: "client_visible",
      })
      .select("id")
      .single();

    const dynamicId = await createRelationshipDynamic(specialist.client, {
      organizationId: orgId,
      relationshipId: relId,
      title: "динамика",
      evidenceRefs: [privateSignal!.id, visibleSignal!.id],
    });

    const { data: dynamic } = await specialist.client
      .from("relationship_dynamics")
      .select("evidence_refs")
      .eq("id", dynamicId)
      .maybeSingle();
    expect(dynamic?.evidence_refs).not.toContain(privateSignal!.id);
    expect(dynamic?.evidence_refs).toContain(visibleSignal!.id);
  });

  it("stops new analyses and hides the view after consent revocation", async () => {
    // Revoke relationship_analysis consent for client A.
    await admin
      .from("consent_records")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientAId)
      .eq("consent_type", "relationship_analysis");

    await expect(
      createRelationshipDynamic(specialist.client, {
        organizationId: orgId,
        relationshipId: relId,
        title: "после отзыва",
      })
    ).rejects.toThrow();

    await expect(listRelationshipDynamics(specialist.client, orgId, relId)).rejects.toThrow();
  });
});
