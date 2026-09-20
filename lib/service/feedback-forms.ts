import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ServiceError } from "./errors";
import { runAtomicRpc } from "./transaction";
import { uuid, validate } from "./validation";

/**
 * Client feedback forms (ticket 52, ticket 04 resolution). A specialist authors
 * and sends a form; a portal user submits only their own sent form. A
 * submission produces pending Signals (source_type=follow_up, self_report) and
 * never mutates the psychological model without specialist review.
 */

export type FeedbackStatus = "draft" | "sent" | "completed" | "expired";

/** Question types a feedback form may use (UI and database share this list). */
export const FEEDBACK_QUESTION_TYPES = ["scale_1_10", "text", "yes_no"] as const;
export type FeedbackQuestionType = (typeof FEEDBACK_QUESTION_TYPES)[number];

const questionSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(500),
    type: z.enum(FEEDBACK_QUESTION_TYPES),
    required: z.boolean().default(false),
  })
  .strict();

/** The stored, canonical question shape read back from the table. */
export const feedbackQuestionSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(FEEDBACK_QUESTION_TYPES),
  required: z.boolean().optional(),
});

export type FeedbackQuestion = z.infer<typeof feedbackQuestionSchema>;

export const createFeedbackFormSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    title: z.string().trim().min(1).max(200),
    questions: z.array(questionSchema).min(1).max(50),
    correctionId: uuid.optional(),
    followUpId: uuid.optional(),
  })
  .strict();

export const sendFeedbackFormSchema = z
  .object({
    formId: uuid,
  })
  .strict();

export const submitFeedbackFormSchema = z
  .object({
    formId: uuid,
    answers: z.record(z.string(), z.unknown()),
  })
  .strict();

export const listFeedbackFormsQuerySchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
  })
  .strict();

/** Shape returned by the `list_client_portal_feedback_forms` RPC. */
const portalFormsRowSchema = z.object({
  client_id: uuid,
  forms: z.array(
    z.object({
      id: uuid,
      title: z.string(),
      questions: z.unknown(),
      expires_at: z.string().nullable(),
    })
  ),
});

/** The fields the specialist submission path pre-reads before the RPC. */
interface FormRow {
  id: string;
  status: FeedbackStatus;
  questions: unknown[];
  expires_at: string | null;
}

/** One form as the specialist workspace reads it (RLS-scoped columns). */
export interface FeedbackFormRow {
  id: string;
  status: FeedbackStatus;
  title: string;
  questions: FeedbackQuestion[];
  answers: Record<string, unknown> | null;
  sentAt: string | null;
  completedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** How many questions the client answered (completed forms only). */
  answeredCount: number;
}

/** One form as the portal identity reads it; no tenant or staff columns. */
export interface PortalFeedbackForm {
  id: string;
  title: string;
  questions: FeedbackQuestion[];
  expiresAt: string | null;
}

function questionList(raw: unknown): FeedbackQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const parsed = feedbackQuestionSchema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
}

