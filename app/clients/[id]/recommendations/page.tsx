import { ClientSectionPlaceholder } from "../section-placeholder";

export default async function ClientRecommendationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ClientSectionPlaceholder clientId={id} section="recommendations" />;
}
