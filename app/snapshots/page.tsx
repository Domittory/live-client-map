import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listModelChanges,
  type ModelChange,
  type ModelIntervalChanges,
} from "@/lib/service/model-changes";
import {
  INSUFFICIENT_DATA_LABEL,
  evidenceTrailHref,
} from "@/lib/service/model-change-presentation";
import { ServiceError } from "@/lib/service/errors";
import { listModelExplanations, type ModelExplanation } from "@/lib/service/explanations";
import {
  HYPOTHESIS_STATUS_LABELS,
  RELATION_TYPE_LABELS,
} from "@/lib/service/model-review-presentation";
import {
  SNAPSHOT_CATEGORIES,
  compareWithPrevious,
  listSnapshots,
  type CategoryDiff,
  type PsychologicalSnapshot,
  type SnapshotDiff,
  type SnapshotItem,
} from "@/lib/service/snapshots";
import { createClient } from "@/lib/supabase/server";
import { ExplainModelChangesButton, ReviewExplanationButtons } from "./explanations-forms";
import { GenerateSnapshotForm } from "./forms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function itemLabel(item: SnapshotItem): string {
  const label = item.title ?? item.name ?? item.proposed_correction ?? item.id;
  const status = item.status ? ` [${String(item.status)}]` : "";
  return `${String(label)}${status}`;
}

