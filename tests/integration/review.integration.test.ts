import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { countsAsConfirmedEvidence, reviewSignal } from "@/lib/service/review";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("human review (ticket 23)", () => {
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

  async function createSignal(specialistClient: SupabaseClient): Promise<string> {
    const { data } = await specialistClient
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Тестовое утверждение",
        review_status: "pending",
      })
      .select("id")
      .single();
    return data!.id;
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Review Org" });
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
      p_display_name: "Review Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("approve and reject update review_status", async () => {
    const id = await createSignal(specialist.client);
    await reviewSignal(specialist.client, orgId, id, "approve");
    const { data: approved } = await specialist.client
      .from("signals")
      .select("review_status")
      .eq("id", id)
      .maybeSingle();
    expect(approved?.review_status).toBe("approved");

    await reviewSignal(specialist.client, orgId, id, "reject");
    const { data: rejected } = await specialist.client
      .from("signals")
      .select("review_status")
      .eq("id", id)
      .maybeSingle();
    expect(rejected?.review_status).toBe("rejected");
  });

  it("mark_sensitive and hide update visibility", async () => {
    const id = await createSignal(specialist.client);
    await reviewSignal(specialist.client, orgId, id, "mark_sensitive");
    const { data: sensitive } = await specialist.client
      .from("signals")
      .select("visibility")
      .eq("id", id)
      .maybeSingle();
    expect(sensitive?.visibility).toBe("sensitive");

    await reviewSignal(specialist.client, orgId, id, "hide");
    const { data: hidden } = await specialist.client
      .from("signals")
      .select("visibility")
      .eq("id", id)
      .maybeSingle();
    expect(hidden?.visibility).toBe("internal");
  });

  it("writes an audit record per review action", async () => {
    const id = await createSignal(specialist.client);
    await reviewSignal(specialist.client, orgId, id, "approve", "одобрено вручную");
    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("entity_id", id)
      .eq("action", "review.approve");
    expect(audit).toHaveLength(1);
  });

  it("pending/rejected are not confirmed evidence", () => {
    expect(countsAsConfirmedEvidence("approved")).toBe(true);
    expect(countsAsConfirmedEvidence("pending")).toBe(false);
    expect(countsAsConfirmedEvidence("rejected")).toBe(false);
  });
});
