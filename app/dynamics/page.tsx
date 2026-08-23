import Link from "next/link";
import { redirect } from "next/navigation";
import {
  compareSnapshotVersions,
  getClientTimeline,
  type SnapshotVersionsComparison,
  type TimelineEvent,
} from "@/lib/service/dynamics";
import { ServiceError } from "@/lib/service/errors";
import { listModelExplanations, type ModelExplanation } from "@/lib/service/explanations";
import { listModelChanges, type ModelChange } from "@/lib/service/model-changes";
import {
  listSnapshots,
  type PsychologicalSnapshot,
  type SnapshotDiff,
  type SnapshotItem,
} from "@/lib/service/snapshots";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const EVENT_TYPE_LABELS: Record<TimelineEvent["type"], string> = {
  diagnostic_session: "Диагностическая сессия",
  correction: "Коррекция",
  follow_up: "Follow-up",
  model_change: "Изменение модели",
  snapshot: "Snapshot",
};

function itemLabel(item: SnapshotItem): string {
  const label = item.title ?? item.name ?? item.proposed_correction ?? item.id;
  const status = item.status ? ` [${String(item.status)}]` : "";
  return `${String(label)}${status}`;
}

function TimelineSection({ events }: { events: TimelineEvent[] }) {
  return (
    <section>
      <h2>Хронология</h2>
      {events.length === 0 ? (
        <p>
          Истории пока нет: по этому клиенту не зафиксировано ни сессий, ни коррекций, ни изменений
          модели. Выводы появятся только после первых событий.
        </p>
      ) : (
        <ol>
          {events.map((event) => (
            <li key={`${event.type}:${event.sourceId}`}>
              <strong>{event.occurredAt}</strong> — {EVENT_TYPE_LABELS[event.type]}: {event.title}
              {event.details ? <> ({event.details})</> : null}{" "}
              {event.sourceRoute ? <Link href={event.sourceRoute}>источник →</Link> : null}{" "}
              {event.evidenceRoute ? <Link href={event.evidenceRoute}>evidence →</Link> : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function collectScoreMovements(changes: SnapshotDiff) {
  // Before/after values come from the deterministic snapshot diff, never from
  // AI text (SPEC §26).
  const movements: { label: string; field: string; before: number; after: number }[] = [];
  for (const category of Object.keys(changes) as (keyof SnapshotDiff)[]) {
    for (const change of changes[category].changed) {
      const fields = new Set([...Object.keys(change.before), ...Object.keys(change.after)]);
      for (const field of fields) {
        if (!field.endsWith("_score")) continue;
        const before = change.before[field];
        const after = change.after[field];
        if (typeof before !== "number" || typeof after !== "number" || before === after) continue;
        movements.push({ label: `${category}: ${itemLabel(change.after)}`, field, before, after });
      }
    }
  }
  return movements;
}

function MovementList({
  title,
  movements,
  direction,
}: {
  title: string;
  movements: ReturnType<typeof collectScoreMovements>;
  direction: "up" | "down";
}) {
  const items = movements.filter((m) =>
    direction === "up" ? m.after > m.before : m.after < m.before
  );
  return (
    <>
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {items.map((m) => (
            <li key={`${m.label}.${m.field}`}>
              {m.label} — {m.field}: {m.before} → {m.after}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function AddedList({
  title,
  addedIds,
  after,
}: {
  title: string;
  addedIds: string[];
  after: SnapshotItem[];
}) {
  const byId = new Map(after.map((item) => [String(item.id), item]));
  return (
    <>
      <h4>{title}</h4>
      {addedIds.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {addedIds.map((id) => (
            <li key={id}>{byId.get(id) ? itemLabel(byId.get(id)!) : id}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Key UI block (SPEC §26): «Что изменилось в модели?» for a version pair. */
function WhatChangedSection({ comparison }: { comparison: SnapshotVersionsComparison }) {
  const { from, to, changes } = comparison;
  const movements = collectScoreMovements(changes);
  const recommendationsChanged = changes.recommendations.changed;
  return (
    <section>
      <h2>
        Что изменилось в модели? (v{from.version} → v{to.version})
      </h2>
      <p>
        Before/after значения взяты из сохранённых snapshots: v{from.version} ({from.generated_at},
        hash {from.model_hash.slice(0, 12)}…) → v{to.version} ({to.generated_at}, hash{" "}
        {to.model_hash.slice(0, 12)}…).
      </p>

      <MovementList title="Что усилилось" movements={movements} direction="up" />
      <MovementList title="Что ослабло" movements={movements} direction="down" />
      <AddedList
        title="Новые Themes"
        addedIds={changes.active_themes.added}
        after={to.active_themes}
      />
      <AddedList
        title="Новые CoreNodes"
        addedIds={changes.active_core_nodes.added}
        after={to.active_core_nodes}
      />
      <AddedList
        title="Гипотезы, которые стали слабее (новые weakened узлы)"
        addedIds={changes.weakened_nodes.added}
        after={to.weakened_nodes}
      />
      <h4>Новые DifferentialHypotheses</h4>
      <p>Нет данных: дифференциальные гипотезы не входят в snapshot-категории (SPEC §25).</p>

      <h4>Приоритет коррекций</h4>
      {recommendationsChanged.length === 0 &&
      changes.recommendations.added.length === 0 &&
      changes.recommendations.removed.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {recommendationsChanged.map((change) => (
            <li key={change.id}>
              {itemLabel(change.after)}: приоритет{" "}
              {String(change.before.final_priority_score ?? "—")} →{" "}
              {String(change.after.final_priority_score ?? "—")}
            </li>
          ))}
          {changes.recommendations.added.map((id) => (
            <li key={id}>Новая рекомендация {id}</li>
          ))}
          {changes.recommendations.removed.map((id) => (
            <li key={id}>Рекомендация {id} убрана</li>
          ))}
        </ul>
      )}

      <h4>Новые противоречия</h4>
      <p>Нет данных: противоречия не входят в snapshot-категории (SPEC §25).</p>
    </section>
  );
}

function CompareForm({
  clientId,
  snapshots,
  fromId,
  toId,
}: {
  clientId: string;
  snapshots: PsychologicalSnapshot[];
  fromId?: string;
  toId?: string;
}) {
  return (
    <form method="get">
      <input type="hidden" name="clientId" value={clientId} />
      <label>
        От версии
        <select name="from" defaultValue={fromId ?? ""}>
          <option value="">—</option>
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              v{snapshot.version} — {snapshot.generated_at}
            </option>
          ))}
        </select>
      </label>
      <label>
        До версии
        <select name="to" defaultValue={toId ?? ""}>
          <option value="">—</option>
          {snapshots.map((snapshot) => (
            <option key={snapshot.id} value={snapshot.id}>
              v{snapshot.version} — {snapshot.generated_at}
            </option>
          ))}
        </select>
      </label>
      <button type="submit">Сравнить</button>
    </form>
  );
}

function ApprovedExplanationsSection({
  explanations,
  modelChanges,
}: {
  explanations: ModelExplanation[];
  modelChanges: ModelChange[];
}) {
  const changesById = new Map(modelChanges.map((change) => [change.id, change]));
  return (
    <section>
      <h2>Подтверждённые объяснения изменений</h2>
      {explanations.length === 0 ? (
        <p>
          Подтверждённых объяснений пока нет. Объяснения появляются после ревью на странице{" "}
          <Link href="/snapshots">snapshots</Link>.
        </p>
      ) : (
        explanations.map((explanation) => (
          <article key={explanation.id}>
            <h3>Объяснение от {explanation.created_at}</h3>
            <p>
              Использованные версии: scoring {explanation.versions.scoring_model_version ?? "—"},
              ontology {explanation.versions.ontology_version ?? "—"}, AI{" "}
              {explanation.versions.ai_model ?? "—"}, prompt{" "}
              {explanation.versions.prompt_version ?? "—"}
            </p>
            <p>
              Snapshots: {explanation.before_snapshot_id ?? "—"} →{" "}
              {explanation.after_snapshot_id ?? "—"}; подтверждено {explanation.decided_at ?? "—"}
            </p>
            {explanation.missing_evidence.length > 0 ? (
              <p>Недостаточно данных: {explanation.missing_evidence.join(", ")}.</p>
            ) : null}
            {explanation.explanations.length > 0 ? (
              <ul>
                {explanation.explanations.map((entry) => {
                  const change = changesById.get(entry.model_change_id);
                  return (
                    <li key={entry.model_change_id}>
                      <strong>{entry.headline}</strong>
                      <p>{entry.explanation}</p>
                      {change ? (
                        <p>
                          Факт (ModelChange {change.entity_type}): было{" "}
                          <code>{JSON.stringify(change.previous_state)}</code> → стало{" "}
                          <code>{JSON.stringify(change.new_state)}</code>
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>Записей объяснения нет.</p>
            )}
          </article>
        ))
      )}
    </section>
  );
}

export default async function DynamicsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) {
    return (
      <main className="shell">
        <h1>Dynamics и история</h1>
        <p>У вас нет активного членства в организации.</p>
        <p>
          <Link href="/">← На главную</Link>
        </p>
      </main>
    );
  }

  const clientId = first(params.clientId);
  const fromId = first(params.from);
  const toId = first(params.to);

  let comparison: SnapshotVersionsComparison | null = null;
  let comparisonError: string | null = null;
  if (fromId && toId) {
    try {
      comparison = await compareSnapshotVersions(supabase, {
        fromSnapshotId: fromId,
        toSnapshotId: toId,
      });
    } catch (err) {
      comparisonError = err instanceof ServiceError ? err.message : "Ошибка сравнения snapshots";
    }
  }

  const timeline = clientId
    ? await getClientTimeline(supabase, {
        organizationId: membership.organization_id,
        clientId,
      })
    : null;
  const snapshots = clientId
    ? await listSnapshots(supabase, { organizationId: membership.organization_id, clientId })
    : null;
  const modelChanges = clientId
    ? await listModelChanges(supabase, { organizationId: membership.organization_id, clientId })
    : null;
  const approvedExplanations = clientId
    ? await listModelExplanations(supabase, {
        organizationId: membership.organization_id,
        clientId,
        status: "approved",
      })
    : null;

  return (
    <main className="shell">
      <h1>Dynamics и история модели</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <form method="get">
        <label>
          Клиент (ID)
          <input type="text" name="clientId" defaultValue={clientId ?? ""} />
        </label>
        <button type="submit">Найти</button>
      </form>

      {clientId ? (
        <>
          <TimelineSection events={timeline ?? []} />

          <section>
            <h2>Сравнение версий snapshot</h2>
            {snapshots && snapshots.items.length >= 2 ? (
              <CompareForm
                clientId={clientId}
                snapshots={snapshots.items}
                fromId={fromId}
                toId={toId}
              />
            ) : (
              <p>
                Недостаточно данных для сравнения: нужно минимум две версии snapshot (сейчас{" "}
                {snapshots?.items.length ?? 0}).
              </p>
            )}
            {comparisonError ? <p role="alert">{comparisonError}</p> : null}
          </section>

          {comparison ? <WhatChangedSection comparison={comparison} /> : null}

          <ApprovedExplanationsSection
            explanations={approvedExplanations?.items ?? []}
            modelChanges={modelChanges?.items ?? []}
          />
        </>
      ) : (
        <p>Укажите ID клиента, чтобы увидеть хронологию и сравнение версий модели.</p>
      )}
    </main>
  );
}
