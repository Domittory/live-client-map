import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFeedbackForm,
  formatFeedbackAnswers,
  listFeedbackForms,
  listPortalFeedbackForms,
  sendFeedbackForm,
  submitFeedbackForm,
  submitPortalFeedbackForm,
} from "@/lib/service/feedback-forms";
import { createPortalUser, revokePortalUser } from "@/lib/service/client-portal";
import { grantClientConsent, revokeClientConsent } from "@/lib/service/consent";

try {
  process.loadEnvFile(".env.local");
} catch {
  // no .env.local — the suite will skip
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const available = Boolean(url && anonKey && serviceKey);

describe.skipIf(!available)("Client feedback forms (ticket 52)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
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

  beforeAll(async () => {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", { org_name: "Feedback Org" });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Feedback Client",
    });
    clientId = cid;
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("submission produces a pending signal, not a confirmed model change", async () => {
    const formId = await createFeedbackForm(specialist.client, {
      organizationId: orgId,
      clientId,
      title: "Обратная связь",
      questions: [
        { key: "wellbeing", label: "Как вы себя чувствуете?", type: "text", required: true },
      ],
    });

    await sendFeedbackForm(specialist.client, { formId });

    const signalId = await submitFeedbackForm(specialist.client, {
      formId,
      answers: { wellbeing: "нормально" },
    });

    const { data: signal } = await specialist.client
      .from("signals")
      .select("source_type, epistemic_type, review_status")
      .eq("id", signalId)
      .maybeSingle();
    expect(signal?.source_type).toBe("follow_up");
    expect(signal?.epistemic_type).toBe("self_report");
    expect(signal?.review_status).toBe("pending");
  });

  it("rejects resubmission of a completed form", async () => {
    const formId = await createFeedbackForm(specialist.client, {
      organizationId: orgId,
      clientId,
      title: "Повтор",
      questions: [{ key: "q", label: "Вопрос", type: "text", required: false }],
    });
    await sendFeedbackForm(specialist.client, { formId });
    await submitFeedbackForm(specialist.client, { formId, answers: { q: "a" } });

    await expect(
      submitFeedbackForm(specialist.client, { formId, answers: { q: "b" } })
    ).rejects.toThrow();
  });

  it("rejects a submission missing a required answer", async () => {
    const formId = await createFeedbackForm(specialist.client, {
      organizationId: orgId,
      clientId,
      title: "Обязательный",
      questions: [{ key: "q", label: "Вопрос", type: "text", required: true }],
    });
    await sendFeedbackForm(specialist.client, { formId });

    await expect(submitFeedbackForm(specialist.client, { formId, answers: {} })).rejects.toThrow();
  });
});

/**
 * Portal feedback flow (ticket 16).
 *
 * The portal identity is built exactly like production builds it: the
 * specialist grants `client_portal` consent, `create_portal_user` maps the
 * identity, and the client proves the emailed single-use `token_hash` with
 * `verifyOtp`. Every assertion below therefore runs with the client's own
 * credential — an RLS bypass via the service role would prove nothing.
 */
