import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveCorrection,
  createCorrectionFromRecommendation,
  getCorrection,
  listCorrections,
  updateCorrection,
} from "@/lib/service/corrections";
import { createOrgMethod } from "@/lib/service/interventions";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Correction planning (ticket 39)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let recommendationId: string;
  let methodId: string;
  let methodWithContraindicationsId: string;
  let coreNodeId: string;
  let resourceId: string;
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

  async function grantConsent(client: SupabaseClient, clientId: string, type: string) {
    const { error } = await client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: clientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Corrections Org ${crypto.randomUUID()}`,
    });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: clientData, error: clientError } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: `Client ${crypto.randomUUID()}`,
    });
    if (clientError) throw new Error(clientError.message);
    clientId = clientData;

    await grantConsent(specialist.client, clientId, "data_storage");
    await grantConsent(specialist.client, clientId, "sensitive_psychological_data");

    const { data: coreNode, error: coreNodeError } = await specialist.client
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Test core node",
        status: "active",
      })
      .select("id")
      .single();
    if (coreNodeError) throw new Error(coreNodeError.message);
    coreNodeId = coreNode!.id;

    const { data: resource, error: resourceError } = await specialist.client
      .from("resources")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: "Test resource",
        status: "active",
      })
      .select("id")
      .single();
    if (resourceError) throw new Error(resourceError.message);
    resourceId = resource!.id;

    const method = await createOrgMethod(specialist.client, {
      organizationId: orgId,
      name: `Safe Method ${crypto.randomUUID()}`,
      description: "Безопасный метод",
      contraindications: [],
      defaultFollowUpDays: 7,
    });
    methodId = method.id;

    const methodWithContraindications = await createOrgMethod(specialist.client, {
      organizationId: orgId,
      name: `Risky Method ${crypto.randomUUID()}`,
      description: "Метод с противопоказаниями",
      contraindications: ["острый кризис"],
      defaultFollowUpDays: 14,
    });
    methodWithContraindicationsId = methodWithContraindications.id;

    // Create an approved recommendation directly via service role to bypass AI.
    const { data: rec, error: recError } = await admin
      .from("recommendations")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        proposed_correction: "Укрепить внутреннюю опору",
        rationale: "Ресурсная работа над опорой",
        final_priority_score: 72.5,
        status: "approved",
        human_review_required: false,
        visibility: "internal",
        created_by: specialist.id,
      })
      .select("id")
      .single();
    if (recError) throw new Error(recError.message);
    recommendationId = rec!.id;

    await admin.from("recommendation_targets").insert([
      {
        recommendation_id: recommendationId,
        target_type: "core_node",
        target_id: coreNodeId,
        role: "primary",
        expected_effect: "Снижение активации",
      },
      {
        recommendation_id: recommendationId,
        target_type: "resource",
        target_id: resourceId,
        role: "resource",
        expected_effect: "Укрепление ресурса",
      },
    ]);
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates a correction from an approved recommendation with multiple targets", async () => {
    const correction = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      interventionMethodId: methodId,
      title: "Работа с опорой",
      targets: [
        {
          targetType: "core_node",
          targetId: coreNodeId,
          role: "primary",
          expectedEffect: "Снижение активации",
        },
        {
          targetType: "resource",
          targetId: resourceId,
          role: "context",
          expectedEffect: "Укрепление ресурса",
        },
      ],
      expectedMarkers: [
        {
          marker: "Спокойствие",
          expectedDirection: "increase",
          measurementType: "subjective",
        },
      ],
    });

    expect(correction.client_id).toBe(clientId);
    expect(correction.status).toBe("planned");
    expect(correction.priority_score_before).toBe(72.5);
    expect(correction.targets).toHaveLength(2);
    expect(correction.targets.some((t) => t.role === "primary")).toBe(true);
    expect(correction.targets.some((t) => t.role === "context")).toBe(true);
    expect(correction.expected_markers).toHaveLength(1);
  });

  it("lists corrections for the client", async () => {
    const page = await listCorrections(specialist.client, {
      organizationId: orgId,
      clientId,
    });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((c) => c.client_id === clientId)).toBe(true);
  });

  it("reads a correction with targets and expected markers", async () => {
    const created = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      title: "Читаемая correction",
      targets: [{ targetType: "core_node", targetId: coreNodeId, role: "primary" }],
      expectedMarkers: [
        { marker: "Устойчивость", expectedDirection: "increase", measurementType: "scale" },
      ],
    });

    const read = await getCorrection(specialist.client, created.id);
    expect(read.id).toBe(created.id);
    expect(read.targets).toHaveLength(1);
    expect(read.expected_markers).toHaveLength(1);
  });

  it("blocks creation when required consent is missing", async () => {
    const otherClient = await createUser(`other-client-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: otherClient.id,
      role: "specialist",
      status: "active",
    });
    const { data: otherClientId, error: createError } = await otherClient.client.rpc(
      "create_client",
      {
        p_organization_id: orgId,
        p_display_name: `Other ${crypto.randomUUID()}`,
      }
    );
    if (createError) throw new Error(createError.message);

    const { data: otherRec } = await admin
      .from("recommendations")
      .insert({
        organization_id: orgId,
        client_id: otherClientId,
        proposed_correction: "test",
        status: "approved",
        visibility: "internal",
        created_by: otherClient.id,
      })
      .select("id")
      .single();

    await expect(
      createCorrectionFromRecommendation(otherClient.client, {
        organizationId: orgId,
        clientId: otherClientId,
        recommendationId: otherRec!.id,
        title: "test",
        targets: [
          {
            targetType: "core_node",
            targetId: coreNodeId,
            role: "primary",
          },
        ],
        expectedMarkers: [
          { marker: "m", expectedDirection: "increase", measurementType: "subjective" },
        ],
      })
    ).rejects.toThrow(/consent/i);
  });

  it("blocks creation with a method that has unacknowledged contraindications", async () => {
    await expect(
      createCorrectionFromRecommendation(specialist.client, {
        organizationId: orgId,
        clientId,
        recommendationId,
        interventionMethodId: methodWithContraindicationsId,
        title: "Risky correction",
        targets: [
          {
            targetType: "core_node",
            targetId: coreNodeId,
            role: "primary",
          },
        ],
        expectedMarkers: [
          { marker: "m", expectedDirection: "increase", measurementType: "subjective" },
        ],
      })
    ).rejects.toThrow(/contraindications/i);
  });

  it("allows creation when contraindications are acknowledged", async () => {
    const correction = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      interventionMethodId: methodWithContraindicationsId,
      contraindicationsAcknowledged: true,
      title: "Risky correction acknowledged",
      targets: [
        {
          targetType: "core_node",
          targetId: coreNodeId,
          role: "primary",
        },
      ],
      expectedMarkers: [
        { marker: "m", expectedDirection: "increase", measurementType: "subjective" },
      ],
    });
    expect(correction.contraindications_acknowledged).toBe(true);
  });

  it("rejects invalid target references", async () => {
    await expect(
      createCorrectionFromRecommendation(specialist.client, {
        organizationId: orgId,
        clientId,
        recommendationId,
        title: "Bad target",
        targets: [
          {
            targetType: "core_node",
            targetId: "a0000000-0000-4000-8000-999999999999",
            role: "primary",
          },
        ],
        expectedMarkers: [
          { marker: "m", expectedDirection: "increase", measurementType: "subjective" },
        ],
      })
    ).rejects.toThrow(/Invalid target/i);
  });

  it("blocks completing a correction without expected markers", async () => {
    const correction = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      title: "No markers",
      targets: [
        {
          targetType: "core_node",
          targetId: coreNodeId,
          role: "primary",
        },
      ],
      expectedMarkers: [
        { marker: "temporary", expectedDirection: "increase", measurementType: "subjective" },
      ],
    });

    await admin.from("correction_expected_markers").delete().eq("correction_id", correction.id);

    await expect(
      updateCorrection(specialist.client, {
        correctionId: correction.id,
        status: "completed",
      })
    ).rejects.toThrow(/Expected markers/i);
  });

  it("completes a correction that has expected markers", async () => {
    const correction = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      title: "Completable correction",
      targets: [
        {
          targetType: "core_node",
          targetId: coreNodeId,
          role: "primary",
        },
      ],
      expectedMarkers: [
        { marker: "m", expectedDirection: "increase", measurementType: "subjective" },
      ],
    });

    const updated = await updateCorrection(specialist.client, {
      correctionId: correction.id,
      status: "completed",
    });
    expect(updated.status).toBe("completed");
  });

  it("archives a correction", async () => {
    const correction = await createCorrectionFromRecommendation(specialist.client, {
      organizationId: orgId,
      clientId,
      recommendationId,
      title: "Archive me",
      targets: [
        {
          targetType: "core_node",
          targetId: coreNodeId,
          role: "primary",
        },
      ],
      expectedMarkers: [
        { marker: "m", expectedDirection: "increase", measurementType: "subjective" },
      ],
    });

    await archiveCorrection(specialist.client, correction.id);
    const archived = await getCorrection(specialist.client, correction.id);
    expect(archived.archived_at).not.toBeNull();
  });
});