function answerMap(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Format the stored answers for specialist review (one line per question). */
export function formatFeedbackAnswers(
  questions: FeedbackQuestion[],
  answers: Record<string, unknown> | null
): string[] {
  if (!answers) return [];
  return questions
    .filter((question) => question.key in answers)
    .map((question) => {
      const value = answers[question.key];
      const rendered =
        typeof value === "string" ? value : value === null ? "—" : JSON.stringify(value);
      return `${question.label}: ${rendered}`;
    });
}

async function getForm(client: SupabaseClient, formId: string): Promise<FormRow> {
  const { data, error } = await client
    .from("client_feedback_forms")
    .select("id, status, questions, expires_at")
    .eq("id", validate(uuid, formId))
    .maybeSingle();
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to read feedback form");
  if (!data) throw new ServiceError("NOT_FOUND", "Feedback form not found");
  return data as FormRow;
}

/** The draft form and its audit row are one atomic RPC (ticket 05). */
export async function createFeedbackForm(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(createFeedbackFormSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "create_feedback_form",
    {
      p_org_id: input.organizationId,
      p_client_id: input.clientId,
      p_title: input.title,
      p_questions: input.questions,
      p_correction_id: input.correctionId ?? null,
      p_follow_up_id: input.followUpId ?? null,
    },
    {
      forbidden: "No access to manage this client's forms",
      failure: "Failed to create feedback form",
      validation: "Invalid feedback form",
    }
  );
}

export async function sendFeedbackForm(client: SupabaseClient, rawInput: unknown): Promise<void> {
  const input = validate(sendFeedbackFormSchema, rawInput);
  const form = await getForm(client, input.formId);
  if (form.status !== "draft") {
    throw new ServiceError("CONFLICT", "Only draft forms can be sent");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await client
    .from("client_feedback_forms")
    .update({ status: "sent", sent_at: now.toISOString(), expires_at: expiresAt })
    .eq("id", input.formId);
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to send feedback form");
}

export async function submitFeedbackForm(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(submitFeedbackFormSchema, rawInput);
  const form = await getForm(client, input.formId);
  if (form.status !== "sent") {
    throw new ServiceError("CONFLICT", "Form is not open for submission");
  }
  if (form.expires_at && new Date(form.expires_at) < new Date()) {
    throw new ServiceError("CONFLICT", "Form has expired");
  }

  const questions = questionList(form.questions);
  for (const question of questions) {
    if (question.required && !(question.key in input.answers)) {
      throw new ServiceError("VALIDATION_ERROR", `Missing required answer: ${question.key}`);
    }
  }

  // Completing the form, creating the pending Signal and writing the audit row
  // happen in one transaction (ticket 05). The authoritative status/expiry check
  // lives inside the RPC, so a concurrent submission cannot double-complete.
  return runAtomicRpc<string>(
    client,
    "submit_feedback_form",
    { p_form_id: input.formId, p_answers: input.answers },
    {
      forbidden: "Not allowed to submit this form",
      failure: "Failed to submit feedback form",
      conflict: "Form is not open for submission",
      validation: "Form is not open for submission",
    }
  );
}

/**
 * Portal submission (ticket 16).
 *
 * Deliberately does NOT pre-read the form and does not run the specialist-side
 * question checks: a portal identity may only read the rows its RLS policy
 * exposes, so a pre-read would make "another client's form" distinguishable
 * from an expired one. The atomic RPC is the single authority — it resolves the
 * portal identity, re-checks the active `client_portal` consent, the status, the
 * expiry and the required answers, and a revoked identity, a foreign identity
 * and a missing form all collapse into one neutral message.
 */
export async function submitPortalFeedbackForm(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(submitFeedbackFormSchema, rawInput);

  return runAtomicRpc<string>(
    client,
    "submit_feedback_form",
    { p_form_id: input.formId, p_answers: input.answers },
    {
      forbidden: "Not allowed to submit this form",
      failure: "Failed to submit feedback form",
      conflict: "The form is no longer available",
      validation: "The form is no longer available",
    }
  );
}

/**
 * The active, unexpired forms of the signed-in portal identity, through the
 * guarded RPC (migration 0050). An identity with no active portal access or a
 * revoked `client_portal` consent gets the same empty list as a client with no
 * forms — the denial is never distinguishable from "nothing to fill in".
 */
export async function listPortalFeedbackForms(
  client: SupabaseClient
): Promise<PortalFeedbackForm[]> {
  const { data, error } = await client.rpc("list_client_portal_feedback_forms");
  if (error) {
    if (error.code === "42501") return [];
    throw new ServiceError("INTERNAL_ERROR", "Failed to load portal feedback forms");
  }

  const row = validate(portalFormsRowSchema, data);
  return row.forms.map((form) => ({
    id: form.id,
    title: form.title,
    questions: questionList(form.questions),
    expiresAt: form.expires_at,
  }));
}

export async function listFeedbackForms(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<FeedbackFormRow[]> {
  const query = validate(listFeedbackFormsQuerySchema, rawQuery ?? {});
  const { data, error } = await client
    .from("client_feedback_forms")
    .select("id, status, title, questions, answers, sent_at, completed_at, expires_at, created_at")
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list feedback forms");

  return (
    (data ?? []) as {
      id: string;
      status: FeedbackStatus;
      title: string;
      questions: unknown;
      answers: unknown;
      sent_at: string | null;
      completed_at: string | null;
      expires_at: string | null;
      created_at: string;
    }[]
  ).map((row) => {
    const answers = answerMap(row.answers);
    return {
      id: row.id,
      status: row.status,
      title: row.title,
      questions: questionList(row.questions),
      answers,
      sentAt: row.sent_at,
      completedAt: row.completed_at,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      answeredCount: answers ? Object.keys(answers).length : 0,
    };
  });
}
