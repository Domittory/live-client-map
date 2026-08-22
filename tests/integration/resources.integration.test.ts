import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResource, updateResource } from "@/lib/service/resources";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("resources (ticket 29)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Resources Org" });
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
      p_display_name: "Resources Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates a resource as an independent entity", async () => {
    const id = await createResource(specialist.client, orgId, {
      clientId,
      name: "Внутренняя опора",
      strengthScore: 70,
      evidenceSummary: "устойчивость в конфликте",
    });

    const { data: resource } = await specialist.client
      .from("resources")
      .select("name, strength_score, evidence_summary")
      .eq("id", id)
      .maybeSingle();
    expect(resource?.name).toBe("Внутренняя опора");
    expect(resource?.strength_score).toBe(70);
  });

  it("requires evidence or reason for a score change", async () => {
    const id = await createResource(specialist.client, orgId, { clientId, name: "Границы" });

    await expect(
      updateResource(specialist.client, orgId, { id, strengthScore: 80 })
    ).rejects.toThrow();

    await updateResource(specialist.client, orgId, {
      id,
      strengthScore: 80,
      evidenceSummary: "заметное укрепление границ",
    });

    const { data: resource } = await specialist.client
      .from("resources")
      .select("strength_score")
      .eq("id", id)
      .maybeSingle();
    expect(resource?.strength_score).toBe(80);
  });
});
