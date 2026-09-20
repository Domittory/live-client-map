import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ARCHIVE_COLLECTIONS,
  REQUIRED_ARCHIVE_DATA_KEYS,
  assembleClientArchive,
  computeDataHash,
  validateClientArchive,
} from "@/lib/service/client-archive";
import { clientArchiveFilename } from "@/lib/service/export-names";
import { exportClientArchive } from "@/lib/service/export";
import { createRelationship } from "@/lib/service/relationships";

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
 * Ticket 18 — the full archive contract against a real database:
 * complete schema, authoritative manifest, deterministic ordering/hash,
 * relationship privacy and no silent truncation at the PostgREST page limit.
 */
describe.skipIf(!available)("Full client JSON archive (ticket 18, §11)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let owner: { id: string; client: SupabaseClient };
  let emptyClientId: string;
  let richClientId: string;
  let manyClientId: string;
  let partnerClientId: string;
  let relationshipId: string;
  let richPublicSignalId: string;
  let partnerPrivateSignalId: string;
  let richPrivateSignalId: string;
  let domainSlug = "";
  let expectedOntologyVersion = "";

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

  async function grantConsent(clientId: string, consentType: string) {
    await admin.from("consent_records").insert({
      organization_id: orgId,
      client_id: clientId,
      consent_type: consentType,
      document_version: "1.0",
    });
  }

  beforeAll(async () => {
    owner = await createUser(`archive-owner-${crypto.randomUUID()}@example.com`);
    const { data: org } = await owner.client.rpc("create_organization", {
      org_name: "Archive Org",
    });
    orgId = org;

    emptyClientId = (
      await owner.client.rpc("create_client", {
        p_organization_id: orgId,
        p_display_name: "Archive Empty",
      })
    ).data;
    richClientId = (
      await owner.client.rpc("create_client", {
        p_organization_id: orgId,
        p_display_name: "Archive Rich",
      })
    ).data;
    manyClientId = (
      await owner.client.rpc("create_client", {
        p_organization_id: orgId,
        p_display_name: "Archive Many",
      })
    ).data;
    partnerClientId = (
      await owner.client.rpc("create_client", {
        p_organization_id: orgId,
        p_display_name: "Archive Partner",
      })
    ).data;

    for (const clientId of [emptyClientId, richClientId, manyClientId, partnerClientId]) {
      await grantConsent(clientId, "data_storage");
    }

    // --- Rich client: catalog, model rows, links and explicit timestamps --------
    // Reuse an existing system DiagnosticDomain instead of writing to the shared
    // global catalog, so this suite never perturbs other suites' counts.
    const { data: systemDomain } = await admin
      .from("diagnostic_domains")
      .select("slug, ontology_version_id")
      .is("organization_id", null)
      .order("slug", { ascending: true })
      .limit(1)
      .maybeSingle();
    const { data: systemOntology } = await admin
      .from("ontology_versions")
      .select("version")
      .eq("id", systemDomain!.ontology_version_id)
      .maybeSingle();
    domainSlug = systemDomain!.slug;
    expectedOntologyVersion = systemOntology!.version;

    const { data: method } = await admin
      .from("intervention_methods")
      .insert({ organization_id: orgId, name: `Archive method ${crypto.randomUUID()}` })
      .select("id")
      .single();

    const { data: theme } = await admin
      .from("themes")
      .insert({
        organization_id: orgId,
        client_id: richClientId,
        name: "Тема",
        review_status: "approved",
      })
      .select("id")
      .single();

    const { data: node } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: richClientId,
        title: "Ключевой узел",
        root_domain: domainSlug,
      })
      .select("id")
      .single();

    await admin.from("signal_theme_links").insert({
      signal_id: (
        await admin
          .from("signals")
          .insert({
            organization_id: orgId,
            client_id: richClientId,
            source_type: "client_report",
            epistemic_type: "self_report",
            raw_statement: "Публичный сигнал клиента",
            visibility: "client_visible",
            created_at: "2026-01-03T00:00:00Z",
          })
          .select("id")
          .single()
      ).data!.id,
      theme_id: theme!.id,
    });

    const { data: privateSignal } = await admin
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: richClientId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Приватный сигнал клиента",
        visibility: "internal",
        created_at: "2026-01-01T00:00:00Z",
      })
      .select("id")
      .single();

    await admin.from("signals").insert({
      organization_id: orgId,
      client_id: richClientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: "Средний сигнал клиента",
      visibility: "internal",
      created_at: "2026-01-02T00:00:00Z",
    });

    const { data: publicSignal } = await admin
      .from("signals")
      .select("id")
      .eq("client_id", richClientId)
      .eq("visibility", "client_visible")
      .maybeSingle();
    richPublicSignalId = publicSignal!.id;
    richPrivateSignalId = privateSignal!.id;

    await admin.from("theme_core_node_links").insert({
      theme_id: theme!.id,
      core_node_id: node!.id,
    });

    await admin.from("resources").insert({
      organization_id: orgId,
      client_id: richClientId,
      name: "Ресурс",
      domain: domainSlug,
      evidence_refs: [
        richPrivateSignalId,
        richPublicSignalId,
        "00000000-0000-0000-0000-000000000000",
      ],
    });

    // Referenced catalog revision: a correction pins the InterventionMethod.
    await admin.from("corrections").insert({
      organization_id: orgId,
      client_id: richClientId,
      intervention_method_id: method!.id,
      title: "Коррекция",
    });

    // --- Partner relationship with a private signal of the second client --------
    await grantConsent(richClientId, "relationship_analysis");
    await grantConsent(partnerClientId, "relationship_analysis");

    const { data: partnerSignal } = await admin
      .from("signals")
      .insert({
        organization_id: orgId,
        client_id: partnerClientId,
        source_type: "client_report",
        epistemic_type: "self_report",
        raw_statement: "Приватный сигнал партнёра",
        visibility: "internal",
      })
      .select("id")
      .single();
    partnerPrivateSignalId = partnerSignal!.id;

    relationshipId = await createRelationship(owner.client, {
      organizationId: orgId,
      clientAId: richClientId,
      clientBId: partnerClientId,
      relationshipType: "partner",
    });

    await admin.from("relationship_dynamics").insert({
      relationship_id: relationshipId,
      title: "Динамика",
      evidence_refs: [richPublicSignalId, partnerPrivateSignalId],
    });

    // --- Pagination: more rows than the PostgREST page size ---------------------
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      organization_id: orgId,
      client_id: manyClientId,
      source_type: "client_report",
      epistemic_type: "self_report",
      raw_statement: `Многострочный сигнал ${index}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, index % 60)).toISOString(),
    }));
    const { error: bulkError } = await admin.from("signals").insert(rows);
    if (bulkError) throw new Error(bulkError.message);

    // A link row for a client with >100 signals forces the constrained loader to
    // partition the large `in` list; the link must still be present exactly once.
    const { data: manyTheme } = await admin
      .from("themes")
      .insert({
        organization_id: orgId,
        client_id: manyClientId,
        name: "Тема многоклиента",
        review_status: "approved",
      })
      .select("id")
      .single();
    const { data: manySignal } = await admin
      .from("signals")
      .select("id")
      .eq("client_id", manyClientId)
      .order("id", { ascending: true })
      .limit(1)
      .maybeSingle();
    await admin.from("signal_theme_links").insert({
      signal_id: manySignal!.id,
      theme_id: manyTheme!.id,
    });
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("always serializes every required collection, empty when there is no data", async () => {
    const { archive } = await assembleClientArchive(owner.client, emptyClientId);

    for (const key of REQUIRED_ARCHIVE_DATA_KEYS) {
      expect(archive.data).toHaveProperty(key);
    }
    for (const collection of ARCHIVE_COLLECTIONS) {
      expect(Array.isArray(archive.data[collection])).toBe(true);
    }
    expect(archive.data.client).toBeTruthy();
    expect(typeof archive.data.reference_catalog).toBe("object");

    // A client with no model data has empty model collections (audit_events may
    // hold the client-creation event, so it is not asserted empty).
    for (const collection of [
      "signals",
      "themes",
      "core_nodes",
      "relationships",
      "relationship_dynamics",
      "medical_facts",
      "symptom_reports",
      "psychological_hypotheses",
    ] as const) {
      expect(archive.data[collection]).toEqual([]);
    }

    expect(() => validateClientArchive(archive)).not.toThrow();
  });

  it("makes counts, catalog and the canonical hash match the serialized data", async () => {
    const { archive } = await assembleClientArchive(owner.client, richClientId);

    for (const collection of ARCHIVE_COLLECTIONS) {
      expect(archive.manifest.record_counts[collection]).toBe(archive.data[collection].length);
    }
    expect(archive.manifest.record_counts.signals).toBe(3);
    expect(archive.manifest.record_counts.signal_theme_links).toBe(1);
    expect(archive.manifest.data_sha256).toBe(computeDataHash(archive.data));

    expect(archive.data.reference_catalog.diagnostic_domains.map((row) => row.slug)).toEqual([
      domainSlug,
    ]);
    expect(archive.data.reference_catalog.intervention_methods).toHaveLength(1);
    expect(archive.data.reference_catalog.belief_templates).toEqual([]);
    expect(archive.manifest.ontology_versions).toContain(expectedOntologyVersion);

    // A dangling evidence reference is removed and named, never dropped
    // silently; references to the subject client's own signals are preserved.
    const resource = archive.data.resources[0];
    expect(resource.evidence_refs).toEqual([richPrivateSignalId, richPublicSignalId]);
    expect(archive.manifest.warnings).toContainEqual({
      code: "dangling_reference",
      collection: "resources",
      field: "evidence_refs",
      count: 1,
    });
  });

  it("orders collections deterministically so the hash is reproducible", async () => {
    const first = (await assembleClientArchive(owner.client, richClientId)).archive;
    const second = (await assembleClientArchive(owner.client, richClientId)).archive;

    const createdAts = first.data.signals.map((row) => row.created_at);
    expect(createdAts).toEqual([...createdAts].sort());
    expect(second.data.signals.map((row) => row.id)).toEqual(
      first.data.signals.map((row) => row.id)
    );
    expect(second.manifest.data_sha256).toBe(first.manifest.data_sha256);
    expect(JSON.stringify(second.data)).toBe(JSON.stringify(first.data));
  });

  it("does not truncate a collection that exceeds the PostgREST page size", async () => {
    const { archive } = await assembleClientArchive(owner.client, manyClientId);
    expect(archive.manifest.record_counts.signals).toBe(1001);
    expect(archive.data.signals).toHaveLength(1001);

    // The link row survives the partitioned `in` loader exactly once.
    expect(archive.data.signal_theme_links).toHaveLength(1);
    expect(archive.manifest.record_counts.signal_theme_links).toBe(1);
  });

  it("includes relationship data only with both consents and filters the second client's private evidence", async () => {
    const withConsent = (await assembleClientArchive(owner.client, richClientId)).archive;
    expect(withConsent.data.relationships).toHaveLength(1);
    expect(withConsent.data.relationship_dynamics).toHaveLength(1);
    expect(withConsent.data.relationship_dynamics[0].evidence_refs).toEqual([richPublicSignalId]);
    expect(withConsent.manifest.warnings).toContainEqual({
      code: "private_evidence_filtered",
      collection: "relationship_dynamics",
      field: "evidence_refs",
      count: 1,
    });

    const serialized = JSON.stringify(withConsent);
    expect(serialized).not.toContain("Приватный сигнал партнёра");
    expect(serialized).not.toContain(partnerPrivateSignalId);

    // Revoking the second client's consent empties the collections and adds a
    // warning without the second client's identifier.
    await admin
      .from("consent_records")
      .update({ revoked_at: new Date().toISOString() })
      .eq("client_id", partnerClientId)
      .eq("consent_type", "relationship_analysis");

    const withoutConsent = (await assembleClientArchive(owner.client, richClientId)).archive;
    expect(withoutConsent.data.relationships).toEqual([]);
    expect(withoutConsent.data.relationship_dynamics).toEqual([]);
    expect(withoutConsent.manifest.warnings).toContainEqual({
      code: "relationship_withheld",
      collection: "relationships",
      field: null,
      count: 1,
    });
    expect(JSON.stringify(withoutConsent.manifest.warnings)).not.toContain(partnerClientId);

    // Restore consent for the remaining tests.
    await grantConsent(partnerClientId, "relationship_analysis");
  });

  it("audits the export without raw content and names no identifiers in the filename", async () => {
    const archive = await exportClientArchive(owner.client, { clientId: richClientId });

    const { data: audit } = await admin
      .from("audit_log")
      .select("after_data")
      .eq("entity_type", "client")
      .eq("entity_id", richClientId)
      .eq("action", "export.client_archive")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const auditPayload = JSON.stringify(audit?.after_data ?? {});
    expect(auditPayload).not.toContain("Публичный сигнал");
    expect(auditPayload).not.toContain("Приватный сигнал");
    expect(audit?.after_data).toMatchObject({ export_id: archive.export_id });

    const filename = clientArchiveFilename(archive.subject_client_id, archive.generated_at);
    expect(filename).not.toContain(richClientId);
    expect(filename).not.toContain(partnerClientId);
    expect(filename).not.toContain("Публичный сигнал");
    expect(filename).toMatch(/^client_archive_[0-9a-f]{16}_[0-9T-]+Z\.json$/);
  });
});
