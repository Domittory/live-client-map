import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";
import { uuid, validate } from "./validation";

/**
 * Safety and medical-boundary guards (ticket 59, SPEC §10/§20/§56). A
 * deterministic, versioned classifier flags sensitive cases (self-harm,
 * suicide, violence, abuse, coercive control, severe symptoms, child risk,
 * emergency, health/fertility) and forbidden medical causality/promises so
 * unsafe output is blocked and a human safety review is created. MedicalFact,
 * SymptomReport and PsychologicalHypothesis remain distinct downstream.
 */

export const SAFETY_CLASSIFIER_VERSION = "safety.v1";

export const SENSITIVE_CATEGORIES = [
  "self_harm",
  "suicide",
  "violence",
  "abuse",
  "coercive_control",
  "severe_symptoms",
  "child_risk",
  "emergency",
  "health_fertility",
] as const;

export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];

const CATEGORY_PATTERNS: Array<{ category: SensitiveCategory; pattern: RegExp }> = [
  { category: "self_harm", pattern: /самоповрежд|селф-?харм|порезы|нанес(ение|ти) себе/i },
  { category: "suicide", pattern: /суицид|самоубий|убить себя|покончить с собой|не хочу жить/i },
  { category: "violence", pattern: /насили|агрессия с применением|угроз[аы] физическ/i },
  { category: "abuse", pattern: /абьюз|жестокое обращение|насилие в семье|домашнее насилие/i },
  {
    category: "coercive_control",
    pattern: /контролирующ(ий|ее) поведение|изоляция от близких|принудительный контроль/i,
  },
  { category: "severe_symptoms", pattern: /психоз|галлюцинаци|бред|тяж[её]л(ая|ый) депресс/i },
  {
    category: "child_risk",
    pattern: /риск для реб[её]нка|насилие над реб[её]нком|опасность для реб[её]нка/i,
  },
  { category: "emergency", pattern: /неотложн|экстренн|скорая помощь|угроза жизни/i },
  { category: "health_fertility", pattern: /бесплоди|зачати|фертильност|вынашивани/i },
];

const MEDICAL_CAUSALITY =
  /вызва[лноаи]|является причиной|причиной .* является|приве[лноаи] к|спровоцирова[лноаи]|caus(ed|es) by/i;

const MEDICAL_PROMISE =
  /вылечим|излечим|гарантируем выздоровлени|гарантируем излечени|наступит беременность|верн[её]м фертильность|обещаем (выздоровление|зачатие)/iu;

const DIAGNOSIS = /диагноз|диагностирован(о|а)?\s+(как|:|—)/iu;

export interface SafetyClassification {
  categories: SensitiveCategory[];
  reviewRequired: boolean;
  medicalCausality: boolean;
  medicalPromise: boolean;
  diagnosis: boolean;
}

/** Pure, deterministic safety classification (versioned). */
export function classifySafety(text: string): SafetyClassification {
  const categories: SensitiveCategory[] = [];
  for (const { category, pattern } of CATEGORY_PATTERNS) {
    if (pattern.test(text)) categories.push(category);
  }
  return {
    categories,
    reviewRequired: categories.length > 0,
    medicalCausality: MEDICAL_CAUSALITY.test(text),
    medicalPromise: MEDICAL_PROMISE.test(text),
    diagnosis: DIAGNOSIS.test(text),
  };
}

/**
 * Guard an AI-generated assertion. Returns blocked=true for forbidden medical
 * causality/promises/diagnosis, and forces review for any sensitive category.
 */
export function guardAiOutput(text: string): {
  blocked: boolean;
  reviewRequired: boolean;
  reason: string | null;
} {
  const classification = classifySafety(text);
  if (classification.medicalPromise || classification.diagnosis) {
    return {
      blocked: true,
      reviewRequired: true,
      reason: "medical_promise_or_diagnosis",
    };
  }
  if (classification.medicalCausality) {
    return {
      blocked: true,
      reviewRequired: true,
      reason: "medical_causality",
    };
  }
  if (classification.reviewRequired) {
    return {
      blocked: false,
      reviewRequired: true,
      reason: "sensitive_case",
    };
  }
  return { blocked: false, reviewRequired: false, reason: null };
}

/** Downgrade a forbidden causal claim to a possible association (SPEC §56). */
export function toPossibleAssociation(text: string): string {
  const trimmed = text.trim();
  if (!MEDICAL_CAUSALITY.test(trimmed)) return trimmed;
  return `возможная психологическая ассоциация: ${trimmed}`;
}

export const createSafetyReviewSchema = z
  .object({
    organizationId: uuid,
    clientId: uuid,
    category: z.string().trim().min(1).max(100),
    severity: z.enum(["low", "medium", "high", "critical"]).default("high"),
    source: z.string().max(4000).optional(),
  })
  .strict();

export async function createSafetyReview(
  client: SupabaseClient,
  rawInput: unknown
): Promise<string> {
  const input = validate(createSafetyReviewSchema, rawInput);
  const {
    data: { user },
  } = await client.auth.getUser();

  const { data, error } = await client
    .from("safety_reviews")
    .insert({
      organization_id: input.organizationId,
      client_id: input.clientId,
      category: input.category,
      severity: input.severity,
      source: input.source ?? null,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No access to create a safety review for this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to create safety review");
  }

  await recordAudit(client, {
    organizationId: input.organizationId,
    entityType: "safety_review",
    entityId: data.id,
    action: "safety_review.create",
    after: { category: input.category, severity: input.severity },
  });
  return data.id;
}
