import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCoreNode } from "@/lib/service/core-nodes";
import { listCoreNodeReactivations, type CoreNodeReactivation } from "@/lib/service/reactivation";
import { createClient } from "@/lib/supabase/server";
import { EvaluateReactivationButton, ReviewReactivationButtons } from "./reactivation-forms";

function ReactivationCard({
  proposal,
  canWrite,
}: {
  proposal: CoreNodeReactivation;
  canWrite: boolean;
}) {
  const calculation = proposal.calculation;
  return (
    <li>
      <p>
        <strong>Статус предложения:</strong> {proposal.status} | <strong>Версия scoring:</strong>{" "}
        {proposal.scoring_model_version} | <strong>Создано:</strong> {proposal.created_at}
      </p>
      <p>{proposal.reason}</p>
      <p>
        activation_score: {proposal.previous_activation_score ?? 0} →{" "}
        {proposal.proposed_activation_score} (порог {calculation.activationThreshold}, мин. прирост{" "}
        {calculation.minIncrease}, окно свежести {calculation.freshEvidenceWindowDays} дн.)
      </p>
      {calculation.triggerActivations.length > 0 ? (
        <p>
          Trigger activations:{" "}
          {calculation.triggerActivations
            .map((a) => `trigger ${a.triggerId} (+${a.activationDelta})`)
            .join(", ")}
        </p>
      ) : null}
      {calculation.signals.length > 0 ? (
        <p>
          Свежие сигналы:{" "}
          {calculation.signals.map((s) => `${s.id} (${s.evidenceLevel})`).join(", ")}
        </p>
      ) : null}
      <p>
        Исключено evidence: stale signals {calculation.excluded.staleSignals}, AI-only{" "}
        {calculation.excluded.aiOnlySignals}, неподтверждённые{" "}
        {calculation.excluded.notApprovedSignals}, stale trigger activations{" "}
        {calculation.excluded.staleTriggerActivations}
      </p>
      {proposal.decided_at ? (
        <p>
          Решение: {proposal.decided_at}
          {proposal.decided_by ? <> ({proposal.decided_by})</> : null}
        </p>
      ) : null}
      {canWrite && proposal.status === "pending" ? (
        <ReviewReactivationButtons
          reactivationId={proposal.id}
          coreNodeId={proposal.core_node_id}
        />
      ) : null}
    </li>
  );
}

export default async function CoreNodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const canWrite =
    membership?.status === "active" &&
    (membership.role === "owner" || membership.role === "specialist");

  let node;
  try {
    node = await getCoreNode(supabase, id);
  } catch {
    notFound();
  }

  const proposals = await listCoreNodeReactivations(supabase, {
    organizationId: node.organization_id,
    coreNodeId: node.id,
    limit: 50,
  });

  return (
    <main className="shell">
      <h1>{node.title}</h1>
      <p>
        <Link href={`/clients/${node.client_id}`}>← Клиент</Link>
      </p>

      <p>
        <strong>Статус:</strong> {node.status}
      </p>
      {node.activation_score !== null ? (
        <p>
          <strong>Activation score:</strong> {node.activation_score}
        </p>
      ) : null}
      {node.hypothesis ? (
        <p>
          <strong>Гипотеза:</strong> {node.hypothesis}
        </p>
      ) : null}
      {node.root_domain ? (
        <p>
          <strong>Root domain:</strong> {node.root_domain}
        </p>
      ) : null}

      <section>
        <h2>Reactivation</h2>
        {canWrite && node.status === "weakened" ? (
          <EvaluateReactivationButton coreNodeId={node.id} />
        ) : null}
        {proposals.items.length === 0 ? (
          <p>Предложений reactivation пока нет.</p>
        ) : (
          <ul>
            {proposals.items.map((proposal) => (
              <ReactivationCard key={proposal.id} proposal={proposal} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
