import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "./audit";
import { ServiceError } from "./errors";

export const REVIEW_ACTIONS = ["approve", "reject", "mark_sensitive", "hide"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Only approved results count as confirmed evidence (SPEC §36). */
export function countsAsConfirmedEvidence(reviewStatus: string): boolean {
  return reviewStatus === "approved";
}

/**
 * Apply a human review action to a Signal and write the audit trail.
 * Sensitive/hidden states map to visibility, never to a rewrite of raw data.
 */
export async function reviewSignal(
  client: SupabaseClient,
  organizationId: string,
  signalId: string,
  action: ReviewAction,
  reason?: string
): Promise<void> {
  const patch: Record<string, unknown> =
    action === "approve"
      ? { review_status: "approved" }
      : action === "reject"
        ? { review_status: "rejected" }
        : action === "mark_sensitive"
          ? { visibility: "sensitive" }
          : { visibility: "internal" };

  const { data: signal } = await client
    .from("signals")
    .select("id")
    .eq("id", signalId)
    .maybeSingle();
  if (!signal) throw new ServiceError("NOT_FOUND", "Signal not found");

  const { error } = await client.from("signals").update(patch).eq("id", signalId);
  if (error) {
    if (error.code === "42501")
      throw new ServiceError("FORBIDDEN", "No write access to this client");
    throw new ServiceError("INTERNAL_ERROR", "Failed to review signal");
  }

  await recordAudit(client, {
    organizationId,
    entityType: "signal",
    entityId: signalId,
    action: `review.${action}`,
    after: patch,
    reason: reason ?? `signal ${action}`,
  });
}
