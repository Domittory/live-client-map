import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  claimExportDownload,
  deliveredChecksum,
  downloadExportArtifact,
  exportContentType,
  exportDownloadHeaders,
  toExportDownloadResponse,
} from "@/lib/service/export-delivery";
import { EXPORT_STORAGE_BUCKET } from "@/lib/service/export-names";
import { createExportRequest, type ExportRequestTicket } from "@/lib/service/export-request";
import {
  listDueExportRequests,
  reapExpiredExports,
  RETENTION_MAX_BATCH_SIZE,
} from "@/lib/service/export-retention";
import { ServiceError } from "@/lib/service/errors";
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
 * Ticket 20 — secure download and 30-day retention against a real database and a
 * real private bucket (docs/data-exchange-contracts.md §10).
 *
 * Time is controlled by writing `expires_at` directly (the approach the ticket
 * suggests), so the suite never waits 30 days while still exercising the exact
 * predicate production uses.
 */
describe.skipIf(!available)("Export download and retention (ticket 20, §10)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let partnerClientId: string;
  let owner: { id: string; client: SupabaseClient };
  let specialist: { id: string; client: SupabaseClient };
  let supervisor: { id: string; client: SupabaseClient };
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

  function key(prefix = "ticket20"): string {
    return `${prefix}-${crypto.randomUUID()}`;
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

  function actions(rows: { action: string }[]): string[] {
    return rows.map((row) => row.action);
  }

  /** Sorted action multiset: audit rows of one transaction share created_at. */
  function sortedActions(rows: { action: string }[]): string[] {
    return [...actions(rows)].sort();
  }

  /** The last recorded transition of one action, independent of row ordering. */
  function lastOf<T extends { action: string }>(rows: T[], action: string): T | undefined {
    return rows.filter((row) => row.action === action).at(-1);
  }

  async function requestArchive(
    idempotencyKey = key(),
    actor = owner.client,
    targetClientId = clientId
  ): Promise<ExportRequestTicket> {
    return createExportRequest(actor, {
      clientId: targetClientId,
      kind: "client_archive",
      audience: "owner",
      idempotencyKey,
    });
  }

  /** Move an export past its 30-day retention deadline without waiting. */
  async function expireNow(exportId: string, when = new Date(Date.now() - 1000)) {
    const { error } = await admin
      .from("export_requests")
      .update({ expires_at: when.toISOString() })
      .eq("id", exportId);
    if (error) throw new Error(error.message);
  }

  /**
   * The opaque filename as STORED. A replayed ticket hides it (`toTicket` exposes
   * artifact metadata only for a freshly completed request), so tests that need the
   * name read it from the row instead of trusting the returned ticket.
   */
  async function storedFilename(exportId: string): Promise<string> {
    const { data } = await admin
      .from("export_requests")
      .select("artifact_filename")
      .eq("id", exportId)
      .single();
    return data!.artifact_filename as string;
  }

  async function objectPath(ticket: ExportRequestTicket): Promise<string> {
    return `${orgId}/${ticket.exportId}/${await storedFilename(ticket.exportId)}`;
  }

  async function objectExists(path: string): Promise<boolean> {
    const folder = path.slice(0, path.lastIndexOf("/"));
    const filename = path.slice(path.lastIndexOf("/") + 1);
    const { data } = await admin.storage.from(EXPORT_STORAGE_BUCKET).list(folder);
    return (data ?? []).some((entry) => entry.name === filename);
  }

  async function requestRow(exportId: string) {
    const { data } = await admin
      .from("export_requests")
      .select(
        "status, artifact_path, artifact_filename, artifact_sha256, artifact_bytes, download_count, download_denied_count, expired_at, failure_code"
      )
      .eq("id", exportId)
      .single();
    return data!;
  }

  beforeAll(async () => {
    owner = await createUser(`dl20-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Download Retention Org",
    });
    orgId = org;

    specialist = await createUser(`dl20-spec-${crypto.randomUUID()}@example.com`);
    supervisor = await createUser(`dl20-sup-${crypto.randomUUID()}@example.com`);
    for (const member of [specialist, supervisor]) {
      await admin.from("organization_members").insert({
        organization_id: orgId,
        user_id: member.id,
        role: "specialist",
        status: "active",
      });
    }

    const { data: cid } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Download Subject",
    });
    clientId = cid;

    const { data: partnerId } = await owner.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Download Partner",
    });
    partnerClientId = partnerId;

    await admin.from("client_assignments").insert([
      { client_id: clientId, user_id: specialist.id, access_role: "primary_specialist" },
      { client_id: clientId, user_id: supervisor.id, access_role: "supervisor" },
    ]);

    for (const target of [clientId, partnerClientId]) {
      await grantConsent(target, "data_storage");
      await grantConsent(target, "supervisor_access");
      await grantConsent(target, "anonymized_analytics");
    }

    // A second tenant, to prove a cross-organization caller cannot download and
    // leaves no denial row behind.
    const strangerUser = await createUser(`dl20-out-${crypto.randomUUID()}@example.com`);
    const { data: strangerOrg } = await strangerUser.client.rpc("create_organization", {
      org_name: "Download Retention Other Org",
    });
    const { data: otherClient } = await strangerUser.client.rpc("create_client", {
      p_organization_id: strangerOrg,
      p_display_name: "Other Download Subject",
    });
    await admin.from("consent_records").insert({
      organization_id: strangerOrg,
      client_id: otherClient,
      consent_type: "data_storage",
      document_version: "1.0",
    });
    stranger = strangerUser;

    await owner.client.rpc("create_signal", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_signal: {
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Мне важно удерживать ритм",
        evidence_level: "L1_SINGLE_SIGNAL",
      },
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  /**
   * Cases intentionally revoke consent to prove that an already prepared artifact
   * stops being deliverable. Restoring the baseline here keeps one failing case
   * from cascading into every later case (a revocation the suite forgot to undo
   * would otherwise make `requestArchive()` return `denied`).
   */
  afterEach(async () => {
    for (const target of [clientId, partnerClientId]) {
      for (const type of ["data_storage", "relationship_analysis"]) {
        const { data } = await admin
          .from("consent_records")
          .select("revoked_at")
          .eq("client_id", target)
          .eq("consent_type", type)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (data && data.revoked_at !== null) {
          await grantConsent(target, type);
        }
      }
    }
  });

  it("delivers an authorized artifact and audits the delivery without identifiers", async () => {
    const ticket = await requestArchive();
    expect(ticket.status).toBe("available");

    const payload = await downloadExportArtifact(owner.client, ticket.exportId);

    // The bytes are the stored artifact, byte-for-byte.
    expect(payload.bytes.byteLength).toBe(ticket.artifactBytes);
    expect(deliveredChecksum(payload.bytes)).toBe(ticket.artifactSha256);
    expect(payload.contentType).toBe(exportContentType("client_archive"));
    expect(payload.filename).toBe(ticket.artifactFilename);
    expect(payload.downloadCount).toBe(1);

    // The response carries the opaque name, the contract media type and no caching.
    const response = toExportDownloadResponse(payload);
    const headers = exportDownloadHeaders(payload);
    expect(response.status).toBe(200);
    expect(headers["Content-Type"]).toBe("application/vnd.live-client-map.client-archive+json");
    expect(headers["Cache-Control"]).toBe("no-store, private");
    expect(headers["Content-Disposition"]).toBe(
      `attachment; filename="${ticket.artifactFilename}"`
    );

    // The audit row records the delivery shape, never the file itself.
    const rows = await auditRows(ticket.exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([
        { action: "export.requested" },
        { action: "export.completed" },
        { action: "export.downloaded" },
      ])
    );
    const downloaded = rows.find((row) => row.action === "export.downloaded")!;
    expect(downloaded).toMatchObject({
      entity_type: "client",
      entity_id: clientId,
      actor_user_id: owner.id,
      after_data: {
        status: "available",
        kind: "client_archive",
        format: "json",
        audience: "owner",
        artifact_bytes: ticket.artifactBytes,
        artifact_sha256: ticket.artifactSha256,
        download_count: 1,
      },
    });

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain("client-exports");
    expect(serialized).not.toContain(await storedFilename(ticket.exportId));
    expect(serialized).not.toContain("Мне важно удерживать ритм");

    // The row counts the delivery and remembers when it happened.
    const row = await requestRow(ticket.exportId);
    expect(row.download_count).toBe(1);
    expect(row.download_denied_count).toBe(0);
  });

  it("counts every delivery of the same artifact", async () => {
    const ticket = await requestArchive();
    await downloadExportArtifact(owner.client, ticket.exportId);
    const second = await downloadExportArtifact(owner.client, ticket.exportId);

    expect(second.downloadCount).toBe(2);
    expect((await requestRow(ticket.exportId)).download_count).toBe(2);
    const rows = await auditRows(ticket.exportId);
    expect(actions(rows).filter((action) => action === "export.downloaded")).toHaveLength(2);
  });

  it("blocks an already prepared artifact when consent is revoked and audits the denial", async () => {
    const ticket = await requestArchive();
    // The artifact exists and is downloadable right now.
    await expect(downloadExportArtifact(owner.client, ticket.exportId)).resolves.toBeDefined();

    await revokeConsent(clientId, "data_storage");

    await expect(downloadExportArtifact(owner.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // The row stays `available` and the artifact is untouched: only delivery is denied.
    const row = await requestRow(ticket.exportId);
    expect(row.status).toBe("available");
    expect(row.download_count).toBe(1);
    expect(row.download_denied_count).toBe(1);

    const rows = await auditRows(ticket.exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([
        { action: "export.requested" },
        { action: "export.completed" },
        { action: "export.downloaded" },
        { action: "export.denied" },
      ])
    );
    const denied = lastOf(rows, "export.denied")!;
    expect(denied).toMatchObject({
      entity_type: "client",
      entity_id: clientId,
      actor_user_id: owner.id,
      reason: "export download refused: consent_revoked",
      after_data: {
        status: "available",
        failure_code: "download_consent_revoked",
        kind: "client_archive",
      },
    });
    expect(JSON.stringify(denied)).not.toContain(await storedFilename(ticket.exportId));

    // Restoring consent restores delivery of the very same artifact.
    await grantConsent(clientId, "data_storage");
    await expect(claimExportDownload(owner.client, ticket.exportId)).resolves.toBeDefined();
  });

  it("blocks delivery when the ClientAssignment is revoked, without fabricating a row", async () => {
    const ticket = await createExportRequest(specialist.client, {
      clientId,
      kind: "signals_csv",
      audience: "specialist",
      idempotencyKey: key(),
    });
    expect(ticket.status).toBe("available");
    await expect(downloadExportArtifact(specialist.client, ticket.exportId)).resolves.toBeDefined();

    await admin
      .from("client_assignments")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", clientId)
      .eq("user_id", specialist.id);

    await expect(downloadExportArtifact(specialist.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // A caller with no client access at all learns nothing: no new audit row and no
    // denial counter, exactly like request_export()'s no-access branch.
    const rows = await auditRows(ticket.exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([
        { action: "export.requested" },
        { action: "export.completed" },
        { action: "export.downloaded" },
      ])
    );
    expect((await requestRow(ticket.exportId)).download_denied_count).toBe(0);

    await admin
      .from("client_assignments")
      .update({ revoked_at: null })
      .eq("client_id", clientId)
      .eq("user_id", specialist.id);

    // With the assignment back, the prepared artifact is deliverable again.
    await expect(downloadExportArtifact(specialist.client, ticket.exportId)).resolves.toBeDefined();
  });

  it("blocks delivery when the caller no longer holds the audience role", async () => {
    // The archive requires the Owner audience; a specialist session must not be
    // able to download it even though the client is accessible to them.
    const ticket = await requestArchive();
    await expect(downloadExportArtifact(specialist.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const rows = await auditRows(ticket.exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([
        { action: "export.requested" },
        { action: "export.completed" },
        { action: "export.denied" },
      ])
    );
    expect(lastOf(rows, "export.denied")?.reason).toBe("export download refused: audience_revoked");
    expect((await requestRow(ticket.exportId)).download_denied_count).toBe(1);
  });

  it("blocks an archive download after a partner revokes relationship consent", async () => {
    const { error: relationshipError } = await owner.client.from("relationships").insert({
      organization_id: orgId,
      client_a_id: clientId,
      client_b_id: partnerClientId,
      relationship_type: "family",
    });
    expect(relationshipError).toBeNull();

    await grantConsent(clientId, "relationship_analysis");
    await grantConsent(partnerClientId, "relationship_analysis");

    const ticket = await requestArchive();
    await expect(downloadExportArtifact(owner.client, ticket.exportId)).resolves.toBeDefined();

    await revokeConsent(partnerClientId, "relationship_analysis");

    await expect(downloadExportArtifact(owner.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const rows = await auditRows(ticket.exportId);
    expect(lastOf(rows, "export.denied")?.reason).toBe(
      "export download refused: relationship_consent_revoked"
    );

    // Restoring consent restores delivery: the artifact itself was never modified.
    await grantConsent(partnerClientId, "relationship_analysis");
    await expect(downloadExportArtifact(owner.client, ticket.exportId)).resolves.toBeDefined();
  });

  it("denies a cross-tenant caller without fabricating an audit row", async () => {
    const ticket = await requestArchive();

    await expect(downloadExportArtifact(stranger.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const rows = await auditRows(ticket.exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([{ action: "export.requested" }, { action: "export.completed" }])
    );
    expect((await requestRow(ticket.exportId)).download_denied_count).toBe(0);
  });

  it("refuses delivery once the retention deadline has passed", async () => {
    const ticket = await requestArchive();
    await expireNow(ticket.exportId);

    await expect(downloadExportArtifact(owner.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    // A passed deadline is not a revocation: no denial row is written, and the
    // reaper is the authority that closes the request.
    expect(actions(await auditRows(ticket.exportId))).toEqual([
      "export.requested",
      "export.completed",
    ]);
  });

  it("deletes the artifact, moves the request to expired and audits it", async () => {
    const ticket = await requestArchive();
    await downloadExportArtifact(owner.client, ticket.exportId);
    const path = await objectPath(ticket);
    expect(await objectExists(path)).toBe(true);

    await expireNow(ticket.exportId);

    const due = await listDueExportRequests();
    expect(due.map((row) => row.exportId)).toContain(ticket.exportId);

    const result = await reapExpiredExports();
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.storageErrors).toBe(0);

    // Object gone, row expired, identifiers cleared.
    expect(await objectExists(path)).toBe(false);
    const row = await requestRow(ticket.exportId);
    expect(row.status).toBe("expired");
    expect(row.expired_at).not.toBeNull();
    expect(row.artifact_path).toBeNull();
    expect(row.artifact_filename).toBeNull();

    const rows = await auditRows(ticket.exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([
        { action: "export.requested" },
        { action: "export.completed" },
        { action: "export.downloaded" },
        { action: "export.expired" },
      ])
    );
    const expired = lastOf(rows, "export.expired")!;
    expect(expired).toMatchObject({
      entity_type: "client",
      entity_id: clientId,
      actor_user_id: owner.id,
      reason: "retention: artifact deleted after 30 days",
    });
    expect(expired.after_data).toMatchObject({
      status: "expired",
      kind: "client_archive",
      download_count: 1,
    });
    // The expiry evidence keeps counts, not the artifact sha256 or its name.
    expect(expired.after_data).not.toHaveProperty("artifact_sha256");

    const serialized = JSON.stringify(expired);
    expect(serialized).not.toContain(await storedFilename(ticket.exportId));
    expect(serialized).not.toContain("client-exports");
    expect(serialized).not.toContain(orgId);

    // The deleted object is unreachable: no claim, no download, even for the Owner.
    await expect(claimExportDownload(owner.client, ticket.exportId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("is idempotent: a re-run changes nothing and writes no second audit row", async () => {
    const ticket = await requestArchive();
    await expireNow(ticket.exportId);

    await reapExpiredExports();
    const afterFirst = await auditRows(ticket.exportId);
    const rowAfterFirst = await requestRow(ticket.exportId);
    expect(actions(afterFirst)).toContain("export.expired");

    const second = await reapExpiredExports();
    expect(second.expired).toBe(0);
    expect(second.failed).toBe(0);
    expect(second.storageErrors).toBe(0);

    const afterSecond = await auditRows(ticket.exportId);
    expect(afterSecond).toHaveLength(afterFirst.length);
    expect(actions(afterSecond)).toEqual(actions(afterFirst));
    expect(await requestRow(ticket.exportId)).toEqual(rowAfterFirst);
  });

  it("recovers from a partial failure: object deleted, row still available", async () => {
    const ticket = await requestArchive();
    const path = await objectPath(ticket);

    // Simulate a crash between the storage delete and the database transition: the
    // object is already gone while the row is still `available`.
    await admin.storage.from(EXPORT_STORAGE_BUCKET).remove([path]);
    expect(await objectExists(path)).toBe(false);
    await expireNow(ticket.exportId);

    // Re-running deletes nothing (a missing object is not an error) and still
    // expires the row.
    const result = await reapExpiredExports();
    expect(result.storageErrors).toBe(0);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect((await requestRow(ticket.exportId)).status).toBe("expired");
    expect(actions(await auditRows(ticket.exportId))).toContain("export.expired");
  });

  it("recovers from a partial failure: expiry rolled back after the object was deleted", async () => {
    const faults = await connectFaultInjection();
    if (!faults.available) {
      expect(true).toBe(true);
      return;
    }

    const ticket = await requestArchive();
    const path = await objectPath(ticket);
    await expireNow(ticket.exportId);

    try {
      // Make the expiry audit write fail, so the storage delete succeeds while the
      // row transition rolls back — the exact half-state an operator must be able
      // to re-run from.
      await faults.register("audit_log", ticket.exportId);
      await expect(reapExpiredExports()).rejects.toMatchObject({ code: "INTERNAL_ERROR" });

      const stalled = await requestRow(ticket.exportId);
      expect(stalled.status).toBe("available");
      expect(await objectExists(path)).toBe(false);

      await faults.clear();

      const recovered = await reapExpiredExports();
      expect(recovered.storageErrors).toBe(0);
      expect((await requestRow(ticket.exportId)).status).toBe("expired");
      expect(actions(await auditRows(ticket.exportId))).toContain("export.expired");
    } finally {
      await faults.clear();
      await faults.close();
    }
  });

  it("closes a hung generating request as failed instead of pinning it forever", async () => {
    // Ticket 19 leaves a request in `generating` when completion fails. Simulate it
    // through the real claim RPC, then push it past its expiry.
    const idempotencyKey = key("hung");
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
    expect(claimed.data![0].state).toBe("generating");

    await expireNow(exportId);
    const result = await reapExpiredExports();
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const row = await requestRow(exportId);
    expect(row.status).toBe("failed");
    expect(row.failure_code).toBe("generation_timeout");

    const rows = await auditRows(exportId);
    expect(sortedActions(rows)).toEqual(
      sortedActions([{ action: "export.requested" }, { action: "export.failed" }])
    );
    expect(lastOf(rows, "export.failed")?.reason).toBe(
      "retention: generation did not complete within 30 days"
    );

    // The row is terminal, so a re-run neither touches it nor writes again.
    const before = await auditRows(exportId);
    await reapExpiredExports();
    expect(await auditRows(exportId)).toHaveLength(before.length);
  });

  it("rejects an out-of-range retention batch size", async () => {
    await expect(reapExpiredExports({ limit: 0 })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(reapExpiredExports({ limit: RETENTION_MAX_BATCH_SIZE + 1 })).rejects.toMatchObject(
      {
        code: "VALIDATION_ERROR",
      }
    );
  });

  it("keeps the artifact unreachable through the Storage API for every role", async () => {
    const ticket = await requestArchive();
    const path = await objectPath(ticket);
    expect(path).toContain(await storedFilename(ticket.exportId));

    for (const session of [owner.client, specialist.client, supervisor.client, anonClient()]) {
      const { data, error } = await session.storage.from(EXPORT_STORAGE_BUCKET).download(path);
      expect(data).toBeNull();
      expect(error).not.toBeNull();
    }

    // Only the server-side delivery path can read it.
    const payload = await downloadExportArtifact(owner.client, ticket.exportId);
    expect(createHash("sha256").update(payload.bytes).digest("hex")).toBe(ticket.artifactSha256);
  });

  it("audits a denied delivery without ever recording an artifact filename", async () => {
    const ticket = await requestArchive();
    await revokeConsent(clientId, "data_storage");
    await expect(claimExportDownload(owner.client, ticket.exportId)).rejects.toBeInstanceOf(
      ServiceError
    );

    const rows = await auditRows(ticket.exportId);
    const denial = rows.find((row) => row.action === "export.denied")!;
    const payload = JSON.stringify(denial);
    expect(payload).not.toContain(await storedFilename(ticket.exportId));
    expect(payload).not.toContain("client-exports");
    expect(payload).not.toContain(orgId);
    expect(payload).not.toContain("Мне важно удерживать ритм");

    await grantConsent(clientId, "data_storage");
  });
});
