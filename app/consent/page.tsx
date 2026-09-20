import Link from "next/link";
import { redirect } from "next/navigation";
import { listActiveClients } from "@/lib/service/clients";
import { createClient } from "@/lib/supabase/server";
import { CONSENT_TYPE_LABELS } from "./labels";

/**
 * Organization-level consent index (ticket 09).
 *
 * Consent is granted and revoked in the client workspace, so this page never
 * asks for a client id. Records are limited to clients the caller can actually
 * access, so an unassigned member sees no other tenant data through this list.
 */
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

  const clients = membership ? await listActiveClients(supabase, membership.organization_id) : [];
  const accessibleClientIds = clients.map((client) => client.id);
  const nameByClientId = new Map(
    clients.map((client) => [client.id, client.display_name ?? client.first_name ?? client.id])
  );

  const { data: records } =
    membership && accessibleClientIds.length > 0
      ? await supabase
          .from("consent_records")
          .select("id, client_id, consent_type, document_version, scope, granted_at, revoked_at")
          .eq("organization_id", membership.organization_id)
          .in("client_id", accessibleClientIds)
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
          {records.map((record) => (
            <li key={record.id}>
              <Link href={`/clients/${record.client_id}/consent`}>
                {nameByClientId.get(record.client_id) ?? "Клиент"}
              </Link>{" "}
              — {CONSENT_TYPE_LABELS[record.consent_type] ?? record.consent_type} (v
              {record.document_version}){record.revoked_at ? " — отозвано" : " — действует"}
            </li>
          ))}
        </ul>
      ) : (
        <p>Записей нет.</p>
      )}

      <h2>Управление согласиями</h2>
      <p className="hint">
        Согласиями управляют в контексте клиента — откройте клиента, вводить идентификатор не нужно.
      </p>
      {clients.length > 0 ? (
        <ul>
          {clients.map((client) => (
            <li key={client.id}>
              <Link href={`/clients/${client.id}/consent`}>
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
