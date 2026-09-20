import { listPortalUsers } from "@/lib/service/client-portal";
import { listClientConsents } from "@/lib/service/consent";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import { PortalAccessForm } from "./portal-access-form";

/**
 * Client Portal access management inside the client context (ticket 15).
 *
 * The specialist grants an invitation-only portal identity here. The database
 * is the final authority: `create_portal_user` re-checks write access and the
 * `client_portal` consent, and `revoke_portal_user` takes effect on the client's
 * next request. The page only reflects that state (RLS-scoped read).
 */
export default async function ClientPortalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "portal")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="portal" />
        <ClientSectionDenied section="portal" />
      </main>
    );
  }

  const [portalUsers, consents] = await Promise.all([
    listPortalUsers(supabase, { clientId: id }),
    listClientConsents(supabase, { organizationId: client.organization_id, clientId: id }),
  ]);
  const consentActive = consents.some(
    (consent) => consent.consentType === "client_portal" && consent.isActive
  );

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="portal" />
      <section>
        <PortalAccessForm clientId={id} portalUsers={portalUsers} consentActive={consentActive} />
      </section>
    </main>
  );
}
