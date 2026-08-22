import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccessForm } from "./access-form";

export default async function AccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assignments } = await supabase
    .from("client_assignments")
    .select("id, client_id, access_role, created_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <main className="shell">
      <h1>Доступ</h1>
      <p>
        <Link href="/">← Назад</Link>
      </p>

      <h2>Мои назначения</h2>
      {assignments && assignments.length > 0 ? (
        <ul>
          {assignments.map((a) => (
            <li key={a.id}>
              client {a.client_id.slice(0, 8)}… — {a.access_role}
              {a.revoked_at ? " (отозвано)" : ""}
            </li>
          ))}
        </ul>
      ) : (
        <p>Назначений нет.</p>
      )}

      <h2>Управление доступом</h2>
      <p className="hint">
        Полный выбор клиента и пользователя появится в тикете 17 (каталог клиентов).
      </p>
      <AccessForm />
    </main>
  );
}
