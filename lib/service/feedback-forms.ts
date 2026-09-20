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

const questionSchema = z
  .object({
    key: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(500),
    type: z.enum(["scale_1_10", "text", "yes_no"]),
    required: z.boolean().default(false),
  })
  .strict();

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

interface FormRow {
  id: string;
  organization_id: string;
  client_id: string;
  status: FeedbackStatus;
  questions: unknown[];
  answers: unknown | null;
  expires_at: string | null;
}

async function getForm(client: SupabaseClient, formId: string): Promise<FormRow> {
  const { data, error } = await client
    .from("client_feedback_forms")
    .select("id, organization_id, client_id, status, questions, answers, expires_at")
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

  const questions = form.questions as { key: string; required?: boolean }[];
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

export async function listFeedbackForms(
  client: SupabaseClient,
  rawQuery: unknown
): Promise<FormRow[]> {
  const query = validate(listFeedbackFormsQuerySchema, rawQuery ?? {});
  const { data, error } = await client
    .from("client_feedback_forms")
    .select("id, organization_id, client_id, status, questions, answers")
    .eq("organization_id", query.organizationId)
    .eq("client_id", query.clientId)
    .order("created_at", { ascending: false });
  if (error) throw new ServiceError("INTERNAL_ERROR", "Failed to list feedback forms");
  return (data ?? []) as FormRow[];
}
