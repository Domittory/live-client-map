import { createHash, randomUUID } from "node:crypto";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { hasConsent, requireConsent } from "./consent";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Full client JSON archive assembler (ticket 18,
 * docs/data-exchange-contracts.md §11).
 *
 * The contract in §11 is normative here:
 *   - `data` always carries EVERY required top-level collection; a category with
 *     no rows is `[]`, never omitted. `client` is an object, `reference_catalog`
 *     an object.
 *   - `record_counts` is derived from the serialized arrays, `data_sha256` is
 *     computed over the canonical serialization of `data` only, so the checksum
 *     is not self-referential.
 *   - Nothing is truncated silently: every collection is paged to completion and
 *     verified against an exact count; a mismatch is a typed failure, not a
 *     shorter file.
 *   - Dangling references are forbidden: a reference that does not resolve to an
 *     included record is replaced with `null` (array element removed) and named
 *     in `manifest.warnings` — never dropped silently.
 *   - Ordering is deterministic, so the canonical hash is reproducible.
 *   - Relationship data is included only when BOTH clients have an active
 *     `relationship_analysis` consent and the exporter has access to both, and
 *     never carries the other client's private evidence (or the other client's
 *     signal identifiers). Otherwise the relationship collections stay empty and
 *     a warning without any second-client identifier is recorded.
 *   - Private specialist notes, auth/user directory and audit IP/user-agent are
 *     excluded.
 */

export const CLIENT_ARCHIVE_CONTRACT = "live-client-map.client-archive";
export const CLIENT_ARCHIVE_VERSION = "1.0";
export const DATA_DICTIONARY_VERSION = "1.0";

/**
 * Required top-level `data` collections in the exact order of §11. The archive
 * always serializes all of them; `record_counts` mirrors this list.
 */
export const ARCHIVE_COLLECTIONS = [
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
] as const;

export type ArchiveCollection = (typeof ARCHIVE_COLLECTIONS)[number];

/** The three catalog revisions allowed inside `reference_catalog` (§11). */
export const REFERENCE_CATALOG_COLLECTIONS = [
  "diagnostic_domains",
  "belief_templates",
  "intervention_methods",
] as const;

/** Every `data` key the contract requires to be present. */
export const REQUIRED_ARCHIVE_DATA_KEYS = [
  "client",
  ...ARCHIVE_COLLECTIONS,
  "reference_catalog",
] as const;

export type ArchiveRow = Record<string, unknown>;

export interface ArchiveWarning {
  code: string;
  collection: string;
  field: string | null;
  count: number;
}

export interface ClientArchiveManifest {
  data_dictionary_version: string;
  scoring_model_versions: string[];
  ontology_versions: string[];
  snapshot_versions: number[];
  record_counts: Record<string, number>;
  warnings: ArchiveWarning[];
  data_sha256: string;
}

export interface ClientArchive {
  contract: string;
  version: string;
  export_id: string;
  generated_at: string;
  source_organization_id: string;
  subject_client_id: string;
  manifest: ClientArchiveManifest;
  data: ClientArchiveData;
}

export type ClientArchiveData = {
  client: ArchiveRow | null;
  reference_catalog: Record<string, ArchiveRow[]>;
} & { [K in ArchiveCollection]: ArchiveRow[] };

/**
 * One built artifact together with everything an ExportRequest records about it
 * (ticket 19). `content` is the exact serialized file; `counts` and
 * `warnings` never carry raw content or identifiers.
 */
export interface ClientArchiveArtifact {
  content: string;
  content_type: string;
  byte_size: number;
  content_sha256: string;
  counts: Record<string, number>;
  warnings: ArchiveWarning[];
}

/** Media type of the §11 archive, used for the stored object and the download. */
export const CLIENT_ARCHIVE_MEDIA_TYPE = "application/vnd.live-client-map.client-archive+json";

/** Everything `assembleClientArchive()` read, before the manifest is built. */
export interface ClientArchiveInput {
  organizationId: string;
  clientId: string;
  /** The subject client row, already without `organization_id`. */
  client: ArchiveRow | null;
  /** Policy-applied collections (dangling references already replaced). */
  collections: Record<string, ArchiveRow[]>;
  referenceCatalog: Record<string, ArchiveRow[]>;
  /** Warnings collected before the manifest (reference/relationship/evidence counts). */
  warnings: ArchiveWarning[];
  /** Export request that owns this archive (ticket 19); defaults to a new UUID. */
  exportId?: string;
  /** Generation timestamp; defaults to now. */
  generatedAt?: string;
}

// --- Canonical serialization and hashing ---------------------------------------

/**
 * Deterministic JSON: object keys are sorted recursively, `undefined` object
 * values are dropped. Array order is preserved (the contract stores order).
 * Two logically equal payloads always produce identical bytes.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([a], [b]) => compareCodeUnits(a, b))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

/** `data_sha256` over canonical JSON of `data` only (§11). */
export function computeDataHash(data: unknown): string {
  return createHash("sha256").update(canonicalStringify(data), "utf8").digest("hex");
}

