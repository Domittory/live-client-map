import Link from "next/link";
import type { ClientAccessContext } from "@/lib/service/client-access";
import type { ClientRow } from "@/lib/service/clients";
import {
  CLIENT_SECTIONS,
  canUseSection,
  getClientSection,
  type ClientSectionKey,
} from "./workspace";

/**
 * Workspace header + section navigation (ticket 09, server component).
 *
 * Only sections the caller's effective access allows are rendered, so a
 * supervisor or read-only user never sees Owner/write entry points. The pages
 * repeat the same check server-side; navigation is never the only gate.
 */
export function ClientWorkspaceHeader({
  client,
  access,
  current,
}: {
  client: ClientRow;
  access: ClientAccessContext;
  current: ClientSectionKey;
}) {
  const visible = CLIENT_SECTIONS.filter((section) => canUseSection(access, section.key));

  return (
    <header>
      <p>
        <Link href="/clients">← Клиенты</Link>
      </p>
      <h1 data-testid="client-workspace-title">
        {client.display_name ?? client.first_name ?? "Клиент"}
      </h1>
      <p data-testid="client-workspace-status">Статус: {client.status}</p>
      <nav className="client-nav" aria-label="Разделы клиента">
        <ul>
          {visible.map((section) => (
            <li key={section.key}>
              <Link
                href={section.path(client.id)}
                aria-current={section.key === current ? "page" : undefined}
                data-section={section.key}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

/**
 * Section-level denial. Used when the client itself is accessible but the
 * caller's role does not allow the requested section: a neutral "no access"
 * state instead of an Owner-only control.
 */
export function ClientSectionDenied({ section }: { section: ClientSectionKey }) {
  return (
    <section data-testid="client-section-denied">
      <h2>{getClientSection(section).label}</h2>
      <p className="error">Недостаточно прав для этого раздела.</p>
      <p className="hint">Раздел доступен пользователям с более широкими правами на клиента.</p>
    </section>
  );
}
