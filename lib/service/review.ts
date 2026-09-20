import type { SupabaseClient } from "@supabase/supabase-js";
import { runAtomicRpc } from "./transaction";

export const REVIEW_ACTIONS = ["approve", "reject", "mark_sensitive", "hide"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Only approved results count as confirmed evidence (SPEC §36). */
export function countsAsConfirmedEvidence(reviewStatus: string): boolean {
  return reviewStatus === "approved";
}

/**
 * Apply a human review action to a Signal. The evidence status change and its
 * audit row (with the authenticated actor and the reviewer's reason) are one
 * atomic RPC (ticket 05). Sensitive/hidden states map to visibility, never to a
 * rewrite of raw data.
 */
export async function reviewSignal(
  client: SupabaseClient,
  organizationId: string,
  signalId: string,
  action: ReviewAction,
  reason?: string
): Promise<void> {
  await runAtomicRpc<void>(
    client,
    "review_signal",
    {
      p_org_id: organizationId,
      p_signal_id: signalId,
      p_action: action,
      p_reason: reason ?? null,
    },
    {
      forbidden: "No write access to this client",
      failure: "Failed to review signal",
      validation: "Signal not found",
    }
  );
}