// --- Deterministic ordering ----------------------------------------------------

function compareCodeUnits(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareValues(a: unknown, b: unknown): number {
  const left = a === null || a === undefined ? "" : a;
  const right = b === null || b === undefined ? "" : b;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return compareCodeUnits(String(left), String(right));
}

const DEFAULT_SORT_KEYS = ["created_at", "id"] as const;

/** Primary sort key per collection; `id` always breaks ties (total order). */
const SORT_KEYS: Partial<Record<ArchiveCollection, readonly string[]>> = {
  consent_records: ["granted_at", "id"],
  model_changes: ["occurred_at", "id"],
  psychological_snapshots: ["version", "id"],
};

export function sortKeysFor(collection: ArchiveCollection): readonly string[] {
  return SORT_KEYS[collection] ?? DEFAULT_SORT_KEYS;
}

/** Stable, locale-independent ordering: declared keys then a total tie-break. */
export function orderRows<T extends ArchiveRow>(rows: readonly T[], keys: readonly string[]): T[] {
  return [...rows].sort((a, b) => {
    for (const key of keys) {
      const cmp = compareValues(a[key], b[key]);
      if (cmp !== 0) return cmp;
    }
    return 0;
  });
}

// --- Truncation guard ----------------------------------------------------------

const PAGE_SIZE = 500;

interface PageResult {
  data: unknown[] | null;
  error: PostgrestError | null;
  count: number | null;
}

type PageLoader = (from: number, to: number) => PromiseLike<PageResult>;

/**
 * §2: exports are never truncated. A truncated page set is a typed failure, so a
 * partial archive can never reach a download.
 */
export function assertCollectionComplete(
  collection: string,
  fetched: number,
  expected: number | null
): void {
  if (expected !== null && fetched !== expected) {
    throw new ServiceError("INTERNAL_ERROR", `Export truncated: ${collection}`, {
      code: "export_truncated",
      collection,
      expected,
      fetched,
    });
  }
}

async function loadAll(collection: string, load: PageLoader): Promise<ArchiveRow[]> {
  const rows: ArchiveRow[] = [];
  let expected: number | null = null;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error, count } = await load(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new ServiceError("INTERNAL_ERROR", `Failed to read ${collection}`, {
        code: "export_read_failed",
        collection,
      });
    }
    if (expected === null && typeof count === "number") expected = count;
    const page = (data ?? []) as ArchiveRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  assertCollectionComplete(collection, rows.length, expected);
  return rows;
}

// --- Collection scoping --------------------------------------------------------

type CollectionScope =
  | { kind: "client" }
  | { kind: "parents"; parents: ReadonlyArray<{ column: string; from: ArchiveCollection }> }
  | { kind: "relationships" }
  | { kind: "audit" }
  | { kind: "unsourced" };

interface CollectionPlan {
  table: string;
  scope: CollectionScope;
  columns?: string;
}

function scoped(table: string, scope: CollectionScope = { kind: "client" }, columns?: string) {
  return { table, scope, columns } satisfies CollectionPlan;
}

/** Columns safe to export: audit IP address and user agent stay out (§11). */
const AUDIT_COLUMNS =
  "id, organization_id, actor_user_id, entity_type, entity_id, action, before_data, after_data, reason, created_at";

/**
 * Column list for the subject client: private specialist notes and the owner
 * user reference stay out; `organization_id` is already the archive's
 * `source_organization_id`.
 */
const CLIENT_COLUMNS =
  "id, organization_id, display_name, first_name, last_name, birth_date, birth_time, birth_place, gender, relationship_status, occupation, current_role, children_info, client_visible_notes, status, created_at, updated_at, archived_at, legal_hold";

