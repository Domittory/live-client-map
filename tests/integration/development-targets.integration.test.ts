import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDevelopmentTarget } from "@/lib/service/development-targets";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("development targets (ticket 30)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Targets Org" });
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
      p_display_name: "Targets Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates a target with resources, core nodes and success markers", async () => {
    const resourceA = crypto.randomUUID();
    const resourceB = crypto.randomUUID();
    const nodeA = crypto.randomUUID();

    const id = await createDevelopmentTarget(specialist.client, orgId, {
      clientId,
      name: "Спокойная сила",
      currentLevel: 30,
      targetLevel: 70,
      linkedResources: [resourceA, resourceB],
      linkedCoreNodes: [nodeA],
      successMarkers: ["уверенно выступает на совещаниях"],
    });

    const { data: target } = await specialist.client
      .from("development_targets")
      .select(
        "name, current_level, target_level, linked_resources, linked_core_nodes, success_markers"
      )
      .eq("id", id)
      .maybeSingle();

    expect(target?.name).toBe("Спокойная сила");
    expect(target?.current_level).toBe(30);
    expect(target?.target_level).toBe(70);
    expect(target?.linked_resources).toHaveLength(2);
    expect(target?.linked_core_nodes).toHaveLength(1);
    expect(target?.success_markers).toEqual(["уверенно выступает на совещаниях"]);
  });

  it("validates the level scale (0–100)", async () => {
    await expect(
      createDevelopmentTarget(specialist.client, orgId, {
        clientId,
        name: "bad",
        currentLevel: 150,
      })
    ).rejects.toThrow();
  });
});
