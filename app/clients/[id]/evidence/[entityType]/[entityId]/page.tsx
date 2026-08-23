import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getClient } from "@/lib/service/clients";
import { getEvidence, type EvidenceEntityType } from "@/lib/service/evidence";

export default async function EvidencePage({
  params,
}: {
  params: Promise<{ id: string; entityType: string; entityId: string }>;
}) {
  const { id, entityType, entityId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const client = await getClient(supabase, id);
  if (!client) notFound();

  if (!["core_node", "theme", "differential_hypothesis"].includes(entityType)) {
    notFound();
  }

  const evidence = await getEvidence(supabase, {
    organizationId: client.organization_id,
    clientId: id,
    entityType: entityType as EvidenceEntityType,
    entityId,
  });

  return (
    <main className="shell">
      <h1>Почему система так считает?</h1>
      <p>
        <Link href={`/clients/${id}/map`}>← Живая карта</Link>
      </p>
      <p>
        {evidence.label} ({evidence.entityType})
      </p>

      <section>
        <h2>Оценка</h2>
        {evidence.scoreBreakdown ? (
          <p>
            final priority: {evidence.scoreBreakdown.finalPriorityScore} (version{" "}
            {evidence.scoreBreakdown.version})
          </p>
        ) : (
          <p>Нет score breakdown.</p>
        )}
      </section>

      <section>
        <h2>Подтверждение человеком</h2>
        {evidence.humanConfirmations ? (
          <p>
            подтверждено {evidence.humanConfirmations.confirmedAt} (
            {evidence.humanConfirmations.confirmedBy})
          </p>
        ) : (
          <p>Не подтверждено человеком.</p>
        )}
      </section>

      <section>
        <h2>AI rationale</h2>
        <p>{evidence.aiRationale?.isAiProposed ? "AI-предложение (не подтверждено)" : "Нет"}</p>
      </section>

      <section>
        <h2>Raw signals</h2>
        {evidence.rawSignals.length === 0 ? (
          <p>Нет сырых сигналов.</p>
        ) : (
          <ul>
            {evidence.rawSignals.map((signal) => (
              <li key={signal.id}>
                {signal.raw_statement} — {signal.source_type} ({signal.evidence_level},{" "}
                {signal.review_status})
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Против / противоречия</h2>
        {evidence.contradictions.length === 0 ? (
          <p>Противоречий нет.</p>
        ) : (
          <ul>
            {evidence.contradictions.map((c) => (
              <li key={c.id}>
                {c.type}
                {c.description ? ` — ${c.description}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