const COLLECTION_PLANS: Record<ArchiveCollection, CollectionPlan> = {
  consent_records: scoped("consent_records"),
  client_requests: scoped("client_requests"),
  client_goals: scoped("client_goals"),
  life_events: scoped("life_events"),
  triggers: scoped("triggers"),
  diagnostic_sessions: scoped("diagnostic_sessions"),
  diagnostic_session_summaries: scoped("diagnostic_session_summaries"),
  signals: scoped("signals"),
  evidence_clusters: scoped("evidence_clusters"),
  themes: scoped("themes"),
  core_nodes: scoped("core_nodes"),
  differential_hypotheses: scoped("differential_hypotheses"),
  signal_theme_links: scoped("signal_theme_links", {
    kind: "parents",
    parents: [
      { column: "signal_id", from: "signals" },
      { column: "theme_id", from: "themes" },
    ],
  }),
  theme_core_node_links: scoped("theme_core_node_links", {
    kind: "parents",
    parents: [
      { column: "theme_id", from: "themes" },
      { column: "core_node_id", from: "core_nodes" },
    ],
  }),
  core_node_relations: scoped("core_node_relations"),
  trigger_activations: scoped("trigger_activations", {
    kind: "parents",
    parents: [{ column: "trigger_id", from: "triggers" }],
  }),
  resources: scoped("resources"),
  development_targets: scoped("development_targets"),
  purpose_profiles: scoped("purpose_profiles"),
  purpose_syntheses: scoped("purpose_syntheses"),
  recommendations: scoped("recommendations"),
  recommendation_targets: scoped("recommendation_targets", {
    kind: "parents",
    parents: [{ column: "recommendation_id", from: "recommendations" }],
  }),
  corrections: scoped("corrections"),
  correction_targets: scoped("correction_targets", {
    kind: "parents",
    parents: [{ column: "correction_id", from: "corrections" }],
  }),
  correction_expected_markers: scoped("correction_expected_markers", {
    kind: "parents",
    parents: [{ column: "correction_id", from: "corrections" }],
  }),
  observations: scoped("observations"),
  behavioral_markers: scoped("behavioral_markers"),
  follow_ups: scoped("follow_ups"),
  model_changes: scoped("model_changes"),
  psychological_snapshots: scoped("psychological_snapshots"),
  // SPEC §10 entities whose storage does not exist in the v1 schema: the contract
  // still requires the collections, so they are present and empty.
  medical_facts: scoped("", { kind: "unsourced" }),
  symptom_reports: scoped("", { kind: "unsourced" }),
  psychological_hypotheses: scoped("", { kind: "unsourced" }),
  relationships: scoped("relationships", { kind: "relationships" }),
  relationship_dynamics: scoped("relationship_dynamics", {
    kind: "parents",
    parents: [{ column: "relationship_id", from: "relationships" }],
  }),
  audit_events: scoped("audit_log", { kind: "audit" }, AUDIT_COLUMNS),
};

// --- Dangling reference policy -------------------------------------------------

interface ReferenceRule {
  collection: ArchiveCollection;
  field: string;
  /** Target collection, or `reference_catalog.<collection>`. */
  target?: string;
  /** Polymorphic targets: the collection is chosen by this field. */
  typeField?: string;
  array?: boolean;
}

const POLYMORPHIC_TARGETS: Record<string, ArchiveCollection> = {
  core_node: "core_nodes",
  theme: "themes",
  resource: "resources",
  client_request: "client_requests",
  development_target: "development_targets",
};

const REFERENCE_RULES: readonly ReferenceRule[] = [
  { collection: "signals", field: "diagnostic_session_id", target: "diagnostic_sessions" },
  {
    collection: "diagnostic_session_summaries",
    field: "diagnostic_session_id",
    target: "diagnostic_sessions",
  },
  {
    collection: "evidence_clusters",
    field: "diagnostic_session_id",
    target: "diagnostic_sessions",
  },
  { collection: "signal_theme_links", field: "signal_id", target: "signals" },
  { collection: "signal_theme_links", field: "theme_id", target: "themes" },
  { collection: "theme_core_node_links", field: "theme_id", target: "themes" },
  { collection: "theme_core_node_links", field: "core_node_id", target: "core_nodes" },
  { collection: "core_node_relations", field: "from_core_node_id", target: "core_nodes" },
  { collection: "core_node_relations", field: "to_core_node_id", target: "core_nodes" },
  { collection: "trigger_activations", field: "trigger_id", target: "triggers" },
  { collection: "trigger_activations", field: "theme_id", target: "themes" },
  { collection: "trigger_activations", field: "core_node_id", target: "core_nodes" },
  { collection: "triggers", field: "life_event_id", target: "life_events" },
  { collection: "recommendations", field: "client_request_id", target: "client_requests" },
  { collection: "recommendation_targets", field: "recommendation_id", target: "recommendations" },
  { collection: "recommendation_targets", field: "target_id", typeField: "target_type" },
  { collection: "corrections", field: "recommendation_id", target: "recommendations" },
  {
    collection: "corrections",
    field: "intervention_method_id",
    target: "reference_catalog.intervention_methods",
  },
  { collection: "correction_targets", field: "correction_id", target: "corrections" },
  { collection: "correction_targets", field: "target_id", typeField: "target_type" },
  {
    collection: "correction_expected_markers",
    field: "correction_id",
    target: "corrections",
  },
  { collection: "follow_ups", field: "correction_id", target: "corrections" },
  { collection: "observations", field: "correction_id", target: "corrections" },
  { collection: "behavioral_markers", field: "linked_core_node_id", target: "core_nodes" },
  { collection: "behavioral_markers", field: "linked_theme_id", target: "themes" },
  { collection: "behavioral_markers", field: "linked_resource_id", target: "resources" },
  { collection: "resources", field: "evidence_refs", target: "signals", array: true },
  { collection: "model_changes", field: "evidence_refs", target: "signals", array: true },
  {
    collection: "development_targets",
    field: "linked_core_nodes",
    target: "core_nodes",
    array: true,
  },
  {
    collection: "development_targets",
    field: "linked_resources",
    target: "resources",
    array: true,
  },
  { collection: "relationship_dynamics", field: "evidence_refs", target: "signals", array: true },
];

