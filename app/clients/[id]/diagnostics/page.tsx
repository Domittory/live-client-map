import { ClientSectionPlaceholder } from "../section-placeholder";

export default async function ClientDiagnosticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientSectionPlaceholder clientId={id} section="diagnostics" />;
}
