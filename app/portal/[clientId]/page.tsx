import { notFound, redirect } from "next/navigation";
import { getPortalOverview } from "@/lib/service/client-portal";
import { listPortalFeedbackForms } from "@/lib/service/feedback-forms";
import { createClient } from "@/lib/supabase/server";
import { PortalDenied, PortalView } from "../portal-view";

/**
 * Deep link into one client's portal (ticket 15, feedback ticket 16).
 *
 * The id in the URL is only accepted when it equals the client the portal
 * identity is actually bound to. A cross-client id renders the neutral 404 —
 * the identity's own published data is still resolved from the database, never
 * from the route, so a tampered URL can never widen access.
 */
export default async function PortalClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/portal/login");

  const overview = await getPortalOverview(supabase);
  if (!overview) return <PortalDenied email={user.email ?? ""} />;
  if (overview.clientId !== clientId) notFound();

  const forms = await listPortalFeedbackForms(supabase);

  return <PortalView overview={overview} forms={forms} />;
}