function idSet(rows: readonly ArchiveRow[]): Set<string> {
  return new Set(rows.map((row) => String(row.id)));
}

function warningKey(code: string, collection: string, field: string | null): string {
  return `${code}\u0000${collection}\u0000${field ?? ""}`;
}

/**
 * §11: a record either includes an allowed target record or its reference becomes
 * `null` with a manifest warning. This never fails the export on its own — it
 * makes the substitution explicit and count-based, without leaking the missing
 * identifier into the warning.
 */
export function applyReferencePolicy(
  data: Record<string, ArchiveRow[]>,
  catalog: Record<string, ArchiveRow[]>
): { data: Record<string, ArchiveRow[]>; warnings: ArchiveWarning[] } {
  const sets = new Map<string, Set<string>>();
  const targetSet = (target: string): Set<string> => {
    const cached = sets.get(target);
    if (cached) return cached;
    const source = target.startsWith("reference_catalog.")
      ? (catalog[target.slice("reference_catalog.".length)] ?? [])
      : (data[target] ?? []);
    const set = idSet(source);
    sets.set(target, set);
    return set;
  };

  const warnings = new Map<string, ArchiveWarning>();
  const bump = (code: string, collection: string, field: string | null, removed: number) => {
    if (removed <= 0) return;
    const key = warningKey(code, collection, field);
    const current = warnings.get(key);
    warnings.set(key, {
      code,
      collection,
      field,
      count: (current?.count ?? 0) + removed,
    });
  };

  const result: Record<string, ArchiveRow[]> = { ...data };

  for (const rule of REFERENCE_RULES) {
    // Read the current state so a second rule on the same collection keeps the
    // substitutions the first rule already made.
    const rows = result[rule.collection];
    if (!rows || rows.length === 0) continue;

    const touched: ArchiveRow[] = [];
    let changed = false;

    for (const row of rows) {
      const value = row[rule.field];

      if (rule.array) {
        if (!Array.isArray(value)) {
          touched.push(row);
          continue;
        }
        const target = targetSet(rule.target!);
        const kept = value.filter((entry) => target.has(String(entry)));
        if (kept.length !== value.length) {
          bump("dangling_reference", rule.collection, rule.field, value.length - kept.length);
          touched.push({ ...row, [rule.field]: kept });
          changed = true;
        } else {
          touched.push(row);
        }
        continue;
      }

      if (value === null || value === undefined) {
        touched.push(row);
        continue;
      }

      const target = rule.typeField
        ? POLYMORPHIC_TARGETS[String(row[rule.typeField])]
        : rule.target;
      if (!target) {
        // Unknown or absent discriminator: nothing to resolve against.
        touched.push(row);
        continue;
      }
      if (targetSet(target).has(String(value))) {
        touched.push(row);
        continue;
      }

      bump("dangling_reference", rule.collection, rule.field, 1);
      touched.push({ ...row, [rule.field]: null });
      changed = true;
    }

    if (changed) result[rule.collection] = touched;
  }

  return { data: result, warnings: [...warnings.values()].sort(compareWarnings) };
}

export function compareWarnings(a: ArchiveWarning, b: ArchiveWarning): number {
  return (
    compareCodeUnits(a.code, b.code) ||
    compareCodeUnits(a.collection, b.collection) ||
    compareCodeUnits(a.field ?? "", b.field ?? "")
  );
}

// --- Reference catalog ---------------------------------------------------------

function distinctStrings(values: readonly unknown[]): string[] {
  return [
    ...new Set(
      values.filter((value): value is string => typeof value === "string" && value !== "")
    ),
  ].sort(compareCodeUnits);
}

/**
 * §11: `reference_catalog` holds only the catalog revisions actually referenced
 * by the serialized data. v1 client data references DiagnosticDomain through the
 * free-text domain fields and InterventionMethod through `corrections`, while
 * BeliefTemplate has no reference from the portable read model, so it stays empty
 * rather than being guessed.
 */
