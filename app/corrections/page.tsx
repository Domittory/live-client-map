import Link from "next/link";
import { redirect } from "next/navigation";
import { listCorrections } from "@/lib/service/corrections";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CorrectionsPage({ searchParams }: { searchParams: SearchParams }) {
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
        <h1>Corrections</h1>
        <p>У вас нет активного членства в организации.</p>
        <p>
          <Link href="/">← На главную</Link>
        </p>
      </main>
    );
  }

  const clientId = first(params.clientId);
  const status = first(params.status);

  const corrections = await listCorrections(supabase, {
    organizationId: membership.organization_id,
    ...(clientId ? { clientId } : {}),
    ...(status ? { status } : {}),
  });

  return (
    <main className="shell">
      <h1>Corrections</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <form method="get">
        <label>
          Клиент (ID)
          <input type="text" name="clientId" defaultValue={clientId ?? ""} />
        </label>
        <label>
          Статус
          <select name="status" defaultValue={status ?? ""}>
            <option value="">Все</option>
            <option value="planned">Запланировано</option>
            <option value="in_progress">В процессе</option>
            <option value="completed">Завершено</option>
            <option value="cancelled">Отменено</option>
          </select>
        </label>
        <button type="submit">Найти</button>
      </form>

      {corrections.items.length === 0 ? (
        <p>Corrections не найдены.</p>
      ) : (
        <ul>
          {corrections.items.map((correction) => (
            <li key={correction.id}>
              <Link href={`/corrections/${correction.id}`}>
                <strong>{correction.title}</strong>
              </Link>{" "}
              <small>
                ({correction.status}, {correction.date}
                {correction.priority_score_before !== null
                  ? `, priority before: ${correction.priority_score_before.toFixed(1)}`
                  : ""}
                )
              </small>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
