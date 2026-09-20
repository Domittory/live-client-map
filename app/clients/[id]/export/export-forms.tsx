"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Request the full client archive (ticket 22).
 *
 * The submit goes through the real HTTP contract (`POST /api/exports`) with the
 * browser session cookie, exactly like the journey does. On success the server
 * component is re-rendered so the new `available` row and its opaque download
 * link appear. Errors are shown with the Russian message the route returns; no
 * internal detail is surfaced.
 */
export function ExportRequestForm({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <form
      data-testid="export-request-form"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError(null);
        try {
          const response = await fetch("/api/exports", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              clientId,
              kind: "client_archive",
              audience: "owner",
              idempotencyKey: crypto.randomUUID(),
            }),
          });
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as {
              error?: { message?: string };
            } | null;
            setError(body?.error?.message ?? "Не удалось создать экспорт.");
            return;
          }
          router.refresh();
        } catch {
          setError("Не удалось создать экспорт.");
        } finally {
          setPending(false);
        }
      }}
    >
      <button type="submit" data-testid="export-request-submit" disabled={pending}>
        Создать полный архив
      </button>
      {error ? (
        <p className="error" data-testid="export-request-error">
          {error}
        </p>
      ) : null}
    </form>
  );
}
