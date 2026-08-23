import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createFeedbackForm,
  sendFeedbackForm,
  submitFeedbackForm,
} from "@/lib/service/feedback-forms";

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
