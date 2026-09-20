import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CLIENT_ARCHIVE_CONTRACT,
  CLIENT_ARCHIVE_MEDIA_TYPE,
  CLIENT_ARCHIVE_VERSION,
  buildClientArchiveArtifact,
  canonicalStringify,
  computeDataHash,
} from "@/lib/service/client-archive";
import {
  EXPORT_EXTENSIONS,
  EXPORT_MEDIA_TYPES,
  EXPORT_STORAGE_BUCKET,
  exportArtifactFilename,
  exportArtifactPath,
  opaqueClientRef,
  opaqueExportRef,
} from "@/lib/service/export-names";
import {
  artifactChecksum,
  EXPORT_MEDIA_TYPES as BUILDER_MEDIA_TYPES,
} from "@/lib/service/export-artifact";
import {
  EXPORT_KIND_CONTRACTS,
  createExportRequestSchema,
  exportContractVersion,
  exportFormatForKind,
  failureCodeFor,
  toTicket,
} from "@/lib/service/export-request";
import { ServiceError } from "@/lib/service/errors";
import { projectSupervisionCase } from "@/lib/service/supervision-export";

/**
 * Ticket 19. The lifecycle rules that are pure — identifier-free storage names,
 * the contract version of each kind, artifact sealing and the request → response
 * projection — are tested here without a database. The state machine itself
 * (idempotency, denial, failure, audit rows) is covered by
 * tests/integration/export-request.integration.test.ts.
 */

const CLIENT_ID = "11111111-2222-4333-8444-555555555555";
const EXPORT_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ORG_ID = "99999999-8888-4777-8666-555555555555";
const GENERATED_AT = "2026-08-22T12:34:56.789Z";
/** `:` and `.` of an ISO timestamp are replaced so the name is filename-safe. */
const EXPORT_STAMP = "2026-08-22T12-34-56-789Z";

describe("opaque export identifiers", () => {
  it("derives a stable 16-character lowercase-hex reference", () => {
    const ref = opaqueExportRef(EXPORT_ID);
    expect(ref).toBe(opaqueExportRef(EXPORT_ID));
    expect(ref).toMatch(/^[0-9a-f]{16}$/);
  });

  it("never equals the identifier it was derived from", () => {
    expect(opaqueExportRef(EXPORT_ID)).not.toContain(EXPORT_ID);
    expect(opaqueExportRef(EXPORT_ID)).not.toContain(CLIENT_ID);
    expect(opaqueExportRef(EXPORT_ID)).not.toBe(opaqueClientRef(CLIENT_ID));
  });

  it("differs for different exports of the same client", () => {
    const other = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
    expect(opaqueExportRef(EXPORT_ID)).not.toBe(opaqueExportRef(other));
  });
});

