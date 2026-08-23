import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClient } from "@/lib/service/clients";
import { getClientOverview } from "@/lib/service/overview";
import { ClientEditForm } from "./client-edit-form";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClient(supabase, id);
  if (!client) notFound();

  const overview = await getClientOverview(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });

  return (
    <main className="shell">
      <h1>{client.display_name ?? client.first_name ?? "Клиент"}</h1>
      <p>
        <Link href="/clients">← Клиенты</Link>
      </p>
      <p>Статус: {client.status}</p>
      {client.client_visible_notes && <p>Заметка клиенту: {client.client_visible_notes}</p>}
      {client.specialist_notes_private && (
        <p>Приватная заметка: {client.specialist_notes_private}</p>
      )}

      <ClientEditForm
        clientId={id}
        displayName={client.display_name ?? ""}
        occupation={client.occupation ?? ""}
      />

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
