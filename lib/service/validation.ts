import { z } from "zod";
import { ServiceError } from "./errors";

/**
 * Validation convention (ticket 10, SPEC §35):
 * strict schemas, no unknown fields, enum validation, scores 0–100.
 * A failed parse raises a typed VALIDATION_ERROR, never a raw ZodError.
 */
export function validate<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ServiceError("VALIDATION_ERROR", "Validation failed", result.error.flatten());
  }
  return result.data;
}

/** Scores and confidence are integers 0–100 (null when absent) — ticket 03. */
export const score = z.number().int().min(0).max(100);

export const uuid = z.string().uuid();
