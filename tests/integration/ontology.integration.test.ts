import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Integration tests run against a local Supabase (ticket 01: Supabase CLI + Docker).
// They skip when the environment is not configured, so `pnpm test` stays green
// on a clean checkout without Docker. `.env.local` (created after `supabase start`)
// is loaded when present, so `pnpm test:integration` works without inline env.
try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the test will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const available = Boolean(url && serviceKey && anonKey);

const SYSTEM_DOMAIN_COUNT = 24;

async function createTenant(
  admin: SupabaseClient,
  label: string
): Promise<{ userId: string; orgId: string; email: string; password: string }> {
  const email = `lib-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `test-${Math.random().toString(36).slice(2)}`;

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(userError).toBeNull();
  const userId = userData.user!.id;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: `Org ${label}`, slug: `org-${label}-${Date.now()}`, owner_user_id: userId })
    .select("id")
    .single();
  expect(orgError).toBeNull();

  const { error: memberError } = await admin.from("organization_members").insert({
    organization_id: org!.id,
    user_id: userId,
    role: "owner",
    status: "active",
  });
  expect(memberError).toBeNull();

  return { userId, orgId: org!.id, email, password };
}

async function signIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url!, anonKey!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return client;
}

describe.skipIf(!available)("ontology & diagnostic library (requires local Supabase)", () => {
  it("seeds system domains pinned to an explicit active ontology version", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: versions, error: vError } = await admin
      .from("ontology_versions")
      .select("*")
      .eq("version", "1.0.0")
      .eq("status", "active");
    expect(vError).toBeNull();
    expect(versions).toHaveLength(1);
    expect(versions![0].relation_types).toContain("causes_confirmed");
    expect(versions![0].domain_types).toContain("separation");

    const { data: domains, error: dError } = await admin
      .from("diagnostic_domains")
      .select("slug, is_system, ontology_version_id")
      .is("organization_id", null);
    expect(dError).toBeNull();
    expect(domains).toHaveLength(SYSTEM_DOMAIN_COUNT);
    for (const domain of domains!) {
      expect(domain.is_system).toBe(true);
      expect(domain.ontology_version_id).toBe(versions![0].id);
    }
  });

  it("enforces tenant isolation and keeps system records immutable for orgs", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const tenantA = await createTenant(admin, "a");
    const tenantB = await createTenant(admin, "b");
    const clientA = await signIn(tenantA.email, tenantA.password);
    const clientB = await signIn(tenantB.email, tenantB.password);

    const { data: version } = await admin
      .from("ontology_versions")
      .select("id")
      .eq("version", "1.0.0")
      .single();

    // Org A extends the library with its own domain.
    const orgASlug = `org-a-domain-${Math.random().toString(36).slice(2, 8)}`;
    const { error: insertError } = await clientA.from("diagnostic_domains").insert({
      organization_id: tenantA.orgId,
      ontology_version_id: version!.id,
      slug: orgASlug,
      name: "Домен организации A",
      is_system: false,
    });
    expect(insertError).toBeNull();

    // Tenant isolation: B sees system records but not A's org record.
    const { data: visibleToB } = await clientB.from("diagnostic_domains").select("slug");
    const slugsB = (visibleToB ?? []).map((d) => d.slug);
    expect(slugsB).toContain("separation");
    expect(slugsB).not.toContain(orgASlug);

    // System records cannot be modified by an org member.
    const { data: updated } = await clientA
      .from("diagnostic_domains")
      .update({ name: "Переписано" })
      .eq("slug", "separation")
      .select("id");
    expect(updated).toEqual([]);
    const { data: systemDomain } = await admin
      .from("diagnostic_domains")
      .select("name")
      .eq("slug", "separation")
      .single();
    expect(systemDomain!.name).toBe("Сепарация");

    // Org members cannot create system records.
    const { error: systemInsertError } = await clientA.from("diagnostic_domains").insert({
      organization_id: null,
      ontology_version_id: version!.id,
      slug: "fake-system",
      name: "Поддельный системный домен",
      is_system: true,
    });
    expect(systemInsertError).not.toBeNull();

    // An org template cannot attach to another org's domain (SPEC §8.35 + RLS).
    const { data: domainA } = await admin
      .from("diagnostic_domains")
      .select("id")
      .eq("slug", orgASlug)
      .single();
    const { error: crossError } = await clientB.from("belief_templates").insert({
      organization_id: tenantB.orgId,
      diagnostic_domain_id: domainA!.id,
      ontology_version_id: version!.id,
      statement: "Чужой домен",
      is_system: false,
    });
    expect(crossError).not.toBeNull();

    // But it can attach to a system domain of the shared library.
    const { data: systemTarget } = await admin
      .from("diagnostic_domains")
      .select("id")
      .eq("slug", "separation")
      .single();
    const { error: ownError } = await clientB.from("belief_templates").insert({
      organization_id: tenantB.orgId,
      diagnostic_domain_id: systemTarget!.id,
      ontology_version_id: version!.id,
      statement: "Мне безопасно отделяться",
      is_system: false,
    });
    expect(ownError).toBeNull();
  });

  it("never lets a belief template carry evidence fields (SPEC §8.35, §3.5)", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: version } = await admin
      .from("ontology_versions")
      .select("id")
      .eq("version", "1.0.0")
      .single();
    const { data: domain } = await admin
      .from("diagnostic_domains")
      .select("id")
      .eq("slug", "separation")
      .single();

    // PostgREST rejects columns that do not exist: the table has no
    // evidence_count / confidence / score columns by design.
    for (const field of ["evidence_count", "confidence_score", "contexts_count"]) {
      const { error } = await admin.from("belief_templates").insert({
        diagnostic_domain_id: domain!.id,
        ontology_version_id: version!.id,
        statement: "test",
        is_system: true,
        [field]: 10,
      });
      expect(error).not.toBeNull();
      expect(error!.code).toBe("PGRST204");
    }
  });

  it("keeps archived ontology versions readable for old snapshots", async () => {
    const admin = createClient(url!, serviceKey!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const archivedVersion = `0.9.0-test-${Math.random().toString(36).slice(2, 8)}`;
    const { error: archiveError } = await admin.from("ontology_versions").insert({
      version: archivedVersion,
      status: "archived",
      archived_at: new Date().toISOString(),
    });
    expect(archiveError).toBeNull();

    const tenant = await createTenant(admin, "reader");
    const client = await signIn(tenant.email, tenant.password);
    const { data, error } = await client
      .from("ontology_versions")
      .select("version, status")
      .eq("version", archivedVersion)
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe("archived");
  });
});
