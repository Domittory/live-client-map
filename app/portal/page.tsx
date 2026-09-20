import { redirect } from "next/navigation";
import { getPortalOverview } from "@/lib/service/client-portal";
import { createClient } from "@/lib/supabase/server";
import { PortalDenied, PortalView } from "./portal-view";

/**
 * Client Portal home (ticket 15).
 *
 * The route carries no client id: the projection is derived from the signed-in
 * portal identity, so there is nothing in the URL a client could tamper with to
 * reach another client. A signed-in identity without active portal access gets
 * the same neutral denial for "never granted", "revoked" and "consent
 * withdrawn".
 */
export default async function PortalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const overview = await getPortalOverview(supabase);
  if (!overview) return <PortalDenied email={user.email ?? ""} />;

  return <PortalView overview={overview} />;
}
