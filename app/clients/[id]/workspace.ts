import { notFound, redirect } from "next/navigation";
import { getClientAccessContext, type ClientAccessContext } from "@/lib/service/client-access";
import { getClient, type ClientRow } from "@/lib/service/clients";
import { createClient } from "@/lib/supabase/server";

/**
 * Client-scoped workspace guard (ticket 09).
 *
 * Authorization truth lives in the database: `getClient` is filtered by the
 * `clients` RLS policy (`is_client_accessible`), so an unassigned member and a
 * client that does not exist are indistinguishable — `notFound()` denies both
 * without leaking a name, a status or any other client metadata.
 */

export type ClientSectionKey =
  | "overview"
  | "requests"
  | "map"
  | "diagnostics"
  | "review"
  | "resources"
  | "purpose"
  | "recommendations"
  | "portal"
  | "feedback"
  | "import"
  | "export"
  | "consent"
  | "access";

export interface ClientSection {
  key: ClientSectionKey;
  label: string;
  /** Relative path of the section inside the client workspace. */
  path: (clientId: string) => string;
  /** Minimum access the section needs; the nav and the page both honour it. */
  requires: "read" | "write" | "owner";
}

export const CLIENT_SECTIONS: ClientSection[] = [
  { key: "overview", label: "Обзор", path: (id) => `/clients/${id}`, requires: "read" },
  {
    key: "requests",
    label: "Запросы и цели",
    path: (id) => `/clients/${id}/requests`,
    requires: "read",
  },
  { key: "map", label: "Живая карта", path: (id) => `/clients/${id}/map`, requires: "read" },
  {
    key: "diagnostics",
    label: "Диагностика",
    path: (id) => `/clients/${id}/diagnostics`,
    requires: "read",
  },
  {
    key: "review",
    label: "Ревью модели",
    path: (id) => `/clients/${id}/review`,
    requires: "write",
  },
  {
    key: "resources",
    label: "Ресурсы",
    path: (id) => `/clients/${id}/resources`,
    requires: "read",
  },
  {
    key: "purpose",
    label: "Цель и смысл",
    path: (id) => `/clients/${id}/purpose`,
    requires: "read",
  },
  {
    key: "recommendations",
    label: "Рекомендации",
    path: (id) => `/clients/${id}/recommendations`,
    requires: "read",
  },
  {
    key: "portal",
    label: "Портал клиента",
    path: (id) => `/clients/${id}/portal`,
    requires: "write",
  },
  {
    key: "feedback",
    label: "Обратная связь",
    path: (id) => `/clients/${id}/feedback`,
    requires: "write",
  },
  { key: "import", label: "Импорт", path: (id) => `/clients/${id}/import`, requires: "write" },
  {
    // A full archive is Owner-only (docs §11), so the section and the form inside
    // it are Owner-gated. The HTTP route enforces the same rule through
    // `request_export`, which re-asserts tenant, assignment, audience and consent.
    key: "export",
    label: "Экспорт",
    path: (id) => `/clients/${id}/export`,
    requires: "owner",
  },
  { key: "consent", label: "Согласия", path: (id) => `/clients/${id}/consent`, requires: "write" },
  { key: "access", label: "Доступ", path: (id) => `/clients/${id}/access`, requires: "owner" },
];

export function getClientSection(section: ClientSectionKey): ClientSection {
  const found = CLIENT_SECTIONS.find((entry) => entry.key === section);
  if (!found) throw new Error(`Unknown client section: ${section}`);
  return found;
}

/** Whether the effective access allows this section (nav and page share the rule). */
export function canUseSection(access: ClientAccessContext, section: ClientSectionKey): boolean {
  const { requires } = getClientSection(section);
  if (requires === "owner") return access.isOwner;
  if (requires === "write") return access.canWrite;
  return access.canRead;
}

export interface ClientWorkspace {
  supabase: Awaited<ReturnType<typeof createClient>>;
  client: ClientRow;
  access: ClientAccessContext;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authenticate, load the client behind RLS and resolve the effective access.
 * Callers must use this before touching any client metadata or mutation.
 */
export async function requireClientWorkspace(clientId: string): Promise<ClientWorkspace> {
  // A malformed id is a denial, not a database error: it renders the same
  // neutral page as a client the caller may not see.
  if (!UUID_PATTERN.test(clientId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClient(supabase, clientId);
  if (!client) notFound();

  const access = await getClientAccessContext(supabase, client.organization_id, clientId);
  // Defense in depth: RLS already withheld the row, but the workspace is never
  // rendered without an explicit database grant.
  if (!access.canRead) notFound();

  return { supabase, client, access };
}