describe("artifact filenames (§10: opaque only)", () => {
  it.each([
    ["client_archive", "json"],
    ["signals_csv", "csv"],
    ["supervision_export", "json"],
  ] as const)("builds %s as <kind>_<ref>_<timestamp>.%s", (kind, extension) => {
    const filename = exportArtifactFilename({
      kind,
      exportId: EXPORT_ID,
      generatedAt: GENERATED_AT,
    });

    expect(filename).toBe(`${kind}_${opaqueExportRef(EXPORT_ID)}_${EXPORT_STAMP}.${extension}`);
    expect(EXPORT_EXTENSIONS[kind]).toBe(extension);
    // Exactly three components: kind, opaque ref, timestamp (+ extension).
    expect(filename.split("_")).toHaveLength(4);
  });

  it("contains no direct identifier and no content", () => {
    const filename = exportArtifactFilename({
      kind: "client_archive",
      exportId: EXPORT_ID,
      generatedAt: GENERATED_AT,
    });

    expect(filename).not.toContain(EXPORT_ID);
    expect(filename).not.toContain(CLIENT_ID);
    expect(filename).not.toContain(ORG_ID);
    expect(filename).not.toContain("Archive Rich");
    // Nothing but [A-Za-z0-9_.-]: no spaces, colons, Cyrillic or path separators.
    expect(filename).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it("keeps the file extension a direct function of the kind", () => {
    expect(EXPORT_EXTENSIONS.signals_csv).toBe("csv");
    expect(EXPORT_EXTENSIONS.client_archive).toBe("json");
    expect(EXPORT_EXTENSIONS.supervision_export).toBe("json");
  });

  it("changes when the same client is exported again", () => {
    const first = exportArtifactFilename({
      kind: "client_archive",
      exportId: EXPORT_ID,
      generatedAt: GENERATED_AT,
    });
    const second = exportArtifactFilename({
      kind: "client_archive",
      exportId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
      generatedAt: GENERATED_AT,
    });
    expect(first).not.toBe(second);
  });
});

describe("private storage layout", () => {
  it("uses the single private bucket declared by migration 0051", () => {
    expect(EXPORT_STORAGE_BUCKET).toBe("client-exports");
  });

  it("nests the object under organization and export request ids only", () => {
    const filename = exportArtifactFilename({
      kind: "client_archive",
      exportId: EXPORT_ID,
      generatedAt: GENERATED_AT,
    });
    const path = exportArtifactPath({
      organizationId: ORG_ID,
      exportId: EXPORT_ID,
      filename,
    });

    expect(path).toBe(`${ORG_ID}/${EXPORT_ID}/${filename}`);
    expect(path.split("/")).toHaveLength(3);
    expect(path).not.toContain(CLIENT_ID);
  });

  it("declares a media type per kind that is not a public web page", () => {
    expect(EXPORT_MEDIA_TYPES.client_archive).toContain("live-client-map.client-archive");
    expect(EXPORT_MEDIA_TYPES.supervision_export).toContain("live-client-map.supervision-export");
    expect(EXPORT_MEDIA_TYPES.signals_csv).toBe("text/csv");
    expect(Object.values(EXPORT_MEDIA_TYPES).every((type) => !type.includes("text/html"))).toBe(
      true
    );
  });
});

describe("export kind contract matrix", () => {
  it("pins one format and one exact contract version per kind", () => {
    expect(exportFormatForKind("client_archive")).toBe("json");
    expect(exportFormatForKind("signals_csv")).toBe("csv");
    expect(exportFormatForKind("supervision_export")).toBe("json");

    expect(exportContractVersion("client_archive")).toBe(
      `${CLIENT_ARCHIVE_CONTRACT}/${CLIENT_ARCHIVE_VERSION}`
    );
    expect(exportContractVersion("signals_csv")).toBe("live-client-map.signals-csv/1.0");
    expect(exportContractVersion("supervision_export")).toBe(
      "live-client-map.supervision-export/1.0"
    );
  });

  it("keeps the §11 archive media type aligned with the kind matrix", () => {
    expect(EXPORT_KIND_CONTRACTS.client_archive.contract).toBe(CLIENT_ARCHIVE_CONTRACT);
    expect(BUILDER_MEDIA_TYPES.client_archive).toBe(CLIENT_ARCHIVE_MEDIA_TYPE);
  });
});

describe("createExportRequest schema", () => {
  const valid = {
    clientId: CLIENT_ID,
    kind: "client_archive" as const,
    audience: "owner" as const,
    idempotencyKey: "req-1",
  };

  it("accepts a minimal request", () => {
    expect(createExportRequestSchema.parse(valid)).toEqual(valid);
  });

  it("accepts an exact snapshot version", () => {
    const parsed = createExportRequestSchema.parse({ ...valid, snapshotVersion: 3 });
    expect(parsed.snapshotVersion).toBe(3);
  });

  it("rejects an unknown field instead of ignoring it", () => {
    expect(() => createExportRequestSchema.parse({ ...valid, format: "pdf" })).toThrow();
  });

  it("rejects an empty idempotency key and an unknown kind", () => {
    expect(() => createExportRequestSchema.parse({ ...valid, idempotencyKey: "  " })).toThrow();
    expect(() => createExportRequestSchema.parse({ ...valid, kind: "database_dump" })).toThrow();
  });

  it("rejects a non-uuid client and a fractional snapshot version", () => {
    expect(() => createExportRequestSchema.parse({ ...valid, clientId: "client-1" })).toThrow();
    expect(() => createExportRequestSchema.parse({ ...valid, snapshotVersion: 1.5 })).toThrow();
  });
});

/** Minimal but contract-valid archive: every §11 collection present and empty. */
function emptyArchive() {
  const collections = [
    "consent_records",
    "client_requests",
    "client_goals",
    "life_events",
    "triggers",
    "diagnostic_sessions",
    "diagnostic_session_summaries",
    "signals",
    "evidence_clusters",
    "themes",
    "core_nodes",
    "differential_hypotheses",
    "signal_theme_links",
    "theme_core_node_links",
    "core_node_relations",
    "trigger_activations",
    "resources",
    "development_targets",
    "purpose_profiles",
    "purpose_syntheses",
    "recommendations",
    "recommendation_targets",
    "corrections",
    "correction_targets",
    "correction_expected_markers",
    "observations",
    "behavioral_markers",
    "follow_ups",
    "model_changes",
    "psychological_snapshots",
    "medical_facts",
    "symptom_reports",
    "psychological_hypotheses",
    "relationships",
    "relationship_dynamics",
    "audit_events",
  ];

  const data = {
    client: {},
    ...Object.fromEntries(collections.map((collection) => [collection, []])),
    reference_catalog: {
      diagnostic_domains: [],
      belief_templates: [],
      intervention_methods: [],
    },
  };

  return {
    contract: CLIENT_ARCHIVE_CONTRACT,
    version: CLIENT_ARCHIVE_VERSION,
    export_id: EXPORT_ID,
    generated_at: GENERATED_AT,
    source_organization_id: ORG_ID,
    subject_client_id: CLIENT_ID,
    manifest: {
      data_dictionary_version: "1.0",
      scoring_model_versions: [],
      ontology_versions: [],
      snapshot_versions: [],
      record_counts: Object.fromEntries(collections.map((collection) => [collection, 0])),
      warnings: [],
      data_sha256: computeDataHash(data),
    },
    data,
  } as unknown as Parameters<typeof buildClientArchiveArtifact>[0];
}

describe("client archive artifact sealing", () => {
  it("seals the canonical archive bytes with a matching size and checksum", () => {
    const artifact = buildClientArchiveArtifact(emptyArchive());

    expect(artifact.content).toBe(canonicalStringify(JSON.parse(artifact.content)));
    expect(artifact.byte_size).toBe(Buffer.byteLength(artifact.content, "utf8"));
    expect(artifact.content_sha256).toBe(artifactChecksum(artifact.content));
    expect(artifact.content_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(artifact.byte_size).toBeGreaterThan(0);
    expect(artifact.content_type).toBe(CLIENT_ARCHIVE_MEDIA_TYPE);
  });

  it("counts exactly the serialized collections and carries the manifest warnings", () => {
    const artifact = buildClientArchiveArtifact(emptyArchive());
    expect(Object.values(artifact.counts).every((count) => count === 0)).toBe(true);
    expect(artifact.warnings).toEqual([]);
  });

  it("produces identical bytes for identical data (deterministic hash)", () => {
    const first = buildClientArchiveArtifact(emptyArchive());
    const second = buildClientArchiveArtifact(emptyArchive());
    expect(second.content_sha256).toBe(first.content_sha256);
    expect(second.byte_size).toBe(first.byte_size);
  });
});

describe("artifact checksum", () => {
  it("hashes the UTF-8 bytes independently of the digest implementation", () => {
    const value = "Мне трудно просить о помощи";
    expect(artifactChecksum(value)).toMatch(/^[0-9a-f]{64}$/);
    expect(artifactChecksum(value)).toBe(createHash("sha256").update(value, "utf8").digest("hex"));
  });

  it("is sensitive to a single character", () => {
    expect(artifactChecksum("abc")).not.toBe(artifactChecksum("abd"));
  });
});

describe("failure codes", () => {
  it("maps every error to a stable, content-free code", () => {
    expect(failureCodeFor(new ServiceError("NOT_FOUND", "Client not found"))).toBe(
      "access_revoked"
    );
    expect(failureCodeFor(new ServiceError("FORBIDDEN", "No access"))).toBe("access_revoked");
    expect(failureCodeFor(new ServiceError("VALIDATION_ERROR", "bad"))).toBe("invalid_artifact");
    expect(failureCodeFor(new ServiceError("INTERNAL_ERROR", "boom"))).toBe("generation_failed");
    expect(failureCodeFor(new Error("raw pg error with a client name"))).toBe("generation_failed");
    expect(failureCodeFor("not an error")).toBe("generation_failed");
  });
});

describe("request to ticket projection", () => {
  const row = {
    id: EXPORT_ID,
    organization_id: ORG_ID,
    client_id: CLIENT_ID,
    kind: "client_archive" as const,
    format: "json" as const,
    contract_version: `${CLIENT_ARCHIVE_CONTRACT}/${CLIENT_ARCHIVE_VERSION}`,
    audience: "owner" as const,
    snapshot_version: null,
    status: "available" as const,
    requested_at: "2026-08-22T12:00:00Z",
    generated_at: "2026-08-22T12:00:05Z",
    completed_at: "2026-08-22T12:00:05Z",
    expires_at: "2026-09-21T12:00:00Z",
    artifact_filename: `client_archive_${opaqueExportRef(EXPORT_ID)}_${EXPORT_STAMP}.json`,
    artifact_sha256: "a".repeat(64),
    artifact_bytes: 1234,
    failure_code: null,
  };

  it("exposes artifact metadata only for an available request", () => {
    const ticket = toTicket(row, false);
    expect(ticket.status).toBe("available");
    expect(ticket.artifactFilename).toBe(row.artifact_filename);
    expect(ticket.artifactSha256).toBe(row.artifact_sha256);
    expect(ticket.artifactBytes).toBe(1234);
    expect(ticket.replayed).toBe(false);
    expect(ticket.expiresAt).toBe(row.expires_at);
  });

  it("hides artifact metadata and reports the failure code for a failed request", () => {
    const ticket = toTicket({ ...row, status: "failed", failure_code: "generation_failed" }, true);
    expect(ticket.status).toBe("failed");
    expect(ticket.artifactFilename).toBeNull();
    expect(ticket.artifactSha256).toBeNull();
    expect(ticket.artifactBytes).toBeNull();
    expect(ticket.failureCode).toBe("generation_failed");
    expect(ticket.replayed).toBe(true);
  });

  it("never leaks a storage path", () => {
    const ticket = toTicket(row, false);
    expect(JSON.stringify(ticket)).not.toContain("client-exports");
    expect(ticket).not.toHaveProperty("artifactPath");
  });
});

describe("supervision case projection", () => {
  it("aggregates evidence counts and copies only allowlisted item keys", () => {
    const projection = projectSupervisionCase({
      themes: [{ name: "Тема", confidence_score: 80 }],
      coreNodes: [{ title: "Гипотеза", confidence_score: 60 }],
      resources: [{ name: "Ресурс", strength_score: 40 }],
      developmentTargets: [{ name: "Цель", current_level: 1, target_level: 3 }],
      corrections: [{ status: "active" }],
      signals: [{ evidence_level: "L2" }, { evidence_level: "L1" }, { evidence_level: "L2" }],
    });

    expect(projection.evidence_summary).toEqual([
      { evidence_level: "L1", count: 1 },
      { evidence_level: "L2", count: 2 },
    ]);
    expect(projection.themes).toEqual([{ name: "Тема", confidence_score: 80 }]);
    expect(projection.trend_summary).toBeNull();
    expect(JSON.stringify(projection)).not.toContain("raw_statement");
  });
});
