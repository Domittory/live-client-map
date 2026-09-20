import { ClientSectionPlaceholder } from "../section-placeholder";

export default async function ClientResourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientSectionPlaceholder clientId={id} section="resources" />;
}
