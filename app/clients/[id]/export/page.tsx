import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import { ExportRequestForm } from "./export-forms";

/**
 * Owner-facing export section (ticket 22).
 *
 * It exists so the production journey can request and download the full archive
 * through visible UI — the HTTP contract is still the authority, and this page
 * is a thin consumer of it. The list is read with the caller's own session, so
 * `export_requests` RLS decides what is visible; no service-role read happens
 * here. Only an `available` request exposes its opaque download link.
 */

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  requested: "Запрошен",
  generating: "Готовится",
  available: "Готов к скачиванию",
  failed: "Ошибка генерации",
  denied: "Отказано",
  expired: "Срок хранения истёк",
};

interface ExportRequestRow {
  id: string;
  kind: string;
  format: string;
  status: string;
  requested_at: string;
  expires_at: string;
  artifact_filename: string | null;
  artifact_bytes: number | null;
}

export default async function ClientExportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "export")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="export" />
        <ClientSectionDenied section="export" />
      </main>
    );
  }

  const { data } = await supabase
    .from("export_requests")
    .select("id, kind, format, status, requested_at, expires_at, artifact_filename, artifact_bytes")
    .eq("client_id", id)
    .order("requested_at", { ascending: false })
    .limit(20);
  const requests = (data ?? []) as ExportRequestRow[];

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="export" />

      <section>
        <h2>Полный архив клиента</h2>
        <p className="hint" data-testid="export-policy-note">
          Архив собирается асинхронно и содержит только разрешённые данные клиента: без паролей,
          auth-идентичностей, приватных заметок специалиста, IP и user-agent. Скачивание повторно
          проверяет доступ и согласия на момент выдачи, поэтому отозванное согласие блокирует уже
          готовый файл. Файл хранится 30 дней и затем удаляется.
        </p>

        <ExportRequestForm clientId={id} />

        <h3>Запросы на экспорт</h3>
        {requests.length === 0 ? (
          <p className="hint" data-testid="export-requests-empty">
            Запросов на экспорт ещё нет.
          </p>
        ) : (
          <ul data-testid="export-requests">
            {requests.map((request) => (
              <li
                key={request.id}
                data-testid="export-request-row"
                data-export-id={request.id}
                data-status={request.status}
              >
                <span data-testid="export-request-kind">{request.kind}</span> —{" "}
                <span data-testid="export-request-status">
                  {STATUS_LABELS[request.status] ?? request.status}
                </span>
                {request.status === "available" ? (
                  <>
                    {" · "}
                    <a
                      data-testid="export-download-link"
                      href={`/api/exports/${request.id}/download`}
                    >
                      Скачать архив
                    </a>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
