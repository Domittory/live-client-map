import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveOrgMethod,
  createOrgMethod,
  getMethod,
  listMethods,
  updateOrgMethod,
} from "@/lib/service/interventions";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("InterventionMethod library (ticket 38)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let systemMethodId: string;
  let specialist: { id: string; client: SupabaseClient };
  let supervisor: { id: string; client: SupabaseClient };

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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Methods Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    supervisor = await createUser(`sup-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: supervisor.id,
      role: "supervisor",
      status: "active",
    });

    const { data: sys } = await admin
      .from("intervention_methods")
      .insert({
        organization_id: null,
        name: `System Method ${crypto.randomUUID()}`,
        description: "глобальный системный метод",
        is_system: true,
        contraindications: ["острый кризис"],
        default_follow_up_days: 14,
      })
      .select("id")
      .single();
    systemMethodId = sys!.id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates an organization method with contraindications and follow-up", async () => {
    const method = await createOrgMethod(specialist.client, {
      organizationId: orgId,
      name: "Работа с опорой",
      description: "метод",
      category: "resource",
      contraindications: ["острое состояние"],
      defaultFollowUpDays: 7,
    });

    expect(method.is_system).toBe(false);
    expect(method.organization_id).toBe(orgId);
    expect(method.contraindications).toContain("острое состояние");
    expect(method.default_follow_up_days).toBe(7);
  });

  it("lists both system and own-org methods", async () => {
    const page = await listMethods(specialist.client, { scope: "all", includeArchived: true });
    const names = page.items.map((m) => m.name);
    expect(page.items.some((m) => m.id === systemMethodId)).toBe(true);
    expect(names).toContain("Работа с опорой");
  });

  it("forbids modifying or archiving a system method", async () => {
    await expect(
      updateOrgMethod(specialist.client, {
        methodId: systemMethodId,
        name: "изменённый",
      })
    ).rejects.toThrow();

    await expect(archiveOrgMethod(specialist.client, systemMethodId)).rejects.toThrow();
  });

  it("keeps an archived org method readable for old references", async () => {
    const created = await createOrgMethod(specialist.client, {
      organizationId: orgId,
      name: "Архивируемый метод",
      contraindications: [],
    });

    await archiveOrgMethod(specialist.client, created.id);

    const archived = await getMethod(specialist.client, created.id);
    expect(archived.archived_at).not.toBeNull();

    const activePage = await listMethods(specialist.client, { scope: "organization" });
    expect(activePage.items.some((m) => m.id === created.id)).toBe(false);

    const allPage = await listMethods(specialist.client, {
      scope: "organization",
      includeArchived: true,
    });
    expect(allPage.items.some((m) => m.id === created.id)).toBe(true);
  });

  it("enforces role-based write access (supervisor is read-only)", async () => {
    await expect(
      createOrgMethod(supervisor.client, {
        organizationId: orgId,
        name: "Запрещённый метод",
        contraindications: [],
      })
    ).rejects.toThrow();
  });
});
