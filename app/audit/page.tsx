import Link from "next/link";
import { redirect } from "next/navigation";
import { listAuditLog } from "@/lib/service/audit";
import { ServiceError } from "@/lib/service/errors";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuditPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: ownedOrg } = await supabase
    .from("organizations")
    .select("id, name")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!ownedOrg) {
    return (
      <main className="shell">
        <h1>Audit log</h1>
        <p>
          <Link href="/">← На главную</Link>
        </p>
        <p>Просмотр audit log доступен только владельцу организации.</p>
      </main>
    );
  }

  const entityType = first(params.entityType);
  const action = first(params.action);
  const cursor = first(params.cursor);

  const page = await listAuditLog(supabase, {
    organizationId: ownedOrg.id,
    ...(entityType ? { entityType } : {}),
    ...(action ? { action } : {}),
    ...(cursor ? { cursor } : {}),
  }).catch((err: unknown) => {
    if (err instanceof ServiceError && err.code === "FORBIDDEN") return null;
    throw err;
  });

  return (
    <main className="shell">
      <h1>Audit log — {ownedOrg.name}</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <form method="get">
        <label>
          Тип сущности
          <input type="text" name="entityType" defaultValue={entityType ?? ""} />
        </label>
        <label>
          Действие
          <input type="text" name="action" defaultValue={action ?? ""} />
        </label>
        <button type="submit">Фильтровать</button>
      </form>

      {!page || page.items.length === 0 ? (
        <p>Записей нет.</p>
      ) : (
        <>
          <ul>
            {page.items.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.action}</strong> — {entry.entity_type}
                {entry.entity_id ? ` ${entry.entity_id}` : ""}
                <br />
                <small>
                  {entry.created_at} · actor {entry.actor_user_id}
                  {entry.reason ? ` · ${entry.reason}` : ""}
                </small>
              </li>
            ))}
          </ul>
          {page.nextCursor ? (
            <p>
              <Link
                href={`/audit?entityType=${entityType ?? ""}&action=${action ?? ""}&cursor=${encodeURIComponent(page.nextCursor)}`}
              >
                Дальше →
              </Link>
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
