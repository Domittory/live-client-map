import { ClientSectionDenied, ClientWorkspaceHeader } from "./workspace-nav";
import {
  canUseSection,
  getClientSection,
  requireClientWorkspace,
  type ClientSectionKey,
} from "./workspace";

/**
 * Placeholder page for workspace sections owned by later tickets (diagnostics,
 * import, review, resources, purpose, recommendations). It still applies the
 * full access guard and the section rule, so the route is never a way around
 * the workspace authorization.
 */
export async function ClientSectionPlaceholder({
  clientId,
  section,
}: {
  clientId: string;
  section: ClientSectionKey;
}) {
  const { client, access } = await requireClientWorkspace(clientId);
  const definition = getClientSection(section);

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current={section} />
      {canUseSection(access, section) ? (
        <section data-testid="client-section-placeholder">
          <h2>{definition.label}</h2>
          <p className="hint">
            Раздел появится в следующем обновлении. Навигация рабочего пространства клиента уже
            работает.
          </p>
        </section>
      ) : (
        <ClientSectionDenied section={section} />
      )}
    </main>
  );
}
