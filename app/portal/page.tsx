import { redirect } from "next/navigation";
import { getPortalOverview } from "@/lib/service/client-portal";
import { listPortalFeedbackForms } from "@/lib/service/feedback-forms";
import { createClient } from "@/lib/supabase/server";
import { PortalDenied, PortalView } from "./portal-view";

/**
 * Client Portal home (ticket 15, feedback ticket 16).
 *
 * The route carries no client id: the projection is derived from the signed-in
 * portal identity, so there is nothing in the URL a client could tamper with to
 * reach another client. A signed-in identity without active portal access gets
 * the same neutral denial for "never granted", "revoked" and "consent
 * withdrawn".
 *
 * The feedback forms come from their own guarded RPC and are fetched only after
 * the overview proved there is active portal access, so a denied identity never
 * triggers a second read that could distinguish denial from "no forms".
 */
export default async function PortalPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const overview = await getPortalOverview(supabase);
  if (!overview) return <PortalDenied email={user.email ?? ""} />;

  const forms = await listPortalFeedbackForms(supabase);

  return <PortalView overview={overview} forms={forms} />;
}
