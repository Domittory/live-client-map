import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClient } from "@/lib/service/clients";
import { getLivingMap, type GraphNode, type GraphNodeType } from "@/lib/service/living-map";

const TYPE_LABEL: Record<GraphNodeType, string> = {
  core_node: "Узел",
  theme: "Тема",
  resource: "Ресурс",
  trigger: "Триггер",
  correction: "Коррекция",
  development_target: "Цель развития",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LivingMapPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClient(supabase, id);
  if (!client) notFound();

  const hideAiOnly = first(sp?.hideAiOnly) === "true" || first(sp?.hideAiOnly) === "1";
  const lifeArea = first(sp?.lifeArea);
  const snapshotVersionRaw = first(sp?.snapshotVersion);
  const snapshotVersion = snapshotVersionRaw ? Number(snapshotVersionRaw) : undefined;

  const map = await getLivingMap(supabase, {
    organizationId: client.organization_id,
    clientId: id,
    hideAiOnly,
    ...(lifeArea ? { lifeArea } : {}),
    ...(snapshotVersion && Number.isFinite(snapshotVersion) ? { snapshotVersion } : {}),
  });

  const byType = (type: GraphNodeType) => map.nodes.filter((n) => n.type === type);

  return (
    <main className="shell">
      <h1>Живая карта — {client.display_name ?? client.first_name ?? "Клиент"}</h1>
      <p>
        <Link href={`/clients/${id}`}>← Обзор клиента</Link>
      </p>

      {map.historical && (
        <p data-testid="historical-badge">Историческая версия: snapshot {map.snapshotVersion}</p>
      )}
      {!map.historical && <p data-testid="current-badge">Текущая модель</p>}

      <p>
        Фильтры: <Link href={`/clients/${id}/map`}>текущая</Link> ·{" "}
        <Link href={`/clients/${id}/map?hideAiOnly=true`}>скрыть AI</Link>
        {lifeArea ? (
          <>
            {" "}
            · <Link href={`/clients/${id}/map`}>сбросить life area</Link>
          </>
        ) : null}
      </p>

      <section>
        <h2>Узлы ({map.nodes.length})</h2>
        {map.nodes.length === 0 ? (
          <p>Модель пуста.</p>
        ) : (
          (Object.keys(TYPE_LABEL) as GraphNodeType[]).map((type) => {
            const items = byType(type);
            if (items.length === 0) return null;
            return (
              <div key={type}>
                <h3>
                  {TYPE_LABEL[type]} ({items.length})
                </h3>
                <ul>
                  {items.map((node: GraphNode) => (
                    <li key={node.id} data-node-type={node.type} data-ai-only={node.isAiOnly}>
                      {node.label}
                      {node.isAiOnly ? " (ожидает ревью)" : ""} — {node.status}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>

      <section>
        <h2>Связи ({map.edges.length})</h2>
        {map.edges.length === 0 ? (
          <p>Связей нет.</p>
        ) : (
          <ul>
            {map.edges.map((edge) => (
              <li key={edge.id} data-edge-type={edge.type}>
                {edge.from} → {edge.to} ({edge.type})
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
