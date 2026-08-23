import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { exportClientArchive, exportSignalsCsv } from "@/lib/service/export";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Export JSON/CSV (ticket 55)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let owner: { id: string; client: SupabaseClient };
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
    owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Export Org" });
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
      p_display_name: "Export Client",
    });
    clientId = cid;

    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: "data_storage",
      document_version: "1.0",
    });

    await specialist.client.from("signals").insert({
      organization_id: orgId,
      client_id: clientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: "Мне трудно просить о помощи",
      statement_polarity: "negative",
      test_result: "not_tested",
      review_status: "approved",
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("exports Signals CSV preserving raw statement, source and review status", async () => {
    const csv = await exportSignalsCsv(specialist.client, { clientId });
    expect(csv).toContain("live-client-map.signals-csv/1.0");
    expect(csv).toContain("Мне трудно просить о помощи");
    expect(csv).toContain("client_report");
    expect(csv).toContain("approved");
  });

  it("exports a versioned JSON archive only for the owner, excluding private notes", async () => {
    const archive = (await exportClientArchive(owner.client, { clientId })) as {
      contract: string;
      version: string;
      data: { client: Record<string, unknown> | null; signals: unknown[] };
    };
    expect(archive.contract).toBe("live-client-map.client-archive");
    expect(archive.version).toBe("1.0");
    expect(archive.data.signals.length).toBeGreaterThan(0);
    expect("specialist_notes_private" in (archive.data.client ?? {})).toBe(false);

    await expect(exportClientArchive(specialist.client, { clientId })).rejects.toThrow();
  });

  it("rejects export for an unassigned client", async () => {
    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    await expect(exportSignalsCsv(outsider.client, { clientId })).rejects.toThrow();
  });
});
