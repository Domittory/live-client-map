import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveClients } from "@/lib/service/clients";
import { createClient } from "@/lib/supabase/server";
import { ACCESS_ROLE_LABELS } from "./labels";

/**
 * Organization-level access index (ticket 09).
 *
 * Grants and revokes now live in the client workspace, so this page never asks
 * for a client id: it lists the caller's own assignments and links into the
 * access section of each accessible client.
 */
export default async function AccessPage() {
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

  const { data: assignments } = await supabase
    .from("client_assignments")
    .select("id, client_id, access_role, created_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const clients = membership ? await listActiveClients(supabase, membership.organization_id) : [];
  const nameByClientId = new Map(
    clients.map((client) => [client.id, client.display_name ?? client.first_name ?? client.id])
  );

  return (
    <main className="shell">
      <h1>Доступ</h1>
      <p>
        <Link href="/">← Назад</Link>
      </p>

      <h2>Мои назначения</h2>
      {assignments && assignments.length > 0 ? (
        <ul>
          {assignments.map((assignment) => (
            <li key={assignment.id}>
              {assignment.revoked_at ? (
                <>
                  Доступ отозван (
                  {ACCESS_ROLE_LABELS[assignment.access_role] ?? assignment.access_role})
                </>
              ) : (
                <>
                  <Link href={`/clients/${assignment.client_id}`}>
                    {nameByClientId.get(assignment.client_id) ?? "Клиент"}
                  </Link>{" "}
                  — {ACCESS_ROLE_LABELS[assignment.access_role] ?? assignment.access_role}
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>Назначений нет.</p>
      )}

      <h2>Управление доступом</h2>
      <p className="hint">
        Доступом управляют в контексте клиента — откройте клиента, вводить идентификатор не нужно.
      </p>
      {clients.length > 0 ? (
        <ul>
          {clients.map((client) => (
            <li key={client.id}>
              <Link href={`/clients/${client.id}/access`}>
                {client.display_name ?? client.first_name ?? "Клиент"}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>Доступных клиентов нет.</p>
      )}
    </main>
  );
}