async function buildReferenceCatalog(
  client: SupabaseClient,
  organizationId: string,
  collections: Record<string, ArchiveRow[]>
): Promise<Record<string, ArchiveRow[]>> {
  const domainValues = new Set<string>();
  for (const collection of ["core_nodes", "themes", "resources", "development_targets"] as const) {
    for (const row of collections[collection] ?? []) {
      const value = collection === "core_nodes" ? row.root_domain : row.domain;
      if (typeof value === "string" && value !== "") domainValues.add(value);
    }
  }

  let diagnosticDomains: ArchiveRow[] = [];
  if (domainValues.size > 0) {
    const all = await loadAll("diagnostic_domains", (from, to) =>
      client
        .from("diagnostic_domains")
        .select("*", { count: "exact" })
        .or(`organization_id.eq.${organizationId},is_system.eq.true`)
        .order("id", { ascending: true })
        .range(from, to)
    );
    diagnosticDomains = all.filter(
      (row) => domainValues.has(String(row.slug)) || domainValues.has(String(row.name))
    );
  }

  const methodIds = distinctStrings(
    (collections.corrections ?? []).map((row) => row.intervention_method_id)
  );
  const interventionMethods = await loadByIds(
    client,
    "intervention_methods",
    "intervention_methods",
    "*",
    methodIds
  );

  return {
    diagnostic_domains: orderRows(diagnosticDomains, ["id"]),
    belief_templates: [],
    intervention_methods: orderRows(interventionMethods, ["id"]),
  };
}

// --- Relationship privacy ------------------------------------------------------

function relationshipOtherClient(row: ArchiveRow, clientId: string): string {
  const a = String(row.client_a_id);
  const b = String(row.client_b_id);
  return a === clientId ? b : a;
}

/**
 * §11: relationship records require active `relationship_analysis` consent for
 * BOTH clients and allowed exporter access to both. A rejected link contributes a
 * count-only warning — the second client's identifier is never emitted.
 */
async function gateRelationships(
  client: SupabaseClient,
  organizationId: string,
  clientId: string,
  rows: readonly ArchiveRow[]
): Promise<{ allowed: ArchiveRow[]; withheld: number }> {
  const consents = new Map<string, boolean>();
  const accesses = new Map<string, boolean>();

  const consentFor = async (id: string): Promise<boolean> => {
    const cached = consents.get(id);
    if (cached !== undefined) return cached;
    const value = await hasConsent(client, id, "relationship_analysis");
    consents.set(id, value);
    return value;
  };

  const accessFor = async (id: string): Promise<boolean> => {
    const cached = accesses.get(id);
    if (cached !== undefined) return cached;
    const { data, error } = await client.rpc("is_client_accessible", {
      p_org_id: organizationId,
      p_client_id: id,
      p_require_write: false,
    });
    if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to check relationship access");
    const value = Boolean(data);
    accesses.set(id, value);
    return value;
  };

  const allowed: ArchiveRow[] = [];
  let withheld = 0;
  for (const row of rows) {
    const a = String(row.client_a_id);
    const b = String(row.client_b_id);
    const other = relationshipOtherClient(row, clientId);
    const ok =
      (await consentFor(a)) &&
      (await consentFor(b)) &&
      (await accessFor(a)) &&
      (await accessFor(b)) &&
      other.length > 0;
    if (ok) allowed.push(row);
    else withheld += 1;
  }
  return { allowed, withheld };
}

/**
 * RelationshipDynamics stay, but their `evidence_refs` are reduced to the subject
 * client's `client_visible` signals: another client's evidence (private or not)
 * and private signals of the subject never enter the archive. The removed count is
 * the only thing recorded.
 */
function filterRelationshipEvidence(
  rows: readonly ArchiveRow[],
  publicSignalIds: Set<string>
): { rows: ArchiveRow[]; removed: number } {
  let removed = 0;
  const filtered = rows.map((row) => {
    const refs = Array.isArray(row.evidence_refs) ? row.evidence_refs.map(String) : [];
    const kept = refs.filter((ref) => publicSignalIds.has(ref));
    removed += refs.length - kept.length;
    return kept.length === refs.length ? row : { ...row, evidence_refs: kept };
  });
  return { rows: filtered, removed };
}

// --- Archive validation --------------------------------------------------------

