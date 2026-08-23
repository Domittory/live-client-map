import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCorrection } from "@/lib/service/corrections";
import { listFollowUps, type FollowUp } from "@/lib/service/follow-ups";
import { createClient } from "@/lib/supabase/server";
import { ArchiveCorrectionButton, UpdateCorrectionForm } from "../forms";
import {
  CancelFollowUpButton,
  CompleteFollowUpForm,
  EvaluateCorrectionButton,
  ReviewAssessmentButtons,
  ScheduleFollowUpForm,
} from "./follow-ups-forms";

function FollowUpCard({ followUp, canWrite }: { followUp: FollowUp; canWrite: boolean }) {
  const assessment = followUp.ai_assessment;
  return (
    <li>
      <p>
        <strong>Статус:</strong> {followUp.result_status} | <strong>Запланирован:</strong>{" "}
        {followUp.scheduled_at}
        {followUp.completed_at ? (
          <>
            {" "}
            | <strong>Заполнен:</strong> {followUp.completed_at}
          </>
        ) : null}
      </p>
      {followUp.retest_result ? <p>Retest: {followUp.retest_result.summary}</p> : null}
      {followUp.behavioral_result ? (
        <p>Поведенческий результат: {followUp.behavioral_result.summary}</p>
      ) : null}
      {followUp.client_feedback ? <p>Отзыв клиента: {followUp.client_feedback.summary}</p> : null}
      {followUp.specialist_assessment ? (
        <p>Оценка специалиста: {followUp.specialist_assessment.summary}</p>
      ) : null}
      {assessment ? (
        <section>
          <p>
            <strong>AI-оценка ({assessment.approval_status}):</strong>{" "}
            {assessment.proposed_result_status}
            {assessment.confidence !== null ? `, confidence ${assessment.confidence}` : ""}
            {assessment.source === "deterministic_guard" ? " (недостаточно данных)" : ""}
          </p>
          <p>{assessment.rationale}</p>
          {assessment.missing_evidence.length > 0 ? (
            <p>Недостающие данные: {assessment.missing_evidence.join(", ")}</p>
          ) : null}
          {assessment.proposed_core_node_status ? (
            <p>
              Предложенный статус CoreNode (не применяется): {assessment.proposed_core_node_status}
            </p>
          ) : null}
          {canWrite && assessment.approval_status === "pending" ? (
            <ReviewAssessmentButtons
              followUpId={followUp.id}
              correctionId={followUp.correction_id}
              proposedStatus={assessment.proposed_result_status}
            />
          ) : null}
        </section>
      ) : null}
      {canWrite && followUp.result_status === "scheduled" ? (
        <>
          <CompleteFollowUpForm followUpId={followUp.id} correctionId={followUp.correction_id} />
          <CancelFollowUpButton followUpId={followUp.id} correctionId={followUp.correction_id} />
        </>
      ) : null}
      {canWrite && followUp.result_status === "completed" && !assessment ? (
        <EvaluateCorrectionButton followUpId={followUp.id} correctionId={followUp.correction_id} />
      ) : null}
    </li>
  );
}

export default async function CorrectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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

  let correction;
  try {
    correction = await getCorrection(supabase, id);
  } catch {
    notFound();
  }

  const followUps = await listFollowUps(supabase, {
    organizationId: correction.organization_id,
    correctionId: correction.id,
    limit: 50,
  });

  return (
    <main className="shell">
      <h1>{correction.title}</h1>
      <p>
        <Link href="/corrections">← Список corrections</Link>
      </p>

      <p>
        <strong>Статус:</strong> {correction.status}
      </p>
      <p>
        <strong>Дата:</strong> {correction.date}
      </p>
      {correction.priority_score_before !== null ? (
        <p>
          <strong>Priority score before:</strong> {correction.priority_score_before.toFixed(1)}
        </p>
      ) : null}
      {correction.rationale ? (
        <p>
          <strong>Обоснование:</strong> {correction.rationale}
        </p>
      ) : null}
      {correction.expected_effect ? (
        <p>
          <strong>Ожидаемый эффект:</strong> {correction.expected_effect}
        </p>
      ) : null}
      {correction.specialist_notes ? (
        <p>
          <strong>Заметки специалиста:</strong> {correction.specialist_notes}
        </p>
      ) : null}
      {correction.client_visible_summary ? (
        <p>
          <strong>Сводка для клиента:</strong> {correction.client_visible_summary}
        </p>
      ) : null}

      <section>
        <h2>Targets</h2>
        {correction.targets.length === 0 ? (
          <p>Нет targets.</p>
        ) : (
          <ul>
            {correction.targets.map((target) => (
              <li key={target.id}>
                {target.role}: {target.target_type} {target.target_id}
                {target.expected_effect ? <> — {target.expected_effect}</> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Expected markers</h2>
        {correction.expected_markers.length === 0 ? (
          <p>Нет ожидаемых маркеров.</p>
        ) : (
          <ul>
            {correction.expected_markers.map((marker) => (
              <li key={marker.id}>
                {marker.marker}
                {marker.life_area ? <> ({marker.life_area})</> : null}: {marker.expected_direction},{" "}
                {marker.measurement_type}
                {marker.baseline_value ? <> baseline {marker.baseline_value}</> : null}
                {marker.target_value ? <> → {marker.target_value}</> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Follow-ups</h2>
        {canWrite && (correction.status === "in_progress" || correction.status === "completed") ? (
          <ScheduleFollowUpForm
            organizationId={correction.organization_id}
            clientId={correction.client_id}
            correctionId={correction.id}
          />
        ) : null}
        {followUps.items.length === 0 ? (
          <p>Follow-ups пока нет.</p>
        ) : (
          <ul>
            {followUps.items.map((followUp) => (
              <FollowUpCard key={followUp.id} followUp={followUp} canWrite={canWrite} />
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section>
          <h2>Управление</h2>
          <UpdateCorrectionForm correction={correction} />
          <ArchiveCorrectionButton correctionId={correction.id} />
        </section>
      ) : null}
    </main>
  );
}
