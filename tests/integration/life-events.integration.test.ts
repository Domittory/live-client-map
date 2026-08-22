import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLifeEvent, createTrigger } from "@/lib/service/life-events";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("life events + triggers (ticket 19)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Events Org" });
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
      p_display_name: "Events Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("life event exists without a trigger", async () => {
    const id = await createLifeEvent(specialist.client, orgId, {
      clientId,
      title: "Смена работы",
    });
    const { data: triggers } = await specialist.client
      .from("triggers")
      .select("id")
      .eq("life_event_id", id);
    expect(triggers).toHaveLength(0);
  });

  it("trigger can exist without a life event", async () => {
    const id = await createTrigger(specialist.client, orgId, {
      clientId,
      title: "Страх начальника",
    });
    const { data: trigger } = await specialist.client
      .from("triggers")
      .select("life_event_id")
      .eq("id", id)
      .maybeSingle();
    expect(trigger?.life_event_id).toBeNull();
  });

  it("trigger can reference one life event", async () => {
    const eventId = await createLifeEvent(specialist.client, orgId, {
      clientId,
      title: "Развод",
    });
    const triggerId = await createTrigger(specialist.client, orgId, {
      clientId,
      title: "Триггер развода",
      lifeEventId: eventId,
    });
    const { data: trigger } = await specialist.client
      .from("triggers")
      .select("life_event_id")
      .eq("id", triggerId)
      .maybeSingle();
    expect(trigger?.life_event_id).toBe(eventId);
  });

  it("validates intensity and visibility", async () => {
    await expect(
      createTrigger(specialist.client, orgId, { clientId, title: "bad", intensity: 150 })
    ).rejects.toThrow();
    await expect(
      createLifeEvent(specialist.client, orgId, { clientId, title: "bad", visibility: "public" })
    ).rejects.toThrow();
  });
});
