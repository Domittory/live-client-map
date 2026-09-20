import Link from "next/link";
import { previewErasure } from "@/lib/service/erasure";
import { getClientOverview } from "@/lib/service/overview";
import { getServiceClient } from "@/lib/supabase/admin";
import { ClientEditForm } from "./client-edit-form";
import { ErasureForm } from "./erasure-form";
import { ClientWorkspaceHeader } from "./workspace-nav";
import { requireClientWorkspace } from "./workspace";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Server-side guard: an unassigned or unauthorized user never reaches the
  // client metadata below (safe denial with no client data in the response).
  const { supabase, client, access } = await requireClientWorkspace(id);

  const overview = await getClientOverview(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });

  // Erasure management is Owner-only. The section below is gated so specialists
  // never see the destructive controls or the per-table impact preview.
  let erasurePreview: Awaited<ReturnType<typeof previewErasure>> | null = null;
  let erasureError: string | null = null;
  if (access.isOwner) {
    try {
      erasurePreview = await previewErasure(supabase, getServiceClient(), id);
    } catch (err) {
      erasureError =
        err instanceof Error ? err.message : "Не удалось загрузить предпросмотр удаления.";
    }
  }

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="overview" />

      {client.client_visible_notes && <p>Заметка клиенту: {client.client_visible_notes}</p>}
      {client.specialist_notes_private && (
        <p>Приватная заметка: {client.specialist_notes_private}</p>
      )}

      {access.canWrite ? (
        <ClientEditForm
          clientId={id}
          displayName={client.display_name ?? ""}
          occupation={client.occupation ?? ""}
        />
      ) : null}

      {access.isOwner ? (
        <section>
          <h2>Удаление данных</h2>
          {erasureError ? <p role="alert">{erasureError}</p> : null}
          {erasurePreview ? (
            <p>
              Будут удалены записи:{" "}
              {Object.entries(erasurePreview.impacted)
                .map(([table, count]) => `${table}: ${count}`)
                .join(", ")}
            </p>
          ) : null}
          <ErasureForm clientId={id} legalHold={erasurePreview?.legalHold ?? false} />
        </section>
      ) : null}

      <section>
        <h2>Обзор</h2>

        <h3>Активный запрос</h3>
        {overview.activeRequest ? (
          <p>
            {String(overview.activeRequest.title)} ({String(overview.activeRequest.priority)}) —{" "}
            <Link href={`/clients/${id}/requests`}>к запросам →</Link>
          </p>
        ) : (
          <p>Нет активного запроса.</p>
        )}

        <h3>Ключевые узлы модели</h3>
        {overview.topCoreNodes.length === 0 ? (
          <p>Нет подтверждённых узлов.</p>
        ) : (
          <ul>
            {overview.topCoreNodes.map((node) => (
              <li key={String(node.id)}>
                {String(node.title)} — priority {node.final_priority_score as number}
              </li>
            ))}
          </ul>
        )}

        <h3>Ресурсы</h3>
        {overview.topResources.length === 0 ? (
          <p>Нет ресурсов.</p>
        ) : (
          <ul>
            {overview.topResources.map((resource) => (
              <li key={String(resource.id)}>{String(resource.name)}</li>
            ))}
          </ul>
        )}

        <h3>Цели развития</h3>
        {overview.developmentTargets.length === 0 ? (
          <p>Нет целей развития.</p>
        ) : (
          <ul>
            {overview.developmentTargets.map((target) => (
              <li key={String(target.id)}>
                {String(target.name)} ({target.current_level as number} →{" "}
                {target.target_level as number})
              </li>
            ))}
          </ul>
        )}

        <h3>Последние триггеры</h3>
        {overview.recentTriggers.length === 0 ? (
          <p>Нет недавних триггеров.</p>
        ) : (
          <ul>
            {overview.recentTriggers.map((trigger) => (
              <li key={String(trigger.id)}>{String(trigger.title)}</li>
            ))}
          </ul>
        )}

        <h3>Последняя коррекция</h3>
        {overview.lastCorrection ? (
          <p>
            {String(overview.lastCorrection.title)} ({String(overview.lastCorrection.status)})
          </p>
        ) : (
          <p>Коррекций пока нет.</p>
        )}

        <h3>Что изменилось</h3>
        {overview.latestModelChanges.length === 0 ? (
          <p>Изменений модели не зафиксировано.</p>
        ) : (
          <ul>
            {overview.latestModelChanges.map((change) => (
              <li key={String(change.id)}>{String(change.change_reason)}</li>
            ))}
          </ul>
        )}

        <h3>Следующая рекомендация</h3>
        {overview.nextRecommendation ? (
          <p>{String(overview.nextRecommendation.proposed_correction)}</p>
        ) : (
          <p>Рекомендаций нет.</p>
        )}

        <h3>На ревью</h3>
        <p data-testid="pending-review">{overview.pendingReviewCount}</p>
      </section>
    </main>
  );
}
