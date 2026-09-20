import Link from "next/link";
import { listGoals, listRequests } from "@/lib/service/requests";
import { RequestsForms } from "./requests-forms";
import { requireClientWorkspace } from "../workspace";
import { ClientWorkspaceHeader } from "../workspace-nav";

export default async function ClientRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Shared workspace guard: unassigned/unauthorized callers get the neutral
  // denial before any client data is read.
  const { supabase, client, access } = await requireClientWorkspace(id);

  const requests = (await listRequests(supabase, client.organization_id, id)) as Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
  }>;
  const goals = (await listGoals(supabase, client.organization_id, id)) as Array<{
    id: string;
    title: string;
    status: string;
    importance: string;
  }>;

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="requests" />
      <h2>Запросы и цели</h2>
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
