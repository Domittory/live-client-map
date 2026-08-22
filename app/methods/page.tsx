import Link from "next/link";
import { redirect } from "next/navigation";
import { listMethods } from "@/lib/service/interventions";
import { createClient } from "@/lib/supabase/server";
import { ArchiveMethodButton, CreateMethodForm, EditMethodForm } from "./forms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function MethodsPage({ searchParams }: { searchParams: SearchParams }) {
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

  const q = first(params.q);
  const scope = first(params.scope);
  const editId = first(params.edit);

  const methods = await listMethods(supabase, {
    ...(q ? { q } : {}),
    ...(scope ? { scope } : {}),
  });

  const canWrite =
    membership?.status === "active" &&
    (membership.role === "owner" || membership.role === "specialist");
  const editedMethod = editId ? methods.items.find((method) => method.id === editId) : undefined;

  return (
    <main className="shell">
      <h1>Библиотека методов коррекции</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <form method="get">
        <label>
          Поиск
          <input type="search" name="q" defaultValue={q ?? ""} />
        </label>
        <label>
          Источник
          <select name="scope" defaultValue={scope ?? "all"}>
            <option value="all">Все</option>
            <option value="system">Системные</option>
            <option value="organization">Организации</option>
          </select>
        </label>
        <button type="submit">Найти</button>
      </form>

      {methods.items.length === 0 ? (
        <p>Данных недостаточно: методы не найдены.</p>
      ) : (
        <ul>
          {methods.items.map((method) => (
            <li key={method.id}>
              <strong>{method.name}</strong>{" "}
              <small>
                ({method.is_system ? "системный" : "организации"}
                {method.category ? `, ${method.category}` : ""}
                {method.default_follow_up_days !== null
                  ? `, follow-up ${method.default_follow_up_days} дн.`
                  : ""}
                )
              </small>
              {method.description ? <p>{method.description}</p> : null}
              {method.contraindications.length > 0 ? (
                <p>
                  <small>Противопоказания: {method.contraindications.join("; ")}</small>
                </p>
              ) : null}
              {!method.is_system && canWrite ? (
                <p>
                  <Link href={`/methods?edit=${method.id}`}>Редактировать</Link>{" "}
                  <ArchiveMethodButton methodId={method.id} />
                </p>
              ) : null}
              {editedMethod?.id === method.id ? <EditMethodForm method={method} /> : null}
            </li>
          ))}
        </ul>
      )}

      {canWrite && membership ? (
        <section>
          <h2>Новый метод организации</h2>
          <CreateMethodForm organizationId={membership.organization_id} />
        </section>
      ) : null}
    </main>
  );
}
