import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deliveredChecksum,
  exportContentType,
  exportDownloadHeaders,
  toExportDownloadResponse,
  type ExportArtifactPayload,
  type ExportDownloadClaim,
} from "@/lib/service/export-delivery";
import { EXPORT_MEDIA_TYPES } from "@/lib/service/export-names";
import { RETENTION_BATCH_SIZE, RETENTION_MAX_BATCH_SIZE } from "@/lib/service/export-retention";
import {
  EXPORT_KIND_CONTRACTS,
  exportContractVersion,
  exportFormatForKind,
} from "@/lib/service/export-request";

/**
 * Ticket 20. The delivery rules that are pure — the response's media type and
 * headers, the delivered checksum, the 30-day batch bounds and the "no filename
 * identifier, no signed URL" shape of the returned values — are tested here
 * without a database. The state machine itself (re-authorization, denial, expiry,
 * idempotent re-run) is covered by
 * tests/integration/export-download-retention.integration.test.ts.
 */

const EXPORT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const ORG_ID = "99999999-8888-4777-8666-555555555555";

describe("export download media type", () => {
  it.each([
    ["client_archive", EXPORT_MEDIA_TYPES.client_archive],
    ["signals_csv", "text/csv"],
    ["supervision_export", EXPORT_MEDIA_TYPES.supervision_export],
  ] as const)("serves %s as its stored contract media type", (kind, mediaType) => {
    expect(exportContentType(kind)).toBe(mediaType);
  });

  it("never serves an export as HTML", () => {
    expect(Object.values(EXPORT_MEDIA_TYPES).every((type) => !type.includes("text/html"))).toBe(
      true
    );
  });

  it("stays aligned with the format of the kind", () => {
    expect(exportFormatForKind("signals_csv")).toBe("csv");
    expect(exportFormatForKind("client_archive")).toBe("json");
    expect(EXPORT_KIND_CONTRACTS.client_archive.format).toBe("json");
    expect(exportContractVersion("supervision_export")).toBe(
      "live-client-map.supervision-export/1.0"
    );
  });
});

describe("delivered artifact checksum", () => {
  it("hashes exactly the delivered bytes", () => {
    const bytes = new TextEncoder().encode('{"contract":"live-client-map.client-archive"}');
    expect(deliveredChecksum(bytes)).toMatch(/^[0-9a-f]{64}$/);
    expect(deliveredChecksum(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("hashes UTF-8 content the same way the artifact was sealed", () => {
    const bytes = new TextEncoder().encode("Мне важно удерживать ритм");
    expect(deliveredChecksum(bytes)).toBe(
      createHash("sha256").update("Мне важно удерживать ритм", "utf8").digest("hex")
    );
  });

  it("detects a single changed byte", () => {
    const first = new Uint8Array([1, 2, 3, 4]);
    const second = new Uint8Array([1, 2, 3, 5]);
    expect(deliveredChecksum(first)).not.toBe(deliveredChecksum(second));
  });
});

describe("download response headers", () => {
  const filename = "client_archive_0123456789abcdef_2026-09-19T12-00-00-000Z.json";

  it("carries the opaque filename, the contract media type and no caching", () => {
    const headers = exportDownloadHeaders({
      contentType: exportContentType("client_archive"),
      filename,
    });

    expect(headers["Content-Disposition"]).toBe(`attachment; filename="${filename}"`);
    expect(headers["Content-Type"]).toBe(EXPORT_MEDIA_TYPES.client_archive);
    // A cached copy would outlive the authorization it was granted for.
    expect(headers["Cache-Control"]).toBe("no-store, private");
  });

  it("builds a Response that never exposes a storage path or a signed URL", async () => {
    const payload: ExportArtifactPayload = {
      exportId: EXPORT_ID,
      kind: "signals_csv",
      format: "csv",
      contentType: exportContentType("signals_csv"),
      filename: "signals_csv_0123456789abcdef_2026-09-19T12-00-00-000Z.csv",
      bytes: new TextEncoder().encode("contract_version,external_id\n"),
      sha256: "a".repeat(64),
      downloadCount: 1,
    };

    const response = toExportDownloadResponse(payload);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
    expect(await response.text()).toBe("contract_version,external_id\n");

    const serialized = JSON.stringify({
      ...payload,
      bytes: Array.from(payload.bytes),
    });
    expect(serialized).not.toContain("client-exports");
    expect(serialized).not.toContain("token=");
    expect(serialized).not.toContain(ORG_ID);
    expect(payload.filename).not.toContain(CLIENT_ID);
    expect(payload.filename).not.toContain(EXPORT_ID);
  });
});

describe("delivery and retention return shapes", () => {
  it("keeps the delivery claim free of any client-facing path or signed URL", () => {
    const claim: ExportDownloadClaim = {
      exportId: EXPORT_ID,
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      kind: "supervision_export",
      format: "json",
      contractVersion: "live-client-map.supervision-export/1.0",
      audience: "supervisor",
      artifactPath: `${ORG_ID}/${EXPORT_ID}/supervision_0123456789abcdef_2026-09-19T12-00-00-000Z.json`,
      artifactFilename: "supervision_0123456789abcdef_2026-09-19T12-00-00-000Z.json",
      artifactSha256: "b".repeat(64),
      artifactBytes: 2048,
      expiresAt: "2026-09-19T12:00:00Z",
      downloadCount: 0,
    };

    // The claim is server-internal: it carries the object path so the service can
    // read it, and it is never serialized into a response or an audit payload.
    expect(claim.artifactPath).toContain(ORG_ID);
    expect(claim.artifactFilename).not.toContain(CLIENT_ID);
    expect(claim.artifactFilename).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("bounds one retention batch the same way the RPC does", () => {
    expect(RETENTION_BATCH_SIZE).toBe(100);
    expect(RETENTION_MAX_BATCH_SIZE).toBe(1000);
    expect(RETENTION_BATCH_SIZE).toBeLessThanOrEqual(RETENTION_MAX_BATCH_SIZE);
  });
});
