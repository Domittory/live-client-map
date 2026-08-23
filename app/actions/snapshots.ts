"use server";

import { revalidatePath } from "next/cache";
import { ServiceError } from "@/lib/service/errors";
import { generateSnapshot } from "@/lib/service/snapshots";
import { createClient } from "@/lib/supabase/server";

export type SnapshotState = { error: string | null; snapshotId: string | null };

function toState(err: unknown): SnapshotState {
  if (err instanceof ServiceError) return { error: err.message, snapshotId: null };
  return { error: "Внутренняя ошибка", snapshotId: null };
}

export async function generateSnapshotAction(
  _prev: SnapshotState,
  input: { clientId: string; reason: string }
): Promise<SnapshotState> {
  let snapshotId: string;
  try {
    const supabase = await createClient();
    const snapshot = await generateSnapshot(supabase, input);
    snapshotId = snapshot.id;
  } catch (err) {
    return toState(err);
  }
  revalidatePath("/snapshots");
  return { error: null, snapshotId };
}
