import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listGoals, listRequests } from "@/lib/service/requests";
import { RequestsForms } from "./requests-forms";

export default async function ClientRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const requests = (await listRequests(supabase, membership.organization_id, id)) as Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
  }>;
  const goals = (await listGoals(supabase, membership.organization_id, id)) as Array<{
    id: string;
    title: string;
    status: string;
    importance: string;
  }>;

  return (
    <main className="shell">
      <h1>Запросы и цели</h1>
      <p>
        <Link href={`/clients/${id}`}>← Профиль клиента</Link>
      </p>

      <h2>Запросы</h2>
      {requests.length > 0 ? (
        <ul>
          {requests.map((r) => (
            <li key={r.id}>
              {r.title} — {r.status} ({r.priority})
            </li>
          ))}
        </ul>
      ) : (
        <p>Запросов нет.</p>
      )}

      <h2>Цели</h2>
      {goals.length > 0 ? (
        <ul>
          {goals.map((g) => (
            <li key={g.id}>
              {g.title} — {g.status} ({g.importance})
            </li>
          ))}
        </ul>
      ) : (
        <p>Целей нет.</p>
      )}

      <RequestsForms clientId={id} />
    </main>
  );
}
