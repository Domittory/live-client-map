import { describe, expect, it } from "vitest";
import {
  ARCHIVE_COLLECTIONS,
  CLIENT_ARCHIVE_CONTRACT,
  CLIENT_ARCHIVE_VERSION,
  DATA_DICTIONARY_VERSION,
  REFERENCE_CATALOG_COLLECTIONS,
  REQUIRED_ARCHIVE_DATA_KEYS,
  applyReferencePolicy,
  assertCollectionComplete,
  canonicalStringify,
  computeDataHash,
  orderRows,
  sortKeysFor,
  validateClientArchive,
  type ArchiveRow,
  type ClientArchive,
  type ClientArchiveData,
} from "@/lib/service/client-archive";
import {
  clientArchiveFilename,
  opaqueClientRef,
  signalsCsvFilename,
  supervisionExportFilename,
} from "@/lib/service/export-names";
import {
  SUPERVISION_CASE_KEYS,
  assertAllowlistedProjection,
} from "@/lib/service/supervision-export";

/**
 * Ticket 18. The rules §11 actually cares about — a stable complete schema, an
 * authoritative manifest, deterministic ordering/hash, explicit dangling and
 * truncation handling, and no identifiers in filenames — are pure functions, so
 * they are tested here without a database.
 */

/** The exact §11 collection list, transcribed independently of the module. */
const CONTRACT_COLLECTIONS = [
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

function emptyData(): ClientArchiveData {
  return {
    client: { id: "11111111-1111-1111-1111-111111111111" },
    reference_catalog: {
      diagnostic_domains: [],
      belief_templates: [],
      intervention_methods: [],
    },
    ...Object.fromEntries(ARCHIVE_COLLECTIONS.map((collection) => [collection, []])),
  } as unknown as ClientArchiveData;
}

function makeArchive(data: ClientArchiveData = emptyData()): ClientArchive {
  return {
    contract: CLIENT_ARCHIVE_CONTRACT,
    version: CLIENT_ARCHIVE_VERSION,
    export_id: "22222222-2222-2222-2222-222222222222",
    generated_at: "2026-08-23T10:00:00.000Z",
    source_organization_id: "33333333-3333-3333-3333-333333333333",
    subject_client_id: "11111111-1111-1111-1111-111111111111",
    manifest: {
      data_dictionary_version: DATA_DICTIONARY_VERSION,
      scoring_model_versions: [],
      ontology_versions: [],
      snapshot_versions: [],
      record_counts: Object.fromEntries(
        ARCHIVE_COLLECTIONS.map((collection) => [
          collection,
          (data as unknown as Record<string, ArchiveRow[]>)[collection]?.length ?? 0,
        ])
      ),
      warnings: [],
      data_sha256: computeDataHash(data),
    },
    data,
  };
}

describe("archive contract shape (§11)", () => {
  it("always declares exactly the contract collections", () => {
    expect([...ARCHIVE_COLLECTIONS]).toEqual(CONTRACT_COLLECTIONS);
    expect(new Set(ARCHIVE_COLLECTIONS).size).toBe(ARCHIVE_COLLECTIONS.length);
  });

  it("requires client, every collection and reference_catalog", () => {
    expect([...REQUIRED_ARCHIVE_DATA_KEYS]).toEqual([
      "client",
      ...CONTRACT_COLLECTIONS,
      "reference_catalog",
    ]);
    expect([...REFERENCE_CATALOG_COLLECTIONS]).toEqual([
      "diagnostic_domains",
      "belief_templates",
      "intervention_methods",
    ]);
  });

  it("accepts an archive whose collections are all empty", () => {
    const archive = makeArchive();
    for (const collection of ARCHIVE_COLLECTIONS) {
      expect(archive.data[collection]).toEqual([]);
      expect(archive.manifest.record_counts[collection]).toBe(0);
    }
    expect(() => validateClientArchive(archive)).not.toThrow();
  });
});

describe("canonical serialization and data hash (§11)", () => {
  it("sorts object keys recursively and keeps array order", () => {
    expect(canonicalStringify({ b: 1, a: { d: [2, 1], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,1]},"b":1}'
    );
  });

  it("produces a reproducible hash for logically equal payloads", () => {
    const hash = computeDataHash({ b: 1, a: [1, 2] });
    expect(computeDataHash({ a: [1, 2], b: 1 })).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the hash when array order changes", () => {
    expect(computeDataHash({ a: [1, 2] })).not.toBe(computeDataHash({ a: [2, 1] }));
  });
});

describe("deterministic ordering", () => {
  it("is independent of input order and breaks ties by id", () => {
    const rows = [
      { id: "b", created_at: "2026-01-01T00:00:00Z" },
      { id: "a", created_at: "2026-01-01T00:00:00Z" },
      { id: "c", created_at: "2025-01-01T00:00:00Z" },
    ];
    const once = orderRows(rows, sortKeysFor("signals"));
    const twice = orderRows([...rows].reverse(), sortKeysFor("signals"));
    expect(once.map((row) => row.id)).toEqual(["c", "a", "b"]);
    expect(twice).toEqual(once);
  });

  it("keeps a total order when the primary key is missing", () => {
    const rows = [{ id: "y" }, { id: "x" }, { id: "z" }];
    expect(orderRows(rows, ["created_at", "id"]).map((row) => row.id)).toEqual(["x", "y", "z"]);
  });
});

describe("truncation guard (§2, §10)", () => {
  it("fails loudly when a collection is shorter than its exact count", () => {
    expect(() => assertCollectionComplete("signals", 999, 1000)).toThrow(/truncated/i);
  });

  it("accepts a complete or unverifiable collection", () => {
    expect(() => assertCollectionComplete("signals", 1000, 1000)).not.toThrow();
    expect(() => assertCollectionComplete("signals", 7, null)).not.toThrow();
  });
});

describe("dangling reference policy (§11)", () => {
  it("nulls a dangling scalar reference and records a count-only warning", () => {
    const data: Record<string, ArchiveRow[]> = {
      signals: [{ id: "s1", diagnostic_session_id: "missing-session" }],
      diagnostic_sessions: [],
      resources: [],
      model_changes: [],
      relationship_dynamics: [],
      recommendations: [],
      recommendation_targets: [],
      corrections: [],
      correction_targets: [],
      correction_expected_markers: [],
      follow_ups: [],
      observations: [],
      behavioral_markers: [],
      development_targets: [],
      signal_theme_links: [],
      theme_core_node_links: [],
      core_node_relations: [],
      trigger_activations: [],
      triggers: [],
      diagnostic_session_summaries: [],
      evidence_clusters: [],
    };
    const policy = applyReferencePolicy(data, {});
    expect(policy.data.signals[0].diagnostic_session_id).toBeNull();
    expect(policy.warnings).toEqual([
      {
        code: "dangling_reference",
        collection: "signals",
        field: "diagnostic_session_id",
        count: 1,
      },
    ]);
    expect(JSON.stringify(policy.warnings)).not.toContain("missing-session");
  });

  it("removes dangling array elements and keeps valid ones", () => {
    const data: Record<string, ArchiveRow[]> = {
      signals: [{ id: "s1" }],
      resources: [{ id: "r1", evidence_refs: ["s1", "ghost"] }],
    };
    const policy = applyReferencePolicy(data, {});
    expect(policy.data.resources[0].evidence_refs).toEqual(["s1"]);
    expect(policy.warnings[0]).toMatchObject({
      code: "dangling_reference",
      collection: "resources",
      field: "evidence_refs",
      count: 1,
    });
  });

  it("resolves polymorphic targets and nulls a missing one", () => {
    const data: Record<string, ArchiveRow[]> = {
      recommendation_targets: [
        { id: "t1", target_type: "core_node", target_id: "ghost", recommendation_id: "rec1" },
        { id: "t2", target_type: "theme", target_id: "th1", recommendation_id: "rec1" },
      ],
      recommendations: [{ id: "rec1" }],
      themes: [{ id: "th1" }],
    };
    const policy = applyReferencePolicy(data, {});
    expect(policy.data.recommendation_targets[0].target_id).toBeNull();
    expect(policy.data.recommendation_targets[1].target_id).toBe("th1");
    expect(policy.warnings).toHaveLength(1);
  });

  it("applies every rule of a collection without losing earlier substitutions", () => {
    const data: Record<string, ArchiveRow[]> = {
      signal_theme_links: [{ id: "l1", signal_id: "ghost-s", theme_id: "ghost-t" }],
      signals: [],
      themes: [],
    };
    const policy = applyReferencePolicy(data, {});
    expect(policy.data.signal_theme_links[0].signal_id).toBeNull();
    expect(policy.data.signal_theme_links[0].theme_id).toBeNull();
    expect(policy.warnings).toHaveLength(2);
  });

  it("resolves catalog references through reference_catalog", () => {
    const data: Record<string, ArchiveRow[]> = {
      corrections: [{ id: "c1", intervention_method_id: "m1" }],
    };
    const policy = applyReferencePolicy(data, { intervention_methods: [{ id: "m1" }] });
    expect(policy.data.corrections[0].intervention_method_id).toBe("m1");
    expect(policy.warnings).toEqual([]);
  });
});

describe("manifest authority", () => {
  it("rejects a missing collection", () => {
    const data = emptyData();
    delete (data as unknown as Record<string, unknown>).signals;
    expect(() => validateClientArchive(makeArchive(data))).toThrow(/signals/);
  });

  it("rejects a count that does not match the serialized collection", () => {
    const archive = makeArchive();
    archive.manifest.record_counts.signals = 3;
    expect(() => validateClientArchive(archive)).toThrow(/count mismatch/i);
  });

  it("rejects a hash that does not match the serialized data", () => {
    const archive = makeArchive();
    archive.manifest.data_sha256 = "0".repeat(64);
    expect(() => validateClientArchive(archive)).toThrow(/hash mismatch/i);
  });

  it("rejects a reference_catalog entry that is not an array", () => {
    const archive = makeArchive();
    (archive.data.reference_catalog as Record<string, unknown>).belief_templates = null;
    expect(() => validateClientArchive(archive)).toThrow(/belief_templates/);
  });
});

describe("export filenames carry no identifiers or raw content (§10, §12, §14)", () => {
  const clientId = "11111111-1111-1111-1111-111111111111";
  const statement = "Мне трудно просить о помощи";

  it("uses an opaque reference and a timestamp only", () => {
    const name = clientArchiveFilename(clientId, "2026-08-23T10:00:00.000Z");
    expect(name).toBe(`client_archive_${opaqueClientRef(clientId)}_2026-08-23T10-00-00-000Z.json`);
    expect(name).not.toContain(clientId);
    expect(name).not.toContain(statement);
  });

  it("names the CSV and supervision payloads without identifiers", () => {
    const csv = signalsCsvFilename(clientId, "2026-08-23T10:00:00.000Z");
    expect(csv).toMatch(/^signals_[0-9a-f]{16}_[0-9T-]+Z\.csv$/);
    expect(csv).not.toContain(clientId);

    const supervision = supervisionExportFilename(
      "44444444-4444-4444-4444-444444444444",
      "2026-08-23T10:00:00.000Z"
    );
    expect(supervision).toMatch(/^supervision_[0-9a-f-]+_[0-9T-]+Z\.json$/);
    expect(supervision).not.toContain(clientId);
    expect(supervision).not.toContain(statement);
  });
});

describe("supervision projection allowlist (§14)", () => {
  it("contains exactly the contract case keys", () => {
    expect([...SUPERVISION_CASE_KEYS]).toEqual([
      "generalized_requests",
      "generalized_goals",
      "evidence_summary",
      "themes",
      "core_hypotheses",
      "contradictions",
      "resources",
      "development_targets",
      "corrections_and_outcomes",
      "trend_summary",
      "supervision_questions",
    ]);
  });

  it("accepts the allowlisted shape and rejects extra keys or fields", () => {
    const projection: Record<string, unknown> = Object.fromEntries(
      SUPERVISION_CASE_KEYS.map((key) => [key, key === "trend_summary" ? null : []])
    );
    expect(() => assertAllowlistedProjection(projection)).not.toThrow();

    expect(() => assertAllowlistedProjection({ ...projection, raw_statement: ["secret"] })).toThrow(
      /allowlist/i
    );

    expect(() =>
      assertAllowlistedProjection({
        ...projection,
        themes: [{ name: "Тема", raw_statement: "secret" }],
      })
    ).toThrow(/allowlist/i);
  });
});
