import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveCoreNode,
  confirmCoreNode,
  createCoreNode,
  linkTheme,
  rejectCoreNode,
} from "@/lib/service/core-nodes";
import { createTheme } from "@/lib/service/themes";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("core nodes + theme links (ticket 25)", () => {
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "CoreNode Org" });
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
      p_display_name: "CoreNode Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates a working hypothesis and confirms it", async () => {
    const nodeId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: "Внешнее признание",
      hypothesis: "Поиск отцовского признания в начальнике",
      confidenceScore: 60,
    });

    const { data: node } = await specialist.client
      .from("core_nodes")
      .select("status, confidence_score, created_by")
      .eq("id", nodeId)
      .maybeSingle();
    expect(node?.status).toBe("hypothesis");
    expect(node?.confidence_score).toBe(60);
    expect(node?.created_by).toBe(specialist.id);

    await confirmCoreNode(specialist.client, orgId, nodeId);
    const { data: confirmed } = await specialist.client
      .from("core_nodes")
      .select("status, last_confirmed_by")
      .eq("id", nodeId)
      .maybeSingle();
    expect(confirmed?.status).toBe("active");
    expect(confirmed?.last_confirmed_by).toBe(specialist.id);
  });

  it("links a theme with rationale and author", async () => {
    const nodeId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: "Гиперответственность",
    });
    const themeId = await createTheme(specialist.client, orgId, {
      clientId,
      name: "Ответственность",
    });

    await linkTheme(specialist.client, orgId, {
      coreNodeId: nodeId,
      themeId,
      relationshipType: "supports",
      confidence: 70,
      linkRationale: "тема подтверждает гипотезу",
    });

    const { data: link } = await specialist.client
      .from("theme_core_node_links")
      .select("relationship_type, link_rationale, created_by")
      .eq("core_node_id", nodeId)
      .eq("theme_id", themeId)
      .maybeSingle();
    expect(link?.relationship_type).toBe("supports");
    expect(link?.link_rationale).toBe("тема подтверждает гипотезу");
    expect(link?.created_by).toBe(specialist.id);
  });

  it("reject and archive are preserved in history", async () => {
    const rejectedId = await createCoreNode(specialist.client, orgId, {
      clientId,
      title: "Отклонённая гипотеза",
    });
    await rejectCoreNode(specialist.client, orgId, rejectedId);

    const { data: rejected } = await specialist.client
      .from("core_nodes")
      .select("status")
      .eq("id", rejectedId)
      .maybeSingle();
    expect(rejected?.status).toBe("rejected");

    await archiveCoreNode(specialist.client, orgId, rejectedId);
    const { data: archived } = await specialist.client
      .from("core_nodes")
      .select("status, archived_at")
      .eq("id", rejectedId)
      .maybeSingle();
    expect(archived?.status).toBe("archived");
    expect(archived?.archived_at).not.toBeNull();
  });
});
