import { ClientSectionPlaceholder } from "../section-placeholder";

export default async function ClientReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ClientSectionPlaceholder clientId={id} section="review" />;
}
