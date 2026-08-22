import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ServiceError, toErrorResponse } from "@/lib/service/errors";
import { score, uuid, validate } from "@/lib/service/validation";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  decodeCursor,
  encodeCursor,
  pageQuerySchema,
  toPage,
} from "@/lib/service/pagination";

describe("ServiceError / toErrorResponse", () => {
  it("maps a known code to the right HTTP status", () => {
    expect(new ServiceError("NOT_FOUND", "missing").status).toBe(404);
    expect(new ServiceError("VALIDATION_ERROR", "bad").status).toBe(400);
    expect(new ServiceError("DATABASE_UNAVAILABLE", "down").status).toBe(503);
  });

  it("masks unknown errors so internals never leak", async () => {
    const res = toErrorResponse(new Error("db password=hunter2"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("hunter2");
  });

  it("serializes a ServiceError with its typed code", async () => {
    const res = toErrorResponse(new ServiceError("VALIDATION_ERROR", "bad input"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("validate", () => {
  it("returns parsed data on success", () => {
    const schema = z.object({ n: z.number() }).strict();
    expect(validate(schema, { n: 1 })).toEqual({ n: 1 });
  });

  it("throws VALIDATION_ERROR on unknown fields", () => {
    const schema = z.object({ n: z.number() }).strict();
    expect(() => validate(schema, { n: 1, extra: true })).toThrow(ServiceError);
  });

  it("enforces score range 0–100 and uuid format", () => {
    expect(score.parse(50)).toBe(50);
    expect(() => score.parse(150)).toThrow();
    expect(uuid.parse("123e4567-e89b-12d3-a456-426614174000")).toBe(
      "123e4567-e89b-12d3-a456-426614174000"
    );
  });
});

describe("pagination", () => {
  it("round-trips an opaque cursor", () => {
    expect(decodeCursor(encodeCursor("abc:123"))).toBe("abc:123");
  });

  it("slices a window of limit+1 rows into a page with a next cursor", () => {
    const page = toPage([1, 2, 3], 2, (last) => `c-${last}`);
    expect(page.items).toEqual([1, 2]);
    expect(page.nextCursor).toBe("c-2");
  });

  it("returns a null next cursor when there is no further page", () => {
    const page = toPage([1, 2], 2, (last) => `c-${last}`);
    expect(page.nextCursor).toBeNull();
  });

  it("applies default and max limits", () => {
    expect(pageQuerySchema.parse({}).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(() => pageQuerySchema.parse({ limit: MAX_PAGE_SIZE + 1 })).toThrow();
  });
});
