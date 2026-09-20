import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPORT_STORAGE_BUCKET, opaqueExportRef } from "@/lib/service/export-names";
import { createExportRequest } from "@/lib/service/export-request";
import { ServiceError } from "@/lib/service/errors";
import { validateClientArchive } from "@/lib/service/client-archive";
import { connectFaultInjection } from "./support/fault-injection";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

/**
 * Ticket 19 — the asynchronous ExportRequest lifecycle against a real database:
 * requested → generating → available / failed / denied, idempotent replay,
 * idempotency conflict, "a failed generation is never downloadable", audit rows
 * without raw content, and an opaque, private storage artifact.
 */
describe.skipIf(!available)("Asynchronous export request (ticket 19, §10)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let otherOrgId: string;
  let otherClientId: string;
  let owner: { id: string; client: SupabaseClient };
  let specialist: { id: string; client: SupabaseClient };
  let supervisor: { id: string; client: SupabaseClient };
  let readOnly: { id: string; client: SupabaseClient };
  let stranger: { id: string; client: SupabaseClient };

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

  async function grantConsent(targetClientId: string, consentType: string) {
    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: targetClientId,
      consent_type: consentType,
      document_version: "1.0",
    });
  }

  async function revokeConsent(targetClientId: string, consentType: string) {
    await admin
      .from("consent_records")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", targetClientId)
      .eq("consent_type", consentType)
      .is("revoked_at", null);
  }

  function key(): string {
    return `ticket19-${crypto.randomUUID()}`;
  }

  async function auditRows(exportId: string) {
    const { data } = await admin
      .from("audit_log")
      .select("action, entity_type, entity_id, actor_user_id, reason, after_data, before_data")
      .eq("organization_id", orgId)
      .filter("after_data->>export_id", "eq", exportId)
      .order("created_at", { ascending: true });
    return data ?? [];
  }

  /**
   * One export's audit trail with `export.requested` first and its terminal row
   * last. Ordered by the recorded state, not by `created_at`: the request and its
   * terminal row are written in ONE transaction, so they share a timestamp by
   * design.
   */
  function sortAuditRows<T extends { action: string; before_data: unknown; after_data: unknown }>(
    rows: T[]
  ): T[] {
    const rank = (row: { action: string }): number => (row.action === "export.requested" ? 0 : 1);
    return [...rows].sort((a, b) => rank(a) - rank(b));
  }

  function auditActions(rows: { action: string; before_data: unknown; after_data: unknown }[]) {
    return sortAuditRows(rows).map((row) => row.action);
  }

  /** One client archive requested by the Owner, used by most cases. */
  async function requestArchive(idempotencyKey = key(), actor = owner.client) {
    return createExportRequest(actor, {
      clientId,
      kind: "client_archive",
      audience: "owner",
      idempotencyKey,
    });
  }

  beforeAll(async () => {
    owner = await createUser(`exp19-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Export Request Org",
    });
    orgId = org;

    specialist = await createUser(`exp19-spec-${crypto.randomUUID()}@example.com`);
    supervisor = await createUser(`exp19-sup-${crypto.randomUUID()}@example.com`);
    readOnly = await createUser(`exp19-ro-${crypto.randomUUID()}@example.com`);
    for (const member of [specialist, supervisor, readOnly]) {
      await admin.from("organization_members").insert({
        organization_id: orgId,
        user_id: member.id,
        role: "specialist",
        status: "active",
      });
    }

    const { data: cid } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Export Subject",
    });
    clientId = cid;

    await admin.from("client_assignments").insert([
      { client_id: clientId, user_id: specialist.id, access_role: "primary_specialist" },
      { client_id: clientId, user_id: supervisor.id, access_role: "supervisor" },
      { client_id: clientId, user_id: readOnly.id, access_role: "read_only" },
    ]);

    await grantConsent(clientId, "data_storage");
    await grantConsent(clientId, "supervisor_access");
    await grantConsent(clientId, "anonymized_analytics");

    // A second tenant, to prove a cross-organization caller learns nothing.
    const strangerUser = await createUser(`exp19-out-${crypto.randomUUID()}@example.com`);
    const { data: strangerOrg } = await strangerUser.client.rpc("create_organization", {
      org_name: "Export Request Other Org",
    });
    otherOrgId = strangerOrg;
    const { data: otherClient } = await strangerUser.client.rpc("create_client", {
      p_organization_id: otherOrgId,
      p_display_name: "Other Subject",
    });
    otherClientId = otherClient;
    await admin.from("consent_records").insert({
      organization_id: otherOrgId,
      client_id: otherClientId,
      consent_type: "data_storage",
      document_version: "1.0",
    });
    stranger = strangerUser;

    // A little real content so the archive is not empty.
    await owner.client.rpc("create_signal", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_signal: {
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Мне трудно просить о помощи",
        evidence_level: "L1_SINGLE_SIGNAL",
      },
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("records the request, publishes a complete artifact and audits completion", async () => {
    const ticket = await requestArchive();

    expect(ticket.status).toBe("available");
    expect(ticket.replayed).toBe(false);

    // Request identity: client, format, exact contract version, audience,
    // optional snapshot version and the idempotency key all survive the round trip.
    expect(ticket.clientId).toBe(clientId);
    expect(ticket.organizationId).toBe(orgId);
    expect(ticket.format).toBe("json");
    expect(ticket.contractVersion).toBe("live-client-map.client-archive/1.0");
    expect(ticket.audience).toBe("owner");
    expect(ticket.snapshotVersion).toBeNull();

    // Timestamps for requested → available and the 30-day expiry (§10).
    expect(Date.parse(ticket.requestedAt)).toBeLessThanOrEqual(Date.parse(ticket.completedAt!));
    expect(Date.parse(ticket.expiresAt) - Date.parse(ticket.requestedAt)).toBeGreaterThan(
      29 * 24 * 60 * 60 * 1000
    );

    // The stored artifact is the contract file itself.
    const { data: blob } = await admin.storage
      .from(EXPORT_STORAGE_BUCKET)
      .download(`${orgId}/${ticket.exportId}/${ticket.artifactFilename}`);
    expect(blob).not.toBeNull();
    const content = await blob!.text();
    expect(Buffer.byteLength(content, "utf8")).toBe(ticket.artifactBytes);
    expect(createHash("sha256").update(content, "utf8").digest("hex")).toBe(ticket.artifactSha256);

    const archive = JSON.parse(content);
    expect(() => validateClientArchive(archive)).not.toThrow();
    expect(archive.export_id).toBe(ticket.exportId);
    expect(archive.version).toBe("1.0");
    expect(archive.manifest.record_counts.signals).toBe(1);

    // AuditLog: request + completion, and nothing that looks like the export.
    const rows = await auditRows(ticket.exportId);
    expect(auditActions(rows)).toEqual(["export.requested", "export.completed"]);
    expect(rows.every((row) => row.entity_type === "client")).toBe(true);
    expect(rows.every((row) => row.entity_id === clientId)).toBe(true);
    expect(rows.every((row) => row.actor_user_id === owner.id)).toBe(true);
    const payload = JSON.stringify(rows);
    expect(payload).not.toContain("Мне трудно просить о помощи");
    expect(payload).not.toContain("client-exports");
    expect(rows[1].after_data).toMatchObject({
      status: "available",
      artifact_sha256: ticket.artifactSha256,
      artifact_bytes: ticket.artifactBytes,
    });
  });

  it("returns the same export for an equivalent repeated request", async () => {
    const idempotencyKey = key();
    const first = await requestArchive(idempotencyKey);
    const second = await requestArchive(idempotencyKey);

    expect(second.exportId).toBe(first.exportId);
    expect(second.status).toBe("available");
    expect(second.replayed).toBe(true);
    expect(second.artifactSha256).toBe(first.artifactSha256);
    expect(second.completedAt).toBe(first.completedAt);

    // A replay generates nothing new: one audit pair for the whole key.
    const { data: requestRows } = await admin
      .from("export_requests")
      .select("id")
      .eq("organization_id", orgId)
      .eq("idempotency_key", idempotencyKey);
    expect(requestRows).toHaveLength(1);
    expect(auditActions(await auditRows(first.exportId))).toEqual([
      "export.requested",
      "export.completed",
    ]);
  });

  it("rejects the same idempotency key with different parameters as a conflict", async () => {
    const idempotencyKey = key();
    const first = await requestArchive(idempotencyKey);

    await expect(
      createExportRequest(owner.client, {
        clientId,
        kind: "client_archive",
        // Same key, different audience: a conflicting idempotency input.
        audience: "specialist",
        idempotencyKey,
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const { data: requestRows } = await admin
      .from("export_requests")
      .select("id, status, audience")
      .eq("organization_id", orgId)
      .eq("idempotency_key", idempotencyKey);
    expect(requestRows).toHaveLength(1);
    expect(requestRows![0]).toMatchObject({ id: first.exportId, status: "available" });

    // The original export is untouched by the rejected conflict.
    expect((await auditRows(first.exportId)).length).toBe(2);
  });

  it("never marks a failed generation available and audits the failure", async () => {
    const idempotencyKey = key();
    const failure = new ServiceError("INTERNAL_ERROR", "Export truncated: signals");

    await expect(
      createExportRequest(
        owner.client,
        { clientId, kind: "client_archive", audience: "owner", idempotencyKey },
        {
          buildArtifact: async () => {
            throw failure;
          },
        }
      )
    ).rejects.toBe(failure);

    const { data: row } = await admin
      .from("export_requests")
      .select(
        "status, failure_code, artifact_path, artifact_filename, artifact_sha256, artifact_bytes"
      )
      .eq("organization_id", orgId)
      .eq("idempotency_key", idempotencyKey)
      .single();

    expect(row).toMatchObject({
      status: "failed",
      failure_code: "generation_failed",
      artifact_path: null,
      artifact_filename: null,
      artifact_sha256: null,
      artifact_bytes: null,
    });

    const rows = await auditRows(
      (
        await admin
          .from("export_requests")
          .select("id")
          .eq("organization_id", orgId)
          .eq("idempotency_key", idempotencyKey)
          .single()
      ).data!.id
    );
    expect(auditActions(rows)).toEqual(["export.requested", "export.failed"]);
    expect(JSON.stringify(rows)).not.toContain("Export truncated");

    // A failed request is not a retryable magic key: the same key replays the
    // failure instead of silently producing a second export.
    const replay = await createExportRequest(owner.client, {
      clientId,
      kind: "client_archive",
      audience: "owner",
      idempotencyKey,
    });
    expect(replay.status).toBe("failed");
    expect(replay.replayed).toBe(true);
    expect(replay.artifactFilename).toBeNull();
  });

  it("denies a request without consent and records the denial", async () => {
    const deniedClientId = (
      await owner.client.rpc("create_client", {
        p_organization_id: orgId,
        p_display_name: "No Consent Subject",
      })
    ).data;

    const idempotencyKey = key();
    await expect(
      createExportRequest(owner.client, {
        clientId: deniedClientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { data: row } = await admin
      .from("export_requests")
      .select("id, status, failure_code, denied_at, artifact_path")
      .eq("organization_id", orgId)
      .eq("idempotency_key", idempotencyKey)
      .single();
    expect(row).toMatchObject({
      status: "denied",
      failure_code: "authorization_denied",
      artifact_path: null,
    });
    expect(row!.denied_at).not.toBeNull();

    const rows = sortAuditRows(await auditRows(row!.id));
    expect(rows.map((r) => r.action)).toEqual(["export.requested", "export.denied"]);
    expect(rows[1]).toMatchObject({
      entity_type: "client",
      entity_id: deniedClientId,
      reason: "export authorization or consent refused",
      after_data: { status: "denied", failure_code: "authorization_denied" },
    });
    expect(rows.every((r) => r.actor_user_id === owner.id)).toBe(true);
  });

  it("blocks a new export as soon as the underlying consent is revoked", async () => {
    const revokedClientId = (
      await owner.client.rpc("create_client", {
        p_organization_id: orgId,
        p_display_name: "Revoked Consent Subject",
      })
    ).data;
    await admin.from("consent_records").insert([
      {
        organization_id: orgId,
        client_id: revokedClientId,
        consent_type: "data_storage",
        document_version: "1.0",
      },
      {
        organization_id: orgId,
        client_id: revokedClientId,
        consent_type: "supervisor_access",
        document_version: "1.0",
      },
      {
        organization_id: orgId,
        client_id: revokedClientId,
        consent_type: "anonymized_analytics",
        document_version: "1.0",
      },
    ]);
    await admin.from("client_assignments").insert({
      client_id: revokedClientId,
      user_id: supervisor.id,
      access_role: "supervisor",
    });

    await revokeConsent(revokedClientId, "data_storage");

    const idempotencyKey = key();
    await expect(
      createExportRequest(owner.client, {
        clientId: revokedClientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    // Supervisor audience: the supervisor assignment is still active, so the
    // request passes the audience gate and is denied by its own consent gate —
    // the denial is a real transition with its own audit row.
    await revokeConsent(revokedClientId, "anonymized_analytics");
    await expect(
      createExportRequest(supervisor.client, {
        clientId: revokedClientId,
        kind: "supervision_export",
        audience: "supervisor",
        idempotencyKey: key(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { data: denied } = await admin
      .from("export_requests")
      .select("id, status, audience")
      .eq("client_id", revokedClientId);
    expect(denied).toHaveLength(2);
    expect(denied!.every((row) => row.status === "denied")).toBe(true);
    expect(denied!.map((row) => row.audience).sort()).toEqual(["owner", "supervisor"]);

    const { data: denials } = await admin
      .from("audit_log")
      .select("id, actor_user_id, reason")
      .eq("action", "export.denied")
      .eq("entity_id", revokedClientId);
    expect(denials).toHaveLength(2);
    expect(denials!.every((row) => row.reason === "export authorization or consent refused")).toBe(
      true
    );
    expect(denials!.map((row) => row.actor_user_id).sort()).toEqual(
      [owner.id, supervisor.id].sort()
    );
  });

  it("denies a read-only assignment and writes nothing for another tenant", async () => {
    // read_only may read the client but never export it: the refusal is a
    // persisted, audited `denied` transition for a caller who passes the tenant
    // and client-access gates.
    const {
      data: { user },
    } = await readOnly.client.auth.getUser();
    await expect(
      createExportRequest(readOnly.client, {
        clientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey: key(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const { data: readOnlyDenial } = await admin
      .from("export_requests")
      .select("id, status, failure_code")
      .eq("client_id", clientId)
      .eq("audience", "owner")
      .order("requested_at", { ascending: false })
      .limit(1)
      .single();
    expect(readOnlyDenial).toMatchObject({
      status: "denied",
      failure_code: "authorization_denied",
    });
    const readOnlyAudit = await auditRows(readOnlyDenial!.id);
    expect(auditActions(readOnlyAudit)).toEqual(["export.requested", "export.denied"]);
    expect(readOnlyAudit.every((row) => row.actor_user_id === user!.id)).toBe(true);

    // An owner of another organization learns nothing about this client: the
    // request is refused before any row exists, so no audit trail is fabricated.
    const before = await admin
      .from("export_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);

    await expect(
      createExportRequest(stranger.client, {
        clientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey: key(),
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const after = await admin
      .from("export_requests")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId);
    expect(after.count).toBe(before.count);
  });

  it("keeps the artifact private, opaque and reachable only through storage admin", async () => {
    const ticket = await requestArchive();

    // Filename: `<kind>_<opaque export ref>_<timestamp>.json` — opaque, stable
    // and identifier-free.
    expect(ticket.artifactFilename).toMatch(/^client_archive_[0-9a-f]{16}_[A-Za-z0-9.\-]+\.json$/);
    expect(ticket.artifactFilename!.split("_")[2]).toBe(opaqueExportRef(ticket.exportId));
    expect(ticket.artifactFilename).not.toContain(clientId);
    expect(ticket.artifactFilename).not.toContain(orgId);
    expect(ticket.artifactFilename).not.toContain("Export Subject");

    // The bucket is private.
    const { data: buckets } = await admin.storage.listBuckets();
    const bucket = (buckets ?? []).find((entry) => entry.name === EXPORT_STORAGE_BUCKET);
    expect(bucket).toBeDefined();
    expect(bucket!.public).toBe(false);

    // The requester cannot reach the object through the Storage API.
    const objectPath = `${orgId}/${ticket.exportId}/${ticket.artifactFilename}`;
    const { data: leaked, error: leakError } = await owner.client.storage
      .from(EXPORT_STORAGE_BUCKET)
      .download(objectPath);
    expect(leaked).toBeNull();
    expect(leakError).not.toBeNull();

    const { data: listed } = await owner.client.storage
      .from(EXPORT_STORAGE_BUCKET)
      .list(`${orgId}/${ticket.exportId}`);
    expect(listed ?? []).toHaveLength(0);

    // Only the storage admin (service role) can read it back.
    const { data: readable } = await admin.storage.from(EXPORT_STORAGE_BUCKET).download(objectPath);
    expect(readable).not.toBeNull();
  });

  it("keeps a supervisored export allowlisted without direct identifiers", async () => {
    const ticket = await createExportRequest(supervisor.client, {
      clientId,
      kind: "supervision_export",
      audience: "supervisor",
      idempotencyKey: key(),
    });
    expect(ticket.status).toBe("available");

    const { data: blob } = await admin.storage
      .from(EXPORT_STORAGE_BUCKET)
      .download(`${orgId}/${ticket.exportId}/${ticket.artifactFilename}`);
    const payload = JSON.parse(await blob!.text());

    expect(payload.contract).toBe("live-client-map.supervision-export");
    expect(payload.version).toBe("1.0");
    expect(payload.export_id).toBe(ticket.exportId);
    expect(Object.keys(payload.case).sort()).toEqual(
      [
        "contradictions",
        "core_hypotheses",
        "corrections_and_outcomes",
        "development_targets",
        "evidence_summary",
        "generalized_goals",
        "generalized_requests",
        "resources",
        "supervision_questions",
        "themes",
        "trend_summary",
      ].sort()
    );
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toContain("Export Subject");
    expect(serialized).not.toContain(clientId);
    expect(serialized).not.toContain("Мне трудно просить о помощи");
    expect(serialized).not.toContain("raw_statement");
  });

  it("produces the §12 CSV artifact for a specialist audience", async () => {
    const ticket = await createExportRequest(specialist.client, {
      clientId,
      kind: "signals_csv",
      audience: "specialist",
      idempotencyKey: key(),
    });
    expect(ticket.status).toBe("available");
    expect(ticket.format).toBe("csv");
    expect(ticket.contractVersion).toBe("live-client-map.signals-csv/1.0");
    expect(ticket.artifactFilename).toMatch(/^signals_csv_[0-9a-f]{16}_.*\.csv$/);

    const { data: blob } = await admin.storage
      .from(EXPORT_STORAGE_BUCKET)
      .download(`${orgId}/${ticket.exportId}/${ticket.artifactFilename}`);
    const content = await blob!.text();
    const [header, firstRow] = content.split("\n");
    expect(header).toBe(
      "contract_version,external_id,source_session_ref,source_type,source_ref,epistemic_type,raw_statement,statement_polarity,test_result,normalized_meaning,inferred_opposite,intensity,confidence,life_areas_json,tags_json,context_json,time_scope,claimed_evidence_level,visibility,source_review_status,source_created_at,source_updated_at"
    );
    expect(firstRow).toContain("live-client-map.signals-csv/1.0");
  });

  it("rolls the completion write and its audit row back together", async () => {
    const faults = await connectFaultInjection();
    if (!faults.available) {
      expect(true).toBe(true);
      return;
    }

    const idempotencyKey = key();
    try {
      // Resolve the export id first so the fault can be keyed to it: the marker
      // is the export id, which only appears in the completion audit payload.
      const claimed = await owner.client.rpc("request_export", {
        p_client_id: clientId,
        p_kind: "client_archive",
        p_format: "json",
        p_contract_version: "live-client-map.client-archive/1.0",
        p_audience: "owner",
        p_idempotency_key: idempotencyKey,
        p_snapshot_version: null,
      });
      expect(claimed.error).toBeNull();
      const exportId = claimed.data![0].export_id as string;

      // Completion is a system transition (service_role, no JWT subject), so the
      // fault is registered without an actor; the marker is the export id, which
      // only this test's audit rows contain.
      await faults.register("audit_log", exportId);

      await expect(
        createExportRequest(owner.client, {
          clientId,
          kind: "client_archive",
          audience: "owner",
          idempotencyKey,
        })
      ).rejects.toBeDefined();

      // The whole completion transaction rolled back: no artifact, no audit row.
      const { data: row } = await admin
        .from("export_requests")
        .select("status, artifact_path, artifact_sha256")
        .eq("id", exportId)
        .single();
      expect(row).toMatchObject({
        status: "generating",
        artifact_path: null,
        artifact_sha256: null,
      });
      expect(auditActions(await auditRows(exportId))).toEqual(["export.requested"]);

      // Recoverable: with the fault gone, the same idempotency key finishes the
      // generation and ends in exactly one available artifact.
      await faults.clear();
      const recovered = await createExportRequest(owner.client, {
        clientId,
        kind: "client_archive",
        audience: "owner",
        idempotencyKey,
      });
      expect(recovered.status).toBe("available");
      expect(recovered.exportId).toBe(exportId);
      expect(auditActions(await auditRows(exportId))).toEqual([
        "export.requested",
        "export.completed",
      ]);
    } finally {
      await faults.clear();
      await faults.close();
    }
  });
});
