import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listActiveClients } from "@/lib/service/clients";
import { ClientCreateForm } from "./client-create-form";

export default async function ClientsPage() {
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
  if (!membership) redirect("/login");

  const clients = await listActiveClients(supabase, membership.organization_id);

  return (
    <main className="shell">
      <h1>Клиенты</h1>
      <p>
        <Link href="/">← Назад</Link>
      </p>

      <h2>Активные клиенты</h2>
      {clients.length > 0 ? (
        <ul>
          {clients.map((c) => (
            <li key={c.id}>
              <Link href={`/clients/${c.id}`}>{c.display_name ?? c.first_name ?? c.id}</Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>Клиентов нет.</p>
      )}

      <h2>Новый клиент</h2>
      <ClientCreateForm />
    </main>
  );
}