/** Self-check that the manifest is authoritative for the serialized payload. */
export function validateClientArchive(archive: ClientArchive): void {
  if (archive.contract !== CLIENT_ARCHIVE_CONTRACT) {
    throw new ServiceError("INTERNAL_ERROR", "Archive contract mismatch");
  }
  if (archive.version !== CLIENT_ARCHIVE_VERSION) {
    throw new ServiceError("INTERNAL_ERROR", "Archive version mismatch");
  }

  for (const key of REQUIRED_ARCHIVE_DATA_KEYS) {
    if (!(key in archive.data)) {
      throw new ServiceError("INTERNAL_ERROR", `Archive collection missing: ${key}`);
    }
  }

  const clientValue = archive.data.client;
  if (clientValue !== null && (typeof clientValue !== "object" || Array.isArray(clientValue))) {
    throw new ServiceError("INTERNAL_ERROR", "Archive client must be an object or null");
  }

  const catalog = archive.data.reference_catalog;
  if (catalog === null || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw new ServiceError("INTERNAL_ERROR", "Archive reference_catalog must be an object");
  }
  for (const collection of REFERENCE_CATALOG_COLLECTIONS) {
    if (!Array.isArray((catalog as Record<string, unknown>)[collection])) {
      throw new ServiceError(
        "INTERNAL_ERROR",
        `Archive reference_catalog.${collection} must be an array`
      );
    }
  }

  for (const collection of ARCHIVE_COLLECTIONS) {
    const value = archive.data[collection];
    if (!Array.isArray(value)) {
      throw new ServiceError("INTERNAL_ERROR", `Archive collection is not an array: ${collection}`);
    }
    const counted = archive.manifest.record_counts[collection];
    if (counted !== value.length) {
      throw new ServiceError("INTERNAL_ERROR", `Archive record count mismatch: ${collection}`);
    }
  }

  const countedKeys = Object.keys(archive.manifest.record_counts).sort(compareCodeUnits);
  const expectedKeys = [...ARCHIVE_COLLECTIONS].sort(compareCodeUnits);
  if (canonicalStringify(countedKeys) !== canonicalStringify(expectedKeys)) {
    throw new ServiceError("INTERNAL_ERROR", "Archive record_counts keys mismatch");
  }

  if (!Array.isArray(archive.manifest.warnings)) {
    throw new ServiceError("INTERNAL_ERROR", "Archive warnings must be an array");
  }

  if (archive.manifest.data_sha256 !== computeDataHash(archive.data)) {
    throw new ServiceError("INTERNAL_ERROR", "Archive data hash mismatch");
  }
}

// --- Assembly ------------------------------------------------------------------

function clientLoader(
  client: SupabaseClient,
  table: string,
  columns: string,
  clientId: string
): PageLoader {
  return (from, to) =>
    client
      .from(table)
      .select(columns, { count: "exact" })
      .eq("client_id", clientId)
      .order("id", { ascending: true })
      .range(from, to);
}

interface ParentConstraint {
  column: string;
  ids: string[];
}

/** Keep every `.in` filter small enough that the request URL stays bounded. */
const MAX_IN_VALUES = 100;

function buildConstrainedLoader(
  client: SupabaseClient,
  table: string,
  columns: string,
  constraints: readonly ParentConstraint[]
): PageLoader {
  return (from, to) => {
    let query = client.from(table).select(columns, { count: "exact" });
    for (const constraint of constraints) {
      query = query.in(constraint.column, constraint.ids);
    }
    return query.order("id", { ascending: true }).range(from, to);
  };
}

/**
 * Load rows matching `column in ids` for every constraint (AND). Large id sets are
 * partitioned recursively on one column at a time: the AND of the constraints is
 * exactly the union of the partitions, so no row is ever lost, and no single
 * request carries an unbounded `in` list. Each leaf is still verified against its
 * own exact count.
 */
async function loadConstrained(
  client: SupabaseClient,
  collection: string,
  table: string,
  columns: string,
  constraints: readonly ParentConstraint[]
): Promise<ArchiveRow[]> {
  if (constraints.some((constraint) => constraint.ids.length === 0)) return [];

  const total = constraints.reduce((sum, constraint) => sum + constraint.ids.length, 0);
  if (total <= MAX_IN_VALUES) {
    return loadAll(collection, buildConstrainedLoader(client, table, columns, constraints));
  }

  const target = constraints.reduce((largest, constraint) =>
    constraint.ids.length > largest.ids.length ? constraint : largest
  );
  const middle = Math.ceil(target.ids.length / 2);
  const split = (ids: string[]) =>
    constraints.map((constraint) => (constraint === target ? { ...constraint, ids } : constraint));

  const [left, right] = await Promise.all([
    loadConstrained(client, collection, table, columns, split(target.ids.slice(0, middle))),
    loadConstrained(client, collection, table, columns, split(target.ids.slice(middle))),
  ]);
  return [...left, ...right];
}

/** Load rows by primary key in bounded chunks, each verified against its count. */
async function loadByIds(
  client: SupabaseClient,
  collection: string,
  table: string,
  columns: string,
  ids: readonly string[]
): Promise<ArchiveRow[]> {
  if (ids.length === 0) return [];
  const chunks: string[][] = [];
  for (let index = 0; index < ids.length; index += MAX_IN_VALUES) {
    chunks.push(ids.slice(index, index + MAX_IN_VALUES));
  }
  const pages = await Promise.all(
    chunks.map((chunk) =>
      loadAll(collection, (from, to) =>
        client
          .from(table)
          .select(columns, { count: "exact" })
          .in("id", chunk)
          .order("id", { ascending: true })
          .range(from, to)
      )
    )
  );
  return pages.flat();
}

async function loadClientScoped(
  client: SupabaseClient,
  clientId: string
): Promise<Record<string, ArchiveRow[]>> {
  const collections: Record<string, ArchiveRow[]> = {};
  const planned = ARCHIVE_COLLECTIONS.filter(
    (collection) => COLLECTION_PLANS[collection].scope.kind === "client"
  );
  await Promise.all(
    planned.map(async (collection) => {
      const plan = COLLECTION_PLANS[collection];
      collections[collection] = await loadAll(
        collection,
        clientLoader(client, plan.table, plan.columns ?? "*", clientId)
      );
    })
  );
  return collections;
}

