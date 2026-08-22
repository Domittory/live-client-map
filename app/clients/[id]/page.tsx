import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClient } from "@/lib/service/clients";
import { ClientEditForm } from "./client-edit-form";

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClient(supabase, id);
  if (!client) notFound();

  return (
    <main className="shell">
      <h1>{client.display_name ?? client.first_name ?? "Клиент"}</h1>
      <p>
        <Link href="/clients">← Клиенты</Link>
      </p>
      <p>Статус: {client.status}</p>
      {client.client_visible_notes && <p>Заметка клиенту: {client.client_visible_notes}</p>}
      {client.specialist_notes_private && (
        <p>Приватная заметка: {client.specialist_notes_private}</p>
      )}

      <ClientEditForm
        clientId={id}
        displayName={client.display_name ?? ""}
        occupation={client.occupation ?? ""}
      />
    </main>
  );
}
