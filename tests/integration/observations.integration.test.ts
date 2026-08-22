import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createMarker,
  createObservation,
  getMarker,
  listMarkers,
  listObservations,
  recordMarkerValue,
  updateMarker,
} from "@/lib/service/observations";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Observations and BehavioralMarkers (ticket 40)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let otherClientId: string;
  let correctionId: string;
  let otherCorrectionId: string;
  let coreNodeId: string;
  let themeId: string;
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

  async function grantConsent(client: SupabaseClient, targetClientId: string, type: string) {
    const { error } = await client.rpc("grant_consent", {
      p_org_id: orgId,
      p_client_id: targetClientId,
      p_consent_type: type,
      p_scope: "client",
      p_document_version: "1.0",
    });
    if (error) throw new Error(`grant_consent ${type}: ${error.message}`);
  }

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Observations Org ${crypto.randomUUID()}`,
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

    const { data: otherClientData, error: otherClientError } = await specialist.client.rpc(
      "create_client",
      {
        p_organization_id: orgId,
        p_display_name: `Other client ${crypto.randomUUID()}`,
      }
    );
    if (otherClientError) throw new Error(otherClientError.message);
    otherClientId = otherClientData;

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

    const { data: theme, error: themeError } = await specialist.client
      .from("themes")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        name: "Test theme",
        status: "active",
      })
      .select("id")
      .single();
    if (themeError) throw new Error(themeError.message);
    themeId = theme!.id;

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

    // A correction owned by this client, plus one owned by the other client,
    // both inserted via the service role to bypass the AI pipeline.
    const { data: correction, error: correctionError } = await admin
      .from("corrections")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Test correction",
        status: "planned",
      })
      .select("id")
      .single();
    if (correctionError) throw new Error(correctionError.message);
    correctionId = correction!.id;

    const { data: otherCorrection, error: otherCorrectionError } = await admin
      .from("corrections")
      .insert({
        organization_id: orgId,
        client_id: otherClientId,
        title: "Other client correction",
        status: "planned",
      })
      .select("id")
      .single();
    if (otherCorrectionError) throw new Error(otherCorrectionError.message);
    otherCorrectionId = otherCorrection!.id;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("creates an observation storing source, valence, intensity and confidence", async () => {
    const observation = await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      sourceType: "specialist_observation",
      description: "Клиент спокойнее говорит о работе",
      lifeAreas: ["работа"],
      valence: "positive",
      intensity: 6,
      supportsImprovement: true,
      confidence: 70,
    });

    expect(observation.client_id).toBe(clientId);
    expect(observation.source_type).toBe("specialist_observation");
    expect(observation.valence).toBe("positive");
    expect(observation.intensity).toBe(6);
    expect(observation.confidence).toBe(70);
    expect(observation.supports_improvement).toBe(true);
    expect(observation.visibility).toBe("private");
    expect(observation.correction_id).toBeNull();
  });

  it("links an observation to a correction of the same client", async () => {
    const observation = await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      correctionId,
      sourceType: "measurement",
      description: "Замер после коррекции",
      valence: "neutral",
      intensity: 4,
      confidence: 80,
    });
    expect(observation.correction_id).toBe(correctionId);
  });

  it("rejects an observation linked to another client's correction", async () => {
    await expect(
      createObservation(specialist.client, {
        organizationId: orgId,
        clientId,
        correctionId: otherCorrectionId,
        sourceType: "measurement",
        description: "Чужая коррекция",
        valence: "neutral",
        intensity: 4,
        confidence: 80,
      })
    ).rejects.toThrow(/Invalid correction reference/i);
  });

  it("requires client_portal consent for client-visible observations", async () => {
    await expect(
      createObservation(specialist.client, {
        organizationId: orgId,
        clientId,
        sourceType: "client_report",
        description: "Видно клиенту",
        valence: "positive",
        intensity: 3,
        confidence: 60,
        visibility: "client_visible",
      })
    ).rejects.toThrow(/consent/i);

    await grantConsent(specialist.client, clientId, "client_portal");

    const observation = await createObservation(specialist.client, {
      organizationId: orgId,
      clientId,
      sourceType: "client_report",
      description: "Видно клиенту",
      valence: "positive",
      intensity: 3,
      confidence: 60,
      visibility: "client_visible",
    });
    expect(observation.visibility).toBe("client_visible");
  });

  it("separates client-visible and private observations via the service filter", async () => {
    const all = await listObservations(specialist.client, { organizationId: orgId, clientId });
    expect(all.items.length).toBeGreaterThanOrEqual(3);

    const visible = await listObservations(specialist.client, {
      organizationId: orgId,
      clientId,
      visibility: "client_visible",
    });
    expect(visible.items.length).toBeGreaterThan(0);
    expect(visible.items.every((o) => o.visibility === "client_visible")).toBe(true);

    const privateOnly = await listObservations(specialist.client, {
      organizationId: orgId,
      clientId,
      visibility: "private",
    });
    expect(privateOnly.items.every((o) => o.visibility === "private")).toBe(true);
  });

  it("creates a marker with baseline and one link of each allowed type", async () => {
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name: "Уверенность в разговоре с начальником",
      markerType: "scale",
      scaleMin: 0,
      scaleMax: 10,
      baselineValue: 3,
      linkedCoreNodeId: coreNodeId,
      linkedThemeId: themeId,
      linkedResourceId: resourceId,
    });

    expect(marker.baseline_value).toBe(3);
    expect(marker.current_value).toBeNull();
    expect(marker.trend).toBe("unknown");
    expect(marker.linked_core_node_id).toBe(coreNodeId);
    expect(marker.linked_theme_id).toBe(themeId);
    expect(marker.linked_resource_id).toBe(resourceId);
    expect(marker.entries).toHaveLength(1);
    expect(marker.entries[0].value).toBe(3);
    expect(marker.entries[0].note).toBe("baseline");
  });

  it("rejects links to entities of another client or organization", async () => {
    const { data: foreignNode, error } = await admin
      .from("core_nodes")
      .insert({
        organization_id: orgId,
        client_id: otherClientId,
        title: "Foreign node",
        status: "active",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await expect(
      createMarker(specialist.client, {
        organizationId: orgId,
        clientId,
        name: "Bad link marker",
        markerType: "scale",
        baselineValue: 1,
        linkedCoreNodeId: foreignNode!.id,
      })
    ).rejects.toThrow(/Invalid link/i);

    await expect(
      createMarker(specialist.client, {
        organizationId: orgId,
        clientId,
        name: "Missing link marker",
        markerType: "scale",
        baselineValue: 1,
        linkedThemeId: "a0000000-0000-4000-8000-999999999999",
      })
    ).rejects.toThrow(/Invalid link/i);
  });

  it("records values into history, recomputes trend and never overwrites baseline", async () => {
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name: "Конфликты в неделю",
      markerType: "frequency",
      scaleMin: 0,
      scaleMax: 10,
      baselineValue: 5,
    });

    const worsened = await recordMarkerValue(specialist.client, {
      markerId: marker.id,
      value: 8,
      note: "Тяжёлая неделя",
    });
    expect(worsened.current_value).toBe(8);
    expect(worsened.baseline_value).toBe(5);
    expect(worsened.trend).toBe("improving"); // higher-is-better semantics
    expect(worsened.entries).toHaveLength(2);

    const stable = await recordMarkerValue(specialist.client, {
      markerId: marker.id,
      value: 5.2,
    });
    expect(stable.trend).toBe("stable");
    expect(stable.baseline_value).toBe(5);

    const improved = await recordMarkerValue(specialist.client, {
      markerId: marker.id,
      value: 2,
    });
    expect(improved.trend).toBe("worsening");
    expect(improved.baseline_value).toBe(5);

    const detail = await getMarker(specialist.client, marker.id);
    expect(detail.entries).toHaveLength(4);
    expect(detail.entries.map((e) => e.value)).toEqual([5, 8, 5.2, 2]);
    expect(detail.baseline_value).toBe(5);
  });

  it("rejects marker values outside the scale", async () => {
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name: "Субъективное спокойствие",
      markerType: "subjective",
      scaleMin: 0,
      scaleMax: 10,
      baselineValue: 4,
    });

    await expect(
      recordMarkerValue(specialist.client, { markerId: marker.id, value: 11 })
    ).rejects.toThrow(/outside the marker scale/i);

    await expect(
      createMarker(specialist.client, {
        organizationId: orgId,
        clientId,
        name: "Out of scale baseline",
        markerType: "scale",
        scaleMin: 0,
        scaleMax: 10,
        baselineValue: 42,
      })
    ).rejects.toThrow(/outside the marker scale/i);
  });

  it("updateMarker changes metadata but cannot touch baseline or current value", async () => {
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name: "Маркер для обновления",
      markerType: "scale",
      scaleMin: 0,
      scaleMax: 10,
      baselineValue: 6,
    });

    const updated = await updateMarker(specialist.client, {
      markerId: marker.id,
      name: "Переименованный маркер",
      description: "Описание",
      linkedResourceId: resourceId,
    });
    expect(updated.name).toBe("Переименованный маркер");
    expect(updated.linked_resource_id).toBe(resourceId);
    expect(updated.baseline_value).toBe(6);

    await expect(
      updateMarker(specialist.client, {
        markerId: marker.id,
        baselineValue: 1,
      } as never)
    ).rejects.toThrow(/validation/i);
  });

  it("rejects invalid evidence links on update", async () => {
    const marker = await createMarker(specialist.client, {
      organizationId: orgId,
      clientId,
      name: "Маркер без ссылок",
      markerType: "scale",
      baselineValue: 1,
    });

    await expect(
      updateMarker(specialist.client, {
        markerId: marker.id,
        linkedCoreNodeId: "a0000000-0000-4000-8000-999999999999",
      })
    ).rejects.toThrow(/Invalid link/i);
  });

  it("RLS: another organization cannot read or write observations and markers", async () => {
    const outsider = await createUser(`outsider-${crypto.randomUUID()}@example.com`);
    const { error: orgError } = await outsider.client.rpc("create_organization", {
      org_name: `Other Org ${crypto.randomUUID()}`,
    });
    if (orgError) throw new Error(orgError.message);

    const observations = await listObservations(outsider.client, {
      organizationId: orgId,
      clientId,
    });
    expect(observations.items).toHaveLength(0);

    const markers = await listMarkers(outsider.client, { organizationId: orgId, clientId });
    expect(markers.items).toHaveLength(0);

    await expect(
      createObservation(outsider.client, {
        organizationId: orgId,
        clientId,
        sourceType: "specialist_observation",
        description: "Чужая запись",
        valence: "neutral",
        intensity: 5,
        confidence: 50,
      })
    ).rejects.toThrow(/permission|consent/i);
  });
});