async function loadParentScoped(
  client: SupabaseClient,
  collections: Record<string, ArchiveRow[]>
): Promise<void> {
  const planned = ARCHIVE_COLLECTIONS.filter(
    (collection) => COLLECTION_PLANS[collection].scope.kind === "parents"
  );
  await Promise.all(
    planned.map(async (collection) => {
      const plan = COLLECTION_PLANS[collection];
      const parents = plan.scope.kind === "parents" ? plan.scope.parents : [];
      const constraints = parents.map((parent) => ({
        column: parent.column,
        ids: [...idSet(collections[parent.from] ?? [])],
      }));
      collections[collection] = await loadConstrained(
        client,
        collection,
        plan.table,
        plan.columns ?? "*",
        constraints
      );
    })
  );
}

/**
 * Assemble the full archive for one client. Read-only; the caller audits the
 * completed export. Returns the organization id alongside so the caller does not
 * have to resolve access a second time.
 *
 * `options.exportId` lets the asynchronous ExportRequest path (ticket 19) make
 * the archive's `export_id` the identifier of the request that produced it, so
 * the stored file and the request row agree. Without it a fresh UUID is used.
 */
export async function assembleClientArchive(
  client: SupabaseClient,
  rawClientId: string,
  options: { exportId?: string; generatedAt?: string } = {}
): Promise<{ archive: ClientArchive; organizationId: string }> {
  const clientId = validate(uuid, rawClientId);

  const { data: clientRow, error: clientError } = await client
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("id", clientId)
    .maybeSingle();
  if (clientError) throw new ServiceError("INTERNAL_ERROR", "Failed to read client");
  if (!clientRow) throw new ServiceError("NOT_FOUND", "Client not found");

  const clientRecord = clientRow as ArchiveRow;
  const organizationId = String(clientRecord.organization_id);

  const { data: owner } = await client.rpc("is_org_owner", { org_id: organizationId });
  if (!owner) {
    throw new ServiceError("FORBIDDEN", "Only the organization owner can export a full archive");
  }
  await requireConsent(client, clientId, "data_storage");

  const collections = await loadClientScoped(client, clientId);

  // Relationships are scoped by both sides of the link and then privacy-gated.
  const relationshipsRaw = await loadAll("relationships", (from, to) =>
    client
      .from("relationships")
      .select("*", { count: "exact" })
      .eq("organization_id", organizationId)
      .or(`client_a_id.eq.${clientId},client_b_id.eq.${clientId}`)
      .order("id", { ascending: true })
      .range(from, to)
  );
  const gated = await gateRelationships(client, organizationId, clientId, relationshipsRaw);
  collections.relationships = gated.allowed;

  await loadParentScoped(client, collections);

  const publicSignalIds = new Set(
    (collections.signals ?? [])
      .filter((row) => row.visibility === "client_visible")
      .map((row) => String(row.id))
  );
  const evidence = filterRelationshipEvidence(
    collections.relationship_dynamics ?? [],
    publicSignalIds
  );
  collections.relationship_dynamics = evidence.rows;

  collections.audit_events = await loadAll("audit_events", (from, to) =>
    client
      .from("audit_log")
      .select(AUDIT_COLUMNS, { count: "exact" })
      .eq("organization_id", organizationId)
      .eq("entity_type", "client")
      .eq("entity_id", clientId)
      .order("id", { ascending: true })
      .range(from, to)
  );

  for (const collection of ARCHIVE_COLLECTIONS) {
    if (COLLECTION_PLANS[collection].scope.kind === "unsourced") collections[collection] = [];
  }

  const referenceCatalog = await buildReferenceCatalog(client, organizationId, collections);

  const policy = applyReferencePolicy(collections, referenceCatalog);

  const warnings: ArchiveWarning[] = [...policy.warnings];
  if (gated.withheld > 0) {
    warnings.push({
      code: "relationship_withheld",
      collection: "relationships",
      field: null,
      count: gated.withheld,
    });
  }
  if (evidence.removed > 0) {
    warnings.push({
      code: "private_evidence_filtered",
      collection: "relationship_dynamics",
      field: "evidence_refs",
      count: evidence.removed,
    });
  }
  warnings.sort(compareWarnings);

  const clientPayload = { ...clientRecord };
  delete clientPayload.organization_id;

  const archive = await buildClientArchive(client, {
    organizationId,
    clientId,
    client: clientPayload,
    collections: policy.data,
    referenceCatalog,
    warnings,
    exportId: options.exportId,
    generatedAt: options.generatedAt,
  });

  return { archive, organizationId };
}

