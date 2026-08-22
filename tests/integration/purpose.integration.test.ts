import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPurposeProfile, createPurposeSynthesis } from "@/lib/service/purpose";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("purpose profiles + syntheses (ticket 31)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Purpose Org" });
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
      p_display_name: "Purpose Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("stores source system and raw data for a purpose profile", async () => {
    const id = await createPurposeProfile(specialist.client, orgId, {
      clientId,
      sourceSystem: "human_design",
      rawData: { type: "Projector", authority: "Emotional" },
      interpretation: "стратегия ожидания приглашения",
    });

    const { data: profile } = await specialist.client
      .from("purpose_profiles")
      .select("source_system, raw_data")
      .eq("id", id)
      .maybeSingle();
    expect(profile?.source_system).toBe("human_design");
    expect(profile?.raw_data).toEqual({ type: "Projector", authority: "Emotional" });
  });

  it("synthesis stores matches, conflicts and vectors explicitly", async () => {
    const id = await createPurposeSynthesis(specialist.client, orgId, {
      clientId,
      summary: "совпадение по теме лидерства",
      crossSystemMatches: ["лидерство"],
      potentialConflicts: ["jyotish: солнечная роль vs human design: projector"],
      recommendedDevelopmentVectors: ["спокойное лидерство"],
    });

    const { data: synthesis } = await specialist.client
      .from("purpose_syntheses")
      .select("cross_system_matches, potential_conflicts, recommended_development_vectors")
      .eq("id", id)
      .maybeSingle();
    expect(synthesis?.cross_system_matches).toEqual(["лидерство"]);
    expect(synthesis?.potential_conflicts).toHaveLength(1);
    expect(synthesis?.recommended_development_vectors).toEqual(["спокойное лидерство"]);
  });

  it("rejects an invalid source system", async () => {
    await expect(
      createPurposeProfile(specialist.client, orgId, {
        clientId,
        sourceSystem: "astrology_fact",
      })
    ).rejects.toThrow();
  });
});
