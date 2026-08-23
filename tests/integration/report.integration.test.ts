import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildSnapshotReport,
  exportSnapshotReportMarkdown,
  exportSnapshotReportPdf,
  resolveLatestSnapshotVersion,
} from "@/lib/service/report";
import { generateSnapshot } from "@/lib/service/snapshots";

/**
 * Ticket 56 — the privacy rules of §13 against a real database and real RLS.
 * The pure rendering rules live in tests/unit/report.unit.test.ts; what needs a
 * database is who may see what.
 */

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

const PDF_TIMEOUT_MS = 45_000;

const INTERNAL_NODE = "Внутренняя гипотеза о контроле";
const SENSITIVE_NODE = "Чувствительная гипотеза о травме";
const CLIENT_NODE = "Открытая клиенту опора на близких";

describe.skipIf(!available)("Snapshot report Markdown/PDF (ticket 56)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let snapshotVersion: number;
  let primary: { id: string; client: SupabaseClient };
  let secondary: { id: string; client: SupabaseClient };

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
    primary = await createUser(`report-primary-${crypto.randomUUID()}@example.com`);
    const { data: org } = await primary.client.rpc("create_organization", {
      org_name: "Report Org",
    });
    orgId = org;

    const { data: cid } = await primary.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Отчётный клиент",
    });
    clientId = cid;

    for (const consent of ["data_storage", "sensitive_psychological_data"]) {
      await admin.from("consent_records").insert({
        organization_id: orgId,
        client_id: clientId,
        consent_type: consent,
        document_version: "1.0",
      });
    }

    // Three core nodes, one per visibility level, plus two themes.
    await admin.from("core_nodes").insert([
      {
        organization_id: orgId,
        client_id: clientId,
        title: INTERNAL_NODE,
        status: "active",
        visibility: "internal",
        confidence_score: 70,
      },
      {
        organization_id: orgId,
        client_id: clientId,
        title: SENSITIVE_NODE,
        status: "active",
        visibility: "sensitive",
        confidence_score: 80,
      },
      {
        organization_id: orgId,
        client_id: clientId,
        title: CLIENT_NODE,
        status: "active",
        visibility: "client_visible",
        confidence_score: 60,
      },
    ]);
    await admin.from("themes").insert([
      {
        organization_id: orgId,
        client_id: clientId,
        name: "Тема только для специалиста",
        status: "active",
        visibility: "internal",
      },
      {
        organization_id: orgId,
        client_id: clientId,
        name: "Тема, открытая клиенту",
        status: "active",
        visibility: "client_visible",
      },
    ]);

    const snapshot = await generateSnapshot(primary.client, {
      clientId,
      reason: "Отчёт по тикету 56",
    });
    snapshotVersion = snapshot.version;

    secondary = await createUser(`report-secondary-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: secondary.id,
      role: "specialist",
      status: "active",
    });
    await admin.from("client_assignments").insert({
      client_id: clientId,
      user_id: secondary.id,
      access_role: "secondary_specialist",
    });
  }, 60_000);

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("resolves the latest snapshot version for the UI", async () => {
    expect(await resolveLatestSnapshotVersion(primary.client, clientId)).toBe(snapshotVersion);
  });

  it("gives the primary specialist internal and sensitive material", async () => {
    const report = await exportSnapshotReportMarkdown(primary.client, {
      clientId,
      snapshotVersion,
      audience: "specialist",
    });

    expect(report.content).toContain(INTERNAL_NODE);
    expect(report.content).toContain(SENSITIVE_NODE);
    expect(report.content).toContain(CLIENT_NODE);
    expect(report.content).toContain("Тема только для специалиста");
    expect(report.model.snapshot_version).toBe(snapshotVersion);
  });

  it("withholds sensitive material from a secondary specialist and says so", async () => {
    const report = await exportSnapshotReportMarkdown(secondary.client, {
      clientId,
      snapshotVersion,
      audience: "specialist",
    });

    expect(report.content).toContain(INTERNAL_NODE);
    expect(report.content).not.toContain(SENSITIVE_NODE);
    // §10 forbids silent truncation: the omission must be visible.
    expect(report.content).toContain("Скрыто по уровню доступа");
  });

  it("gives the client only client-visible material, never risk or mechanics", async () => {
    const report = await exportSnapshotReportMarkdown(primary.client, {
      clientId,
      snapshotVersion,
      audience: "client",
    });

    expect(report.content).toContain(CLIENT_NODE);
    expect(report.content).toContain("Тема, открытая клиенту");
    expect(report.content).not.toContain(INTERNAL_NODE);
    expect(report.content).not.toContain(SENSITIVE_NODE);
    expect(report.content).not.toContain("Тема только для специалиста");
    // Risk assessments and internal digests are forbidden in a client report.
    expect(report.content).not.toContain("Зоны риска");
    expect(report.content).not.toContain("core node evidence");
    expect(report.content).toContain("Нет подтверждённых данных");
  });

  it(
    "renders Markdown and PDF from one and the same read model",
    async () => {
      const query = { clientId, snapshotVersion, audience: "specialist" as const };
      const markdown = await exportSnapshotReportMarkdown(primary.client, query);
      const pdf = await exportSnapshotReportPdf(primary.client, query);

      // Content equality is defined on the normalized read model (§13), not on
      // the bytes: export id and timestamp legitimately differ per generation.
      expect(pdf.model.sections).toEqual(markdown.model.sections);
      expect(pdf.model.snapshot_version).toBe(markdown.model.snapshot_version);
      expect(pdf.model.model_hash).toBe(markdown.model.model_hash);

      expect(Buffer.from(pdf.bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
      expect(pdf.filename.endsWith(".pdf")).toBe(true);
      // Filenames carry an opaque reference only — never the client's name.
      expect(pdf.filename).not.toContain("Отчётный");
      expect(markdown.filename).not.toContain("Отчётный");
    },
    PDF_TIMEOUT_MS
  );

  it("writes an audit trail and changes no business state", async () => {
    const before = await admin
      .from("core_nodes")
      .select("id, updated_at")
      .eq("client_id", clientId)
      .order("id");

    await exportSnapshotReportMarkdown(primary.client, {
      clientId,
      snapshotVersion,
      audience: "specialist",
    });

    const after = await admin
      .from("core_nodes")
      .select("id, updated_at")
      .eq("client_id", clientId)
      .order("id");
    expect(after.data).toEqual(before.data);

    const { data: audit } = await admin
      .from("audit_log")
      .select("action")
      .eq("entity_id", clientId)
      .eq("action", "export.snapshot_report_markdown");
    expect((audit ?? []).length).toBeGreaterThan(0);
  });

  it("refuses an unknown snapshot version and an unassigned client", async () => {
    await expect(
      buildSnapshotReport(primary.client, {
        clientId,
        snapshotVersion: snapshotVersion + 999,
        audience: "specialist",
      })
    ).rejects.toThrow();

    const outsider = await createUser(`report-outsider-${crypto.randomUUID()}@example.com`);
    await expect(
      buildSnapshotReport(outsider.client, { clientId, snapshotVersion, audience: "specialist" })
    ).rejects.toThrow();
  });
});
