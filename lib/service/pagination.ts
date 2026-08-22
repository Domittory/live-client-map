import { z } from "zod";
import { ServiceError } from "./errors";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

/** Standard cursor-pagination query contract. */
export const pageQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export function decodeCursor(cursor: string): string {
  try {
    return Buffer.from(cursor, "base64url").toString("utf8");
  } catch {
    throw new ServiceError("VALIDATION_ERROR", "Invalid cursor");
  }
}

/**
 * Build a page from a fetched window of `limit + 1` rows.
 * The caller passes a `nextCursorOf` that derives the opaque cursor of the
 * last returned item; `null` means no further page.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  nextCursorOf: (last: T) => string | null
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore && items.length > 0 ? nextCursorOf(items[items.length - 1]) : null;
  return { items, nextCursor };
}
