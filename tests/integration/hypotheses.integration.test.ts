import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addContradiction,
  confidenceWithContradictions,
  createHypothesis,
} from "@/lib/service/hypotheses";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("differential hypotheses + contradictions (ticket 26)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Hypo Org" });
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
      p_display_name: "Hypo Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("multiple hypotheses coexist without an automatic winner", async () => {
    await createHypothesis(specialist.client, orgId, {
      clientId,
      title: "A: authority/father dynamic",
    });
    await createHypothesis(specialist.client, orgId, {
      clientId,
      title: "B: real workplace threat",
    });
    await createHypothesis(specialist.client, orgId, {
      clientId,
      title: "C: previous firing trauma",
    });

    const { data: hypotheses } = await specialist.client
      .from("differential_hypotheses")
      .select("id, status")
      .eq("client_id", clientId);
    expect(hypotheses).toHaveLength(3);
    // no winner: all remain hypothesis status
    expect(hypotheses!.every((h) => h.status === "hypothesis")).toBe(true);
  });

  it("contradicting evidence lowers confidence", async () => {
    const id = await createHypothesis(specialist.client, orgId, {
      clientId,
      title: "Гипотеза о страхе",
      confidenceScore: 60,
    });

    await addContradiction(specialist.client, orgId, id, "signal-1");
    await addContradiction(specialist.client, orgId, id, "signal-2");

    const { data: h } = await specialist.client
      .from("differential_hypotheses")
      .select("confidence_score, evidence_against")
      .eq("id", id)
      .maybeSingle();
    expect(h?.evidence_against).toHaveLength(2);
    expect(h?.confidence_score).toBe(40);
  });

  it("confidence floor is 0 and contradiction math is deterministic", () => {
    expect(confidenceWithContradictions(60, 2)).toBe(40);
    expect(confidenceWithContradictions(15, 5)).toBe(0);
  });
});
