import { listClientImports } from "@/lib/service/import";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import { ImportWorkflow } from "./import-forms";

/**
 * Client-scoped import screen (ticket 11).
 *
 * The route id is the only client reference: the guard resolves the client
 * through RLS and the section rule is enforced server-side, so a read-only or
 * unassigned user never reaches the upload controls. Preview and commit both go
 * through guarded atomic RPCs, and the import history is a plain RLS-filtered
 * read of the client's own imports.
 */
export default async function ClientImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "import")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="import" />
        <ClientSectionDenied section="import" />
      </main>
    );
  }

  const imports = await listClientImports(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="import" />
      <ImportWorkflow clientId={id} imports={imports} />
    </main>
  );
}