/**
 * Build the contract-shaped archive, its manifest and its serialized artifact
 * from an already-authorized, already-read data set.
 *
 * This is the single place where the manifest is derived (ticket 18) and where
 * the artifact bytes and their checksum are produced (ticket 19), so the
 * synchronous service path and the asynchronous ExportRequest path cannot
 * disagree about the file. It performs no reads and no authorization: the caller
 * owns tenant/assignment/consent checks and the audit trail.
 *
 * `warnings` are the counts collected by the caller (relationship/evidence
 * privacy); the manifest's own `dangling_reference` warnings are merged here.
 */
export async function buildClientArchive(
  client: SupabaseClient,
  input: ClientArchiveInput
): Promise<ClientArchive> {
  const { organizationId, clientId, collections, referenceCatalog } = input;

  // `data` follows the contract key order: client, every collection in declared
  // order, then reference_catalog. Every collection is present.
  const data = {
    client: input.client,
    ...Object.fromEntries(
      ARCHIVE_COLLECTIONS.map((collection) => [
        collection,
        orderRows(collections[collection] ?? [], sortKeysFor(collection)),
      ])
    ),
    reference_catalog: referenceCatalog,
  } as ClientArchiveData;

  const recommendations = data.recommendations;
  const snapshots = data.psychological_snapshots;

  // `input.warnings` already contains the reference policy's `dangling_reference`
  // counts plus the relationship/evidence privacy counts collected by the caller.
  const warnings = mergeWarnings(input.warnings);

  const manifest: ClientArchiveManifest = {
    data_dictionary_version: DATA_DICTIONARY_VERSION,
    scoring_model_versions: distinctStrings([
      ...recommendations.map((row) => row.scoring_model_version),
      ...snapshots.map((row) => row.scoring_model_version),
    ]),
    ontology_versions: await resolveOntologyVersions(
      client,
      snapshots,
      referenceCatalog.diagnostic_domains ?? []
    ),
    snapshot_versions: [
      ...new Set(
        snapshots.map((row) => Number(row.version)).filter((version) => Number.isFinite(version))
      ),
    ].sort((a, b) => a - b),
    record_counts: Object.fromEntries(
      ARCHIVE_COLLECTIONS.map((collection) => [collection, data[collection].length])
    ),
    warnings,
    data_sha256: computeDataHash(data),
  };

  const archive: ClientArchive = {
    contract: CLIENT_ARCHIVE_CONTRACT,
    version: CLIENT_ARCHIVE_VERSION,
    export_id: input.exportId ?? randomUUID(),
    generated_at: input.generatedAt ?? new Date().toISOString(),
    source_organization_id: organizationId,
    subject_client_id: clientId,
    manifest,
    data,
  };

  validateClientArchive(archive);
  return archive;
}

/**
 * Collect warnings from any number of sources into one deterministic list.
 * Exported because the ExportRequest path adds its own counts and must produce
 * the identical ordering.
 */
export function mergeWarnings(
  ...sources: ReadonlyArray<readonly ArchiveWarning[]>
): ArchiveWarning[] {
  const merged = new Map<string, ArchiveWarning>();
  for (const source of sources) {
    for (const warning of source) {
      const key = warningKey(warning.code, warning.collection, warning.field);
      const current = merged.get(key);
      merged.set(key, {
        code: warning.code,
        collection: warning.collection,
        field: warning.field,
        count: (current?.count ?? 0) + warning.count,
      });
    }
  }
  return [...merged.values()].sort(compareWarnings);
}

/**
 * Canonical serialization of an assembled archive plus the metadata an
 * ExportRequest records: byte size and the lowercase-hex SHA-256 of the exact
 * stored bytes. The artifact IS the contract file — no wrapper, no added
 * fields — so a download is a valid §11 archive.
 */
export function buildClientArchiveArtifact(archive: ClientArchive): ClientArchiveArtifact {
  validateClientArchive(archive);
  const content = canonicalStringify(archive);
  return {
    content,
    content_type: CLIENT_ARCHIVE_MEDIA_TYPE,
    byte_size: Buffer.byteLength(content, "utf8"),
    content_sha256: createHash("sha256").update(content, "utf8").digest("hex"),
    counts: { ...archive.manifest.record_counts },
    warnings: archive.manifest.warnings,
  };
}

/** Ontology version strings referenced by snapshots and included domains. */
async function resolveOntologyVersions(
  client: SupabaseClient,
  snapshots: readonly ArchiveRow[],
  domains: readonly ArchiveRow[]
): Promise<string[]> {
  const referencedIds = distinctStrings(domains.map((row) => row.ontology_version_id));
  const rows = await loadByIds(
    client,
    "ontology_versions",
    "ontology_versions",
    "id, version",
    referencedIds
  );
  return distinctStrings([
    ...snapshots.map((row) => row.ontology_version),
    ...rows.map((row) => row.version),
  ]);
}