describe.skipIf(!available)("Client portal feedback (ticket 16)", () => {
  const admin = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const createdUserIds: string[] = [];
  let orgId: string;
  let clientId: string;
  let otherClientId: string;
  let specialist: { id: string; client: SupabaseClient };

  /** One identity per test so a revocation never leaks into the next case. */
  async function createPortalSessionForEmail(
    targetClientId: string,
    email: string
  ): Promise<SupabaseClient> {
    await createPortalUser(specialist.client, { clientId: targetClientId, email });

    const { data: user, error } = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
    });
    if (error) throw new Error(error.message);
    createdUserIds.push(user.user!.id);

    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError) throw new Error(linkError.message);

    const client = createClient(url!, anonKey!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: verifyError } = await client.auth.verifyOtp({
      type: "magiclink",
      token_hash: link.properties.hashed_token,
    });
    if (verifyError) throw new Error(verifyError.message);

    return client;
  }

  async function createPortalSession(
    targetClientId: string,
    prefix: string
  ): Promise<{ email: string; id: string; client: SupabaseClient }> {
    const email = `${prefix}-${crypto.randomUUID()}@example.com`;
    const client = await createPortalSessionForEmail(targetClientId, email);
    const {
      data: { user },
    } = await client.auth.getUser();
    return { email, id: user!.id, client };
  }

  /** The `client_portal_users` row id of one identity (for revocation). */
  async function portalUserIdFor(targetClientId: string, email: string): Promise<string> {
    const { data } = await admin
      .from("client_portal_users")
      .select("id")
      .eq("client_id", targetClientId)
      .eq("email", email)
      .single();
    return data!.id as string;
  }

  async function openForm(targetClientId: string, title: string, required = true): Promise<string> {
    const formId = await createFeedbackForm(specialist.client, {
      organizationId: orgId,
      clientId: targetClientId,
      title,
      questions: [{ key: "q1", label: "Как вы себя чувствуете?", type: "text", required }],
    });
    await sendFeedbackForm(specialist.client, { formId });
    return formId;
  }

  async function seedScenario(): Promise<void> {
    const owner = await createUser(`owner-${crypto.randomUUID()}@example.com`);
    const { data } = await owner.client.rpc("create_organization", {
      org_name: `Portal feedback ${crypto.randomUUID().slice(0, 8)}`,
    });
    orgId = data;

    specialist = await createUser(`spec-${crypto.randomUUID()}@example.com`);
    await admin.from("organization_members").insert({
      organization_id: orgId,
      user_id: specialist.id,
      role: "specialist",
      status: "active",
    });

    const { data: cid } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Portal feedback client",
    });
    clientId = cid;
    const { data: other } = await specialist.client.rpc("create_client", {
      p_organization_id: orgId,
      p_display_name: "Другой клиент",
    });
    otherClientId = other;

    for (const target of [clientId, otherClientId]) {
      await grantClientConsent(specialist.client, {
        organizationId: orgId,
        clientId: target,
        consentType: "client_portal",
        documentVersion: "1.0",
      });
    }
  }

  beforeAll(async () => {
    await seedScenario();
  });

  afterAll(async () => {
    for (const id of createdUserIds) {
      await admin.auth.admin.deleteUser(id);
    }
  });

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

  it("lists only the caller's active, unexpired sent forms", async () => {
    const portal = await createPortalSession(clientId, "portal-list");
    const mine = await openForm(clientId, "Форма клиента");
    await openForm(otherClientId, "Форма другого клиента");
    const expired = await openForm(clientId, "Истёкшая форма");

    // A draft and an expired form must never reach the portal.
    const draft = await createFeedbackForm(specialist.client, {
      organizationId: orgId,
      clientId,
      title: "Черновик",
      questions: [{ key: "q1", label: "Вопрос", type: "text", required: false }],
    });
    await admin
      .from("client_feedback_forms")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", expired);

    const forms = await listPortalFeedbackForms(portal.client);
    const ids = forms.map((form) => form.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(expired);
    expect(ids).not.toContain(draft);

    // The payload carries the questions, never the tenant or staff columns.
    const form = forms.find((entry) => entry.id === mine)!;
    expect(form.title).toBe("Форма клиента");
    expect(form.questions).toHaveLength(1);
    expect(form.questions[0].label).toBe("Как вы себя чувствуете?");
    expect(Object.keys(form)).toEqual(["id", "title", "questions", "expiresAt"]);

    // The other client's form exists — the non-vacuous check.
    const { count } = await admin
      .from("client_feedback_forms")
      .select("id", { count: "exact", head: true })
      .eq("client_id", otherClientId)
      .eq("status", "sent");
    expect(count).toBeGreaterThan(0);
  });

  it("completes the form, writes the pending self-report signal and audits, atomically", async () => {
    const portal = await createPortalSession(clientId, "portal-submit");
    const formId = await openForm(clientId, "Форма для заполнения");

    const signalId = await submitPortalFeedbackForm(portal.client, {
      formId,
      answers: { q1: "Мне стало спокойнее" },
    });

    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("status, answers, completed_at")
      .eq("id", formId)
      .single();
    expect(form?.status).toBe("completed");
    expect(form?.completed_at).not.toBeNull();
    expect(form?.answers).toEqual({ q1: "Мне стало спокойнее" });

    const { data: signal } = await admin
      .from("signals")
      .select(
        "source_type, epistemic_type, evidence_level, review_status, visibility, context, created_by"
      )
      .eq("id", signalId)
      .single();
    expect(signal?.source_type).toBe("follow_up");
    expect(signal?.epistemic_type).toBe("self_report");
    expect(signal?.review_status).toBe("pending");
    expect(signal?.evidence_level).toBe("L1_SINGLE_SIGNAL");
    expect(signal?.visibility).toBe("internal");
    expect(signal?.created_by).toBe(portal.id);
    expect((signal?.context as { feedback_form_id?: string })?.feedback_form_id).toBe(formId);

    // The audit row is written in the same transaction, by the portal identity.
    // Creating the form also audited (`feedback_form.create`); the submission
    // must add exactly one `feedback_form.submit` row with the portal actor.
    const { data: auditRows } = await admin
      .from("audit_log")
      .select("action, entity_type, entity_id, actor_user_id, after_data")
      .eq("entity_type", "client_feedback_form")
      .eq("entity_id", formId);
    expect((auditRows ?? []).map((row) => row.action).sort()).toEqual([
      "feedback_form.create",
      "feedback_form.submit",
    ]);

    const submitRow = auditRows!.find((row) => row.action === "feedback_form.submit")!;
    expect(submitRow.actor_user_id).toBe(portal.id);
    expect((submitRow.after_data as { signal_id?: string })?.signal_id).toBe(signalId);
  });

  it("never raises an authoritative confidence or confirms a hypothesis", async () => {
    const portal = await createPortalSession(clientId, "portal-evidence");

    const { data: hypothesis, error: hypothesisError } = await admin
      .from("differential_hypotheses")
      .insert({
        organization_id: orgId,
        client_id: clientId,
        title: "Гипотеза до обратной связи",
        status: "hypothesis",
        confidence_score: 40,
      })
      .select("id, status, confidence_score")
      .single();
    if (hypothesisError) throw new Error(hypothesisError.message);

    const formId = await openForm(clientId, "Форма про уверенность");
    const signalId = await submitPortalFeedbackForm(portal.client, {
      formId,
      answers: { q1: "Мне кажется, стало лучше" },
    });

    const { data: afterHypothesis } = await admin
      .from("differential_hypotheses")
      .select("status, confidence_score")
      .eq("id", hypothesis!.id)
      .single();
    expect(afterHypothesis?.status).toBe("hypothesis");
    expect(afterHypothesis?.confidence_score).toBe(40);

    const { data: signal } = await admin
      .from("signals")
      .select("evidence_level, review_status")
      .eq("id", signalId)
      .single();
    expect(signal?.evidence_level).toBe("L1_SINGLE_SIGNAL");
    expect(signal?.review_status).toBe("pending");

    // Submission links the signal to nothing: no theme/core-node connection and
    // no evidence cluster may be created as a side effect.
    const { data: links } = await admin
      .from("theme_signal_links")
      .select("id")
      .eq("signal_id", signalId);
    expect(links ?? []).toHaveLength(0);
  });

  it("denies a second submission of the same form", async () => {
    const portal = await createPortalSession(clientId, "portal-reuse");
    const formId = await openForm(clientId, "Форма без повтора");

    await submitPortalFeedbackForm(portal.client, { formId, answers: { q1: "первый" } });

    await expect(
      submitPortalFeedbackForm(portal.client, { formId, answers: { q1: "второй" } })
    ).rejects.toThrow();

    // The completed form also disappears from the portal list.
    const forms = await listPortalFeedbackForms(portal.client);
    expect(forms.map((form) => form.id)).not.toContain(formId);

    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("answers")
      .eq("id", formId)
      .single();
    expect(form?.answers).toEqual({ q1: "первый" });
  });

  it("denies an expired form in the list and on submission", async () => {
    const portal = await createPortalSession(clientId, "portal-expired");
    const formId = await openForm(clientId, "Просроченная форма");
    await admin
      .from("client_feedback_forms")
      .update({ expires_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", formId);

    const forms = await listPortalFeedbackForms(portal.client);
    expect(forms.map((form) => form.id)).not.toContain(formId);

    await expect(
      submitPortalFeedbackForm(portal.client, { formId, answers: { q1: "поздно" } })
    ).rejects.toThrow();

    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("status")
      .eq("id", formId)
      .single();
    expect(form?.status).toBe("sent");
  });

  it("denies a cross-client form: another client's identity can neither list nor submit it", async () => {
    const portalB = await createPortalSession(otherClientId, "portal-cross");
    const foreignFormId = await openForm(clientId, "Чужая форма");

    const forms = await listPortalFeedbackForms(portalB.client);
    expect(forms.map((form) => form.id)).not.toContain(foreignFormId);

    await expect(
      submitPortalFeedbackForm(portalB.client, { formId: foreignFormId, answers: { q1: "чужое" } })
    ).rejects.toThrow();

    // Nothing was written for the foreign form.
    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("status")
      .eq("id", foreignFormId)
      .single();
    expect(form?.status).toBe("sent");

    const { data: signals } = await admin
      .from("signals")
      .select("id")
      .eq("client_id", clientId)
      .eq("source_type", "follow_up")
      .contains("context", { feedback_form_id: foreignFormId });
    expect(signals ?? []).toHaveLength(0);
  });

  it("stops the next submission and listing the moment the client_portal consent is revoked", async () => {
    const portal = await createPortalSession(clientId, "portal-consent");
    const formId = await openForm(clientId, "Форма до отзыва согласия");
    expect(await listPortalFeedbackForms(portal.client)).not.toHaveLength(0);

    await revokeClientConsent(specialist.client, {
      organizationId: orgId,
      clientId,
      consentType: "client_portal",
    });

    // Same session, same cookies: both the list and the submission are denied.
    expect(await listPortalFeedbackForms(portal.client)).toEqual([]);
    await expect(
      submitPortalFeedbackForm(portal.client, { formId, answers: { q1: "после отзыва" } })
    ).rejects.toThrow();

    const { data: form } = await admin
      .from("client_feedback_forms")
      .select("status")
      .eq("id", formId)
      .single();
    expect(form?.status).toBe("sent");

    // Restore consent so the tenant is left in a consistent state.
    await grantClientConsent(specialist.client, {
      organizationId: orgId,
      clientId,
      consentType: "client_portal",
      documentVersion: "1.0",
    });
    expect((await listPortalFeedbackForms(portal.client)).map((form) => form.id)).toContain(formId);
  });

  it("stops listing and submitting after the portal identity itself is revoked", async () => {
    const email = `portal-revoked-${crypto.randomUUID()}@example.com`;
    const session = await createPortalSessionForEmail(clientId, email);
    const portalUserId = await portalUserIdFor(clientId, email);
    const formId = await openForm(clientId, "Форма до отзыва портала");
    expect((await listPortalFeedbackForms(session)).map((form) => form.id)).toContain(formId);

    await revokePortalUser(specialist.client, portalUserId);

    expect(await listPortalFeedbackForms(session)).toEqual([]);
    await expect(
      submitPortalFeedbackForm(session, { formId, answers: { q1: "после отзыва" } })
    ).rejects.toThrow();
  });

  it("shapes the specialist list and answer view without portal rows leaking", async () => {
    const formId = await openForm(clientId, "Форма для специалиста");
    const portal = await createPortalSession(clientId, "portal-specialist-view");
    await submitPortalFeedbackForm(portal.client, { formId, answers: { q1: "ответ клиента" } });

    const rows = await listFeedbackForms(specialist.client, { organizationId: orgId, clientId });
    const row = rows.find((entry) => entry.id === formId)!;
    expect(row.status).toBe("completed");
    expect(row.answeredCount).toBe(1);
    expect(row.completedAt).not.toBeNull();
    expect(formatFeedbackAnswers(row.questions, row.answers)).toEqual([
      "Как вы себя чувствуете?: ответ клиента",
    ]);
  });
});
