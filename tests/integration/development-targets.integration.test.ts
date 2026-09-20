import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDevelopmentTarget,
  listDevelopmentTargets,
  updateDevelopmentTarget,
} from "@/lib/service/development-targets";

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

  it("updates a target atomically and requires a reason for progress changes", async () => {
    const id = await createDevelopmentTarget(specialist.client, orgId, {
      clientId,
      name: "Границы",
      currentLevel: 20,
      targetLevel: 60,
      successMarkers: ["говорит «нет» без вины"],
    });

    // A progress claim without a human reason is refused by service and SQL.
    await expect(
      updateDevelopmentTarget(specialist.client, orgId, { id, currentLevel: 45 })
    ).rejects.toThrow();

    await updateDevelopmentTarget(specialist.client, orgId, {
      id,
      currentLevel: 45,
      successMarkers: ["говорит «нет» без вины", "держит паузу перед ответом"],
      reason: "Подтверждено на сессии",
    });

    const { data: target } = await specialist.client
      .from("development_targets")
      .select("current_level, target_level, success_markers")
      .eq("id", id)
      .maybeSingle();
    expect(target?.current_level).toBe(45);
    expect(target?.target_level).toBe(60);
    expect(target?.success_markers).toHaveLength(2);

    // The audit row carries the acting specialist and the reason. The audit log
    // is Owner-readable only, so the assertion uses the service-role channel.
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, actor_user_id, reason")
      .eq("entity_id", id)
      .eq("action", "development_target.updated")
      .single();
    expect(audit?.actor_user_id).toBe(specialist.id);
    expect(audit?.reason).toBe("Подтверждено на сессии");
  });

  it("lists targets for the client and refuses a foreign field", async () => {
    const targets = await listDevelopmentTargets(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((target) => target.name.length > 0)).toBe(true);

    const id = await createDevelopmentTarget(specialist.client, orgId, {
      clientId,
      name: "Только чтение полей",
    });
    await expect(
      updateDevelopmentTarget(specialist.client, orgId, { id, status: "archived", reason: "x" })
    ).resolves.toBeUndefined();
    // organization_id is not an updatable field of the target.
    await expect(
      specialist.client.rpc("update_development_target", {
        p_org_id: orgId,
        p_target_id: id,
        p_patch: { organization_id: crypto.randomUUID() },
        p_reason: "x",
      })
    ).resolves.toMatchObject({ error: expect.objectContaining({ code: "22023" }) });
  });
});
