import { AccessForm } from "@/app/access/access-form";
import { listMembers } from "@/lib/service/admin";
import { listClientAssignments } from "@/lib/service/client-access";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";

/**
 * Access management inside the client context (ticket 09).
 *
 * The client id comes from the route; the Owner grants and revokes assignments
 * without typing an id. Non-Owner roles get a neutral denied state, and the
 * database RPC is the final authority on every mutation.
 */
export default async function ClientAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "access")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="access" />
        <ClientSectionDenied section="access" />
      </main>
    );
  }

  const [assignments, directory] = await Promise.all([
    listClientAssignments(supabase, { organizationId: client.organization_id, clientId: id }),
    listMembers(supabase, client.organization_id),
  ]);

  const members = directory.members
    .filter((member) => member.status === "active")
    .map((member) => ({ userId: member.userId, email: member.email }));
  const ownerUserId = directory.members.find((member) => member.isOwner)?.userId ?? null;

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="access" />
      <section>
        <AccessForm
          clientId={id}
          members={members}
          assignments={assignments}
          ownerUserId={ownerUserId}
        />
      </section>
    </main>
  );
}
