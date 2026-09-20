import { ConsentForm } from "@/app/consent/consent-form";
import { listClientConsents } from "@/lib/service/consent";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";

/**
 * Consent management inside the client context (ticket 09).
 *
 * Write access is required (primary/secondary specialist or Owner); the page
 * guard mirrors the database rule and the atomic consent RPCs re-check it.
 */
export default async function ClientConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "consent")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="consent" />
        <ClientSectionDenied section="consent" />
      </main>
    );
  }

  const consents = await listClientConsents(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="consent" />
      <section>
        <ConsentForm clientId={id} consents={consents} />
      </section>
    </main>
  );
}
