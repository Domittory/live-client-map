import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ConsentForm } from "./consent-form";

export default async function ConsentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: records } = membership
    ? await supabase
        .from("consent_records")
        .select("id, client_id, consent_type, document_version, scope, granted_at, revoked_at")
        .eq("organization_id", membership.organization_id)
        .order("created_at", { ascending: false })
        .limit(50)
    : { data: null };

  return (
    <main className="shell">
      <h1>Согласия</h1>
      <p>
        <Link href="/">← Назад</Link>
      </p>

      <h2>Записи согласий</h2>
      {records && records.length > 0 ? (
        <ul>
          {records.map((r) => (
            <li key={r.id}>
              client {r.client_id.slice(0, 8)}… — {r.consent_type} (v{r.document_version})
              {r.revoked_at ? " — отозвано" : " — действует"}
            </li>
          ))}
        </ul>
      ) : (
        <p>Записей нет.</p>
      )}

      <h2>Управление согласиями</h2>
      <p className="hint">Полный выбор клиента появится в тикете 17 (каталог клиентов).</p>
      <ConsentForm />
    </main>
  );
}
