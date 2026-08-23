import Link from "next/link";
import { redirect } from "next/navigation";
import { listModelChanges } from "@/lib/service/model-changes";
import { ServiceError } from "@/lib/service/errors";
import {
  SNAPSHOT_CATEGORIES,
  compareWithPrevious,
  listSnapshots,
  type PsychologicalSnapshot,
  type SnapshotDiff,
  type SnapshotItem,
} from "@/lib/service/snapshots";
import { createClient } from "@/lib/supabase/server";
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
                  <li key={change.id}>
                    {change.occurred_at}: {change.entity_type} {change.entity_id} —{" "}
                    {change.change_reason} (evidence: {change.evidence_refs.length})
                  </li>
                ))}
              </ul>
            ) : (
              <p>Изменений модели пока нет.</p>
            )}
          </section>
        </>
      ) : (
        <p>Укажите ID клиента, чтобы увидеть версии snapshots и историю модели.</p>
      )}

      {comparisonError ? <p role="alert">{comparisonError}</p> : null}
      {comparison ? (
        <>
          <SnapshotDetail snapshot={comparison.snapshot} />
          <DiffSection changes={comparison.changes} />
        </>
      ) : null}
    </main>
  );
}
