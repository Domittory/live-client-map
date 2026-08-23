import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportSupervision } from "@/lib/service/supervision-export";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Anonymized supervision export (ticket 57)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
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
    const { data } = await owner.client.rpc("create_organization", { org_name: "Supervision Org" });
    orgId = data;

    supervisor = await createUser(`sup-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: supervisor.id,
      role: "supervisor",
      status: "active",
    });

    const { data: cid } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Supervision Client",
    });
    clientId = cid;

    // Supervisor assignment to this client.
    await admin.from("client_assignments").insert({
      client_id: clientId,
      user_id: supervisor.id,
      access_role: "supervisor",
    });

    await admin.from("consent_records").insert([
      {
        organization_id: orgId,
        client_id: clientId,
        consent_type: "supervisor_access",
        document_version: "1.0",
      },
      {
        organization_id: orgId,
        client_id: clientId,
        consent_type: "anonymized_analytics",
        document_version: "1.0",
      },
    ]);

    await admin.from("signals").insert({
      organization_id: orgId,
      client_id: clientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: "Мне трудно просить о помощи",
      review_status: "approved",
      evidence_level: "L2_MULTIPLE_SIGNALS",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("returns only allowlisted fields without direct identifiers", async () => {
    const payload = (await exportSupervision(supervisor.client, { clientId })) as {
      contract: string;
      version: string;
      case: Record<string, unknown>;
    };
    expect(payload.contract).toBe("live-client-map.supervision-export");
    expect(payload.version).toBe("1.0");

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain(clientId);
    expect(serialized).not.toContain("Мне трудно просить о помощи");
    expect(payload.case).toHaveProperty("evidence_summary");
    expect(payload.case).toHaveProperty("themes");
    expect(payload.case).toHaveProperty("core_hypotheses");
  });

  it("forbids export without supervisor_access consent", async () => {
    await admin
      .from("consent_records")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("consent_type", "supervisor_access");

    await expect(exportSupervision(supervisor.client, { clientId })).rejects.toThrow();
  });
});