function CategorySection({ title, items }: { title: string; items: SnapshotItem[] }) {
  return (
    <section>
      <h3>
        {title} ({items.length})
      </h3>
      {items.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={String(item.id)}>{itemLabel(item)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DiffSection({ changes }: { changes: SnapshotDiff | null }) {
  if (!changes) return <p>Это первая версия snapshot — сравнивать не с чем.</p>;
  return (
    <section>
      <h3>Изменения с предыдущей версии</h3>
      {SNAPSHOT_CATEGORIES.map((category) => {
        const diff = changes[category];
        if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
          return null;
        }
        return (
          <div key={category}>
            <h4>{category}</h4>
            {diff.added.length > 0 ? <p>Добавлено: {diff.added.length}</p> : null}
            {diff.removed.length > 0 ? <p>Убрано: {diff.removed.length}</p> : null}
            {diff.changed.length > 0 ? <p>Изменено: {diff.changed.length}</p> : null}
          </div>
        );
      })}
    </section>
  );
}

/**
 * Ticket 14: every model change is presented together with a link to its
 * Evidence Trail. Entity types the Evidence Drawer does not support (for
 * example a FollowUp or a BehavioralMarker) get an explicit insufficient-data
 * note instead of a link that would only fail validation.
 */
function EvidenceTrailLink({
  clientId,
  entityType,
  entityId,
}: {
  clientId: string;
  entityType: string;
  entityId: string;
}) {
  const href = evidenceTrailHref(clientId, entityType, entityId);
  if (!href) {
    return (
      <p className="hint" data-testid="evidence-trail-unavailable">
        {INSUFFICIENT_DATA_LABEL}: для сущности «{entityType}» Evidence Trail не предусмотрен.
      </p>
    );
  }
  return (
    <Link href={href} data-testid="evidence-trail-link">
      Evidence Trail
    </Link>
  );
}

/**
 * Version-bounded interval read model (ticket 14): the DifferentialHypotheses,
 * contradictions and ModelChanges created between the previous and the compared
 * snapshot. The snapshot categories stay unchanged — this section derives the
 * interval from the model-change read layer and names every gap explicitly.
 */
function IntervalChangesSection({
  interval,
  clientId,
}: {
  interval: ModelIntervalChanges | null;
  clientId: string;
}) {
  if (!interval) {
    return (
      <section data-testid="model-interval">
        <h3>Изменения модели между версиями</h3>
        <p role="alert" data-testid="interval-insufficient-data">
          {INSUFFICIENT_DATA_LABEL}: это первая версия snapshot — предыдущей версии для сравнения
          нет.
        </p>
      </section>
    );
  }

  return (
    <section data-testid="model-interval">
      <h3>Изменения модели между версиями</h3>
      <p className="hint" data-testid="interval-bounds">
        Интервал: {interval.from} → {interval.to}
      </p>

      <h4>Новые DifferentialHypotheses ({interval.hypotheses.length})</h4>
      {interval.hypotheses.length === 0 ? (
        <p role="alert" data-testid="interval-no-hypotheses">
          {INSUFFICIENT_DATA_LABEL}: между этими версиями новые DifferentialHypotheses не
          создавались.
        </p>
      ) : (
        <ul data-testid="interval-hypotheses">
          {interval.hypotheses.map((hypothesis) => (
            <li key={hypothesis.id} data-testid="interval-hypothesis">
              <strong>{hypothesis.title}</strong> [
              {HYPOTHESIS_STATUS_LABELS[hypothesis.status] ?? hypothesis.status}]
              <p>
                Подтверждающих: {hypothesis.evidenceFor.length}; противоречащих:{" "}
                {hypothesis.evidenceAgainst.length}
              </p>
              {hypothesis.evidenceFor.length === 0 ? (
                <p className="hint">
                  {INSUFFICIENT_DATA_LABEL}: подтверждающих доказательств у гипотезы нет.
                </p>
              ) : null}
              <EvidenceTrailLink
                clientId={clientId}
                entityType="differential_hypothesis"
                entityId={hypothesis.id}
              />
            </li>
          ))}
        </ul>
      )}

      <h4>
        {RELATION_TYPE_LABELS.contradicts} ({interval.contradictions.length})
      </h4>
      {interval.contradictions.length === 0 ? (
        <p role="alert" data-testid="interval-no-contradictions">
          {INSUFFICIENT_DATA_LABEL}: между этими версиями новые противоречия (contradicts) не
          создавались.
        </p>
      ) : (
        <ul data-testid="interval-contradictions">
          {interval.contradictions.map((contradiction) => (
            <li key={contradiction.id} data-testid="interval-contradiction">
              {contradiction.fromLabel} ↔ {contradiction.toLabel}
              {contradiction.evidenceSummary ? `: ${contradiction.evidenceSummary}` : ""}
              {contradiction.evidenceSummary ? null : (
                <p className="hint">
                  {INSUFFICIENT_DATA_LABEL}: описание противоречия не заполнено.
                </p>
              )}
              <EvidenceTrailLink
                clientId={clientId}
                entityType="core_node"
                entityId={contradiction.fromCoreNodeId}
              />
            </li>
          ))}
        </ul>
      )}

      <h4>Новые ModelChanges ({interval.modelChanges.length})</h4>
      {interval.modelChanges.length === 0 ? (
        <p role="alert" data-testid="interval-no-model-changes">
          {INSUFFICIENT_DATA_LABEL}: между этими версиями ModelChange не зафиксировано.
        </p>
      ) : (
        <ul data-testid="interval-model-changes">
          {interval.modelChanges.map((change) => (
            <li key={change.id} data-testid="interval-model-change">
              {change.occurred_at}: {change.entity_type} {change.entity_id} — {change.change_reason}
              {change.evidence_refs.length === 0 ? (
                <p className="hint">
                  {INSUFFICIENT_DATA_LABEL}: evidence не привязан к этому изменению.
                </p>
              ) : (
                <p>Evidence: {change.evidence_refs.join(", ")}</p>
              )}
              <EvidenceTrailLink
                clientId={clientId}
                entityType={change.entity_type}
                entityId={change.entity_id}
              />
            </li>
          ))}
        </ul>
      )}

      <h4>Ограничения данных интервала</h4>
      <ul data-testid="interval-limits">
        {interval.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </section>
  );
}

function ScoreMovements({ changes }: { changes: SnapshotDiff }) {
  // Before/after values come from the deterministic snapshot diff, never from
  // AI text (SPEC §26).
  const movements: { label: string; field: string; before: number; after: number }[] = [];
  for (const category of SNAPSHOT_CATEGORIES) {
    for (const change of changes[category].changed) {
      const fields = new Set([...Object.keys(change.before), ...Object.keys(change.after)]);
      for (const field of fields) {
        if (!field.endsWith("_score")) continue;
        const before = change.before[field];
        const after = change.after[field];
        if (typeof before !== "number" || typeof after !== "number" || before === after) continue;
        movements.push({
          label: `${category}: ${itemLabel(change.after)}`,
          field,
          before,
          after,
        });
      }
    }
  }
  const strengthened = movements.filter((m) => m.after > m.before);
  const weakened = movements.filter((m) => m.after < m.before);
  const render = (items: typeof movements) => (
    <ul>
      {items.map((m) => (
        <li key={`${m.label}.${m.field}`}>
          {m.label} — {m.field}: {m.before} → {m.after}
        </li>
      ))}
    </ul>
  );
  return (
    <>
      <h4>Что усилилось</h4>
      {strengthened.length > 0 ? render(strengthened) : <p>—</p>}
      <h4>Что ослабло</h4>
      {weakened.length > 0 ? render(weakened) : <p>—</p>}
    </>
  );
}

function AddedList({
  title,
  diff,
  after,
}: {
  title: string;
  diff: CategoryDiff;
  after: SnapshotItem[];
}) {
  const byId = new Map(after.map((item) => [String(item.id), item]));
  return (
    <>
      <h4>{title}</h4>
      {diff.added.length === 0 ? (
        <p>—</p>
      ) : (
        <ul>
          {diff.added.map((id) => (
            <li key={id}>{byId.get(id) ? itemLabel(byId.get(id)!) : id}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/** Key UI block (SPEC §26): deterministic «Что изменилось в модели?» summary. */
function WhatChangedSection({
  snapshot,
  clientId,
}: {
  snapshot: PsychologicalSnapshot | null;
  clientId: string;
}) {
  const changes = snapshot?.changes_since_previous ?? null;
  return (
    <section>
      <h2>Что изменилось в модели?</h2>
      <ExplainModelChangesButton clientId={clientId} />
      {!snapshot ? (
        <p>Недостаточно данных: нет ни одного snapshot.</p>
      ) : !changes ? (
        <p>Недостаточно данных: это первая версия snapshot — сравнивать не с чем.</p>
      ) : (
        <>
          <ScoreMovements changes={changes} />
          <AddedList
            title="Новые CoreNodes"
            diff={changes.active_core_nodes}
            after={snapshot.active_core_nodes}
          />
          <AddedList
            title="Новые Themes"
            diff={changes.active_themes}
            after={snapshot.active_themes}
          />
          <AddedList
            title="Ослабшие узлы (новые weakened)"
            diff={changes.weakened_nodes}
            after={snapshot.weakened_nodes}
          />
          <h4>Приоритет коррекций</h4>
          {changes.recommendations.changed.length === 0 &&
          changes.recommendations.added.length === 0 &&
          changes.recommendations.removed.length === 0 ? (
            <p>—</p>
          ) : (
            <ul>
              {changes.recommendations.changed.map((change) => (
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
        </>
      )}
    </section>
  );
}

function ExplanationCard({
  explanation,
  changesById,
}: {
  explanation: ModelExplanation;
  changesById: Map<string, ModelChange>;
}) {
  return (
    <article>
      <h3>
        Объяснение {explanation.id.slice(0, 8)}… — статус: {explanation.status} (
        {explanation.source === "deterministic_guard" ? "автопроверка данных" : "AI"})
      </h3>
      <p>
        Snapshots: {explanation.before_snapshot_id ?? "—"} → {explanation.after_snapshot_id ?? "—"};
        создано {explanation.created_at}
      </p>
      {explanation.missing_evidence.length > 0 ? (
        <p role="alert">
          Недостаточно данных: {explanation.missing_evidence.join(", ")}. Объяснение не
          генерировалось.
        </p>
      ) : null}
      {explanation.grounding_errors.length > 0 ? (
        <p role="alert">
          Отклонено автоматически — обнаружены несуществующие ссылки:{" "}
          {explanation.grounding_errors.join("; ")}
        </p>
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
                {entry.score_breakdown_summary ? (
                  <p>Scores: {entry.score_breakdown_summary}</p>
                ) : null}
                {entry.uncertainty ? <p>Неопределённость: {entry.uncertainty}</p> : null}
                {entry.missing_evidence.length > 0 ? (
                  <p>Недостающие данные: {entry.missing_evidence.join(", ")}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {explanation.status === "pending" ? (
        <ReviewExplanationButtons explanationId={explanation.id} />
      ) : null}
    </article>
  );
}

function ExplanationsSection({
  explanations,
  modelChanges,
}: {
  explanations: ModelExplanation[];
  modelChanges: ModelChange[];
}) {
  const changesById = new Map(modelChanges.map((change) => [change.id, change]));
  return (
    <section>
      <h2>Объяснения изменений модели</h2>
      {explanations.length === 0 ? (
        <p>Объяснений пока нет.</p>
      ) : (
        explanations.map((explanation) => (
          <ExplanationCard
            key={explanation.id}
            explanation={explanation}
            changesById={changesById}
          />
        ))
      )}
    </section>
  );
}

function SnapshotDetail({ snapshot }: { snapshot: PsychologicalSnapshot }) {
  return (
    <section>
      <h2>
        Snapshot v{snapshot.version} — {snapshot.generated_at}
      </h2>
      <p>Причина: {snapshot.reason}</p>
      <p>{snapshot.summary}</p>
      <p>model_hash: {snapshot.model_hash}</p>
      <p>
        Версии: scoring {snapshot.scoring_model_version}, ontology {snapshot.ontology_version}, AI{" "}
        {snapshot.ai_model}, prompt {snapshot.prompt_version}
      </p>
      {SNAPSHOT_CATEGORIES.map((category) => (
        <CategorySection key={category} title={category} items={snapshot[category]} />
      ))}
      <section>
        <h3>Trend summary</h3>
        <p>{snapshot.trend_summary}</p>
        <h3>Risk zones</h3>
        <p>{snapshot.risk_notes}</p>
        <h3>Evidence digest</h3>
        <p>{snapshot.evidence_digest}</p>
      </section>
    </section>
  );
}

/**
 * Report export (ticket 56, §13). The contract requires every request to name
 * an exact snapshot version — turning "latest" into a concrete version is the
 * UI's job, so the newest version is preselected here rather than resolved
 * later on the server.
 */
function ReportExportSection({
  clientId,
  snapshots,
}: {
  clientId: string;
  snapshots: PsychologicalSnapshot[];
}) {
  return (
    <section>
      <h2>Отчёт: Markdown и PDF</h2>
      {snapshots.length === 0 ? (
        <p>Отчёт можно сформировать после создания первого snapshot.</p>
      ) : (
        <form method="get" action="/api/reports/snapshot">
          <input type="hidden" name="clientId" value={clientId} />
          <label>
            Версия snapshot
            <select name="snapshotVersion" defaultValue={String(snapshots[0].version)}>
              {snapshots.map((snapshot, index) => (
                <option key={snapshot.id} value={snapshot.version}>
                  v{snapshot.version}
                  {index === 0 ? " (последняя)" : ""} — {snapshot.generated_at}
                </option>
              ))}
            </select>
          </label>
          <label>
            Аудитория
            <select name="audience" defaultValue="specialist">
              <option value="specialist">Специалист</option>
              <option value="client">Клиент</option>
            </select>
          </label>
          <label>
            Формат
            <select name="format" defaultValue="markdown">
              <option value="markdown">Markdown</option>
              <option value="pdf">PDF</option>
            </select>
          </label>
          <button type="submit">Скачать отчёт</button>
        </form>
      )}
      <p>
        Отчёт собирается из выбранной неизменяемой версии snapshot и не создаёт новых выводов. Отчёт
        для клиента содержит только материалы, помеченные как доступные клиенту, и объяснения,
        прошедшие проверку.
      </p>
    </section>
  );
}

export default async function SnapshotsPage({ searchParams }: { searchParams: SearchParams }) {
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
        <h1>Snapshots</h1>
        <p>У вас нет активного членства в организации.</p>
        <p>
          <Link href="/">← На главную</Link>
        </p>
      </main>
    );
  }

  const clientId = first(params.clientId);
  const snapshotId = first(params.snapshotId);

  let comparison: Awaited<ReturnType<typeof compareWithPrevious>> | null = null;
  let comparisonError: string | null = null;
  if (snapshotId) {
    try {
      comparison = await compareWithPrevious(supabase, snapshotId);
    } catch (err) {
      comparisonError = err instanceof ServiceError ? err.message : "Ошибка загрузки snapshot";
    }
  }

  const snapshots = clientId
    ? await listSnapshots(supabase, { organizationId: membership.organization_id, clientId })
    : null;
  const modelChanges = clientId
    ? await listModelChanges(supabase, { organizationId: membership.organization_id, clientId })
    : null;
  const explanations = clientId
    ? await listModelExplanations(supabase, {
        organizationId: membership.organization_id,
        clientId,
      })
    : null;

  return (
    <main className="shell">
      <h1>Psychological snapshots и история модели</h1>
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
          <section>
            <h2>Новый snapshot</h2>
            <GenerateSnapshotForm clientId={clientId} />
          </section>

          <section>
            <h2>Версии snapshots</h2>
            {snapshots && snapshots.items.length > 0 ? (
              <ul>
                {snapshots.items.map((snapshot) => (
                  <li key={snapshot.id}>
                    <Link href={`/snapshots?clientId=${clientId}&snapshotId=${snapshot.id}`}>
                      v{snapshot.version} — {snapshot.generated_at}
                    </Link>{" "}
                    ({snapshot.reason}; hash {snapshot.model_hash.slice(0, 12)}…)
                  </li>
                ))}
              </ul>
            ) : (
              <p>Snapshots ещё не создавались.</p>
            )}
          </section>

          <section>
            <h2>История изменений модели (ModelChanges)</h2>
            {modelChanges && modelChanges.items.length > 0 ? (
              <ul>
                {modelChanges.items.map((change) => (
                  <li key={change.id} data-testid="model-change">
                    {change.occurred_at}: {change.entity_type} {change.entity_id} —{" "}
                    {change.change_reason} (evidence: {change.evidence_refs.length})
                    {change.evidence_refs.length === 0 ? (
                      <p className="hint">
                        {INSUFFICIENT_DATA_LABEL}: evidence не привязан к этому изменению.
                      </p>
                    ) : null}
                    <EvidenceTrailLink
                      clientId={clientId}
                      entityType={change.entity_type}
                      entityId={change.entity_id}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p>Изменений модели пока нет.</p>
            )}
          </section>

          <ReportExportSection clientId={clientId} snapshots={snapshots?.items ?? []} />

          <WhatChangedSection
            snapshot={snapshots && snapshots.items.length > 0 ? snapshots.items[0] : null}
            clientId={clientId}
          />

          <ExplanationsSection
            explanations={explanations?.items ?? []}
            modelChanges={modelChanges?.items ?? []}
          />
        </>
      ) : (
        <p>Укажите ID клиента, чтобы увидеть версии snapshots и историю модели.</p>
      )}

      {comparisonError ? <p role="alert">{comparisonError}</p> : null}
      {comparison ? (
        <>
          <SnapshotDetail snapshot={comparison.snapshot} />
          <DiffSection changes={comparison.changes} />
          <IntervalChangesSection
            interval={comparison.interval}
            clientId={comparison.snapshot.client_id}
          />
        </>
      ) : null}
    </main>
  );
}
