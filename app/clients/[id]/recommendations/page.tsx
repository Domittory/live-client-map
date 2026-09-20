import {
  EVIDENCE_LEVEL_LABELS,
  INSUFFICIENT_DATA_LABEL,
  REVIEW_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  labelFor,
} from "@/lib/service/diagnostics-presentation";
import {
  CONTRADICTING_EVIDENCE_LABEL,
  DATA_LIMITS_LABEL,
  NO_CONTRADICTING_EVIDENCE_LABEL,
  SUPPORTING_EVIDENCE_LABEL,
} from "@/lib/service/model-review-presentation";
import {
  INSUFFICIENT_RANKING_LABEL,
  RANKING_FORMULA_NOTE,
  RANKING_LABEL,
  RECOMMENDATION_ROLE_LABELS,
  RECOMMENDATION_STATUS_LABELS,
  RECOMMENDATION_TARGET_KIND_LABELS,
  RECOMMENDATION_VISIBILITY_LABELS,
  canPublishRecommendation,
  canUnpublishRecommendation,
  isRecommendationReviewable,
  orderRecommendations,
  rankingExplanation,
  recommendationLimits,
} from "@/lib/service/recommendations-presentation";
import {
  getClientRecommendations,
  type RecommendationTargetView,
  type RecommendationView,
} from "@/lib/service/recommendations";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import {
  GenerateRecommendationsForm,
  RecommendationReviewForm,
  RecommendationVisibilityForm,
} from "./recommendations-forms";

/**
 * Client-scoped Recommendations screen (ticket 13, SPEC §16/§20/§36).
 *
 * The route id is the only client reference: the guard resolves the client
 * through RLS, the section rule is enforced server-side, and the read model is
 * loaded through RLS-protected tables. Every Recommendation is rendered with
 * (a) the evidence its targets reference, (b) the limits of that data and
 * (c) the full ranking explanation recomputed with the versioned scoring engine,
 * so the priority order is checkable rather than asserted.
 *
 * Human-in-the-loop: a draft Recommendation is reviewed with an explicit
 * approve/reject and a reason; a reviewed Recommendation shows no review control,
 * so a human decision is never silently re-decided. Publishing to the Client
 * Portal is a separate specialist control that the database refuses for an
 * unreviewed or high-risk Recommendation. Private specialist reasoning
 * (`rationale`, `risk_notes`, rank explanation) stays on this screen and is not
 * part of the client-visible projection of `lib/service/client-portal.ts`.
 */

function EvidenceTrailItemRow({ id, label, meta }: { id: string; label: string; meta?: string }) {
  return (
    <li data-testid="recommendation-evidence-item" data-evidence-id={id}>
      <p>{label}</p>
      {meta ? <p className="hint">{meta}</p> : null}
    </li>
  );
}

function TargetBlock({ target }: { target: RecommendationTargetView }) {
  return (
    <li data-testid="recommendation-target" data-target-id={target.targetId}>
      <p data-testid="recommendation-target-label">
        {target.kind
          ? `${labelFor(RECOMMENDATION_TARGET_KIND_LABELS, target.kind)}: ${target.label}`
          : `Цель недоступна: ${target.targetId}`}
      </p>
      <p className="hint" data-testid="recommendation-target-role">
        Роль: {labelFor(RECOMMENDATION_ROLE_LABELS, target.role)}
        {target.expectedEffect ? ` · Ожидаемый эффект: ${target.expectedEffect}` : ""}
      </p>

      {target.evidence ? (
        <div className="evidence-trail" data-testid="recommendation-target-evidence">
          <h5>{SUPPORTING_EVIDENCE_LABEL}</h5>
          {target.evidence.supporting.length === 0 ? (
            <p className="hint" data-testid="recommendation-target-no-supporting">
              {INSUFFICIENT_DATA_LABEL}: подтверждающих доказательств нет.
            </p>
          ) : (
            <ul data-testid="recommendation-target-supporting">
              {target.evidence.supporting.map((item) => (
                <EvidenceTrailItemRow
                  key={item.id}
                  id={item.id}
                  label={item.label}
                  meta={
                    item.kind === "signal"
                      ? `${labelFor(SOURCE_TYPE_LABELS, item.sourceType ?? null)} · ${labelFor(
                          EVIDENCE_LEVEL_LABELS,
                          item.evidenceLevel ?? null
                        )} · ${labelFor(REVIEW_STATUS_LABELS, item.reviewStatus ?? null)}`
                      : undefined
                  }
                />
              ))}
            </ul>
          )}

          <h5>{CONTRADICTING_EVIDENCE_LABEL}</h5>
          {target.evidence.contradicting.length === 0 ? (
            <p className="hint">{NO_CONTRADICTING_EVIDENCE_LABEL}</p>
          ) : (
            <ul data-testid="recommendation-target-contradicting">
              {target.evidence.contradicting.map((item) => (
                <EvidenceTrailItemRow key={item.id} id={item.id} label={item.label} />
              ))}
            </ul>
          )}

          <h5>{DATA_LIMITS_LABEL}</h5>
          <ul data-testid="recommendation-target-limits">
            {target.evidence.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="hint" data-testid="recommendation-target-no-evidence">
          {INSUFFICIENT_DATA_LABEL}: evidence по этой цели не прослеживается.
        </p>
      )}
    </li>
  );
}

function DecisionArea({
  clientId,
  recommendation,
  canWrite,
  subject,
}: {
  clientId: string;
  recommendation: RecommendationView;
  canWrite: boolean;
  subject: string;
}) {
  const publishability = {
    status: recommendation.status,
    humanReviewRequired: recommendation.humanReviewRequired,
    visibility: recommendation.visibility,
  };

  return (
    <div data-testid="recommendation-decision">
      {!canWrite ? (
        <p className="hint" data-testid="recommendation-read-only">
          Решение человека доступно специалистам с правом записи.
        </p>
      ) : isRecommendationReviewable(recommendation.status) ? (
        <RecommendationReviewForm
          clientId={clientId}
          recommendationId={recommendation.id}
          subject={subject}
        />
      ) : (
        <p className="hint" data-testid="recommendation-decided">
          Решение человека уже принято: рекомендация не изменяется повторным ревью.
        </p>
      )}

      {!canWrite ? null : canPublishRecommendation(publishability) ||
        canUnpublishRecommendation(publishability) ? (
        <RecommendationVisibilityForm
          clientId={clientId}
          recommendationId={recommendation.id}
          subject={subject}
          defaultVisibility={
            recommendation.visibility === "client_visible" ? "internal" : "client_visible"
          }
        />
      ) : (
        <p className="hint" data-testid="recommendation-visibility-blocked">
          Публикация клиенту недоступна: опубликовать можно только подтверждённую человеком
          рекомендацию без высокого риска.
        </p>
      )}
    </div>
  );
}

export default async function ClientRecommendationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "recommendations")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="recommendations" />
        <ClientSectionDenied section="recommendations" />
      </main>
    );
  }

  const recommendations = orderRecommendations(
    await getClientRecommendations(supabase, {
      organizationId: client.organization_id,
      clientId: id,
    })
  );
  const canWrite = access.canWrite;

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="recommendations" />

      <p className="hint" data-testid="recommendations-policy-note">
        Предложения AI остаются черновиками до явного решения человека, а ранжирование объяснимо:
        приоритет пересчитывается по версии scoring-модели и показан вместе с вкладом каждой оценки.
        Внутренние рассуждения специалиста (обоснование, заметки о риске) в клиентский портал не
        попадают.
      </p>

      {canWrite ? (
        <GenerateRecommendationsForm clientId={id} />
      ) : (
        <p className="hint" data-testid="recommendations-read-only">
          Доступ только для чтения: формирование, ревью и публикация рекомендаций недоступны.
        </p>
      )}

      <section>
        <h2>Рекомендации</h2>
        {recommendations.length === 0 ? (
          <p className="hint" data-testid="recommendations-empty">
            {INSUFFICIENT_DATA_LABEL}: рекомендации ещё не сформированы.
          </p>
        ) : (
          <ol data-testid="recommendation-list">
            {recommendations.map((recommendation) => {
              const explanation = rankingExplanation(recommendation.scores, {
                version: recommendation.scoringModelVersion,
                systemicLeverageScore: recommendation.systemicLeverageScore,
              });
              const limits = recommendationLimits({
                status: recommendation.status,
                targetCount: recommendation.targets.length,
                unresolvedTargetCount: recommendation.targets.filter(
                  (target) => target.kind === null || target.evidence === null
                ).length,
                supportingEvidenceCount: recommendation.targets.reduce(
                  (sum, target) => sum + (target.evidence?.supporting.length ?? 0),
                  0
                ),
                missingEvidence: recommendation.missingEvidence,
                finalPriorityScore: recommendation.finalPriorityScore,
                riskScore: recommendation.scores.riskScore,
                humanReviewRequired: recommendation.humanReviewRequired,
              });

              return (
                <li
                  key={recommendation.id}
                  data-testid="recommendation-card"
                  data-recommendation-id={recommendation.id}
                >
                  <h3 data-testid="recommendation-correction">
                    {recommendation.proposedCorrection}
                  </h3>
                  <ul className="signal-meta">
                    <li data-testid="recommendation-status">
                      Статус: {labelFor(RECOMMENDATION_STATUS_LABELS, recommendation.status)}
                    </li>
                    <li data-testid="recommendation-visibility">
                      Видимость:{" "}
                      {labelFor(RECOMMENDATION_VISIBILITY_LABELS, recommendation.visibility)}
                    </li>
                    <li data-testid="recommendation-priority">
                      Итоговый приоритет:{" "}
                      {recommendation.finalPriorityScore ?? INSUFFICIENT_DATA_LABEL}
                    </li>
                    <li data-testid="recommendation-leverage">
                      Системный эффект:{" "}
                      {recommendation.systemicLeverageScore ?? INSUFFICIENT_DATA_LABEL}
                    </li>
                    <li data-testid="recommendation-reviewed-at">
                      Решение принято: {recommendation.reviewedAt ?? "—"}
                    </li>
                  </ul>

                  <h4>{RANKING_LABEL}</h4>
                  <p className="hint" data-testid="recommendation-ranking-note">
                    {RANKING_FORMULA_NOTE}
                    {explanation.version ? ` Версия модели: ${explanation.version}.` : ""}
                  </p>
                  {explanation.explainable ? (
                    <table data-testid="recommendation-ranking">
                      <thead>
                        <tr>
                          <th>Оценка</th>
                          <th>Значение</th>
                          <th>Вес</th>
                          <th>Вклад</th>
                        </tr>
                      </thead>
                      <tbody>
                        {explanation.components.map((component) => (
                          <tr
                            key={component.key}
                            data-testid="recommendation-ranking-row"
                            data-component={component.key}
                          >
                            <td>{component.label}</td>
                            <td>{component.score}</td>
                            <td>{component.weight}</td>
                            <td>{component.contribution}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="hint" data-testid="recommendation-ranking-insufficient">
                      {INSUFFICIENT_RANKING_LABEL} Не заполнено:{" "}
                      {explanation.missingComponents.join(", ")}.
                    </p>
                  )}
                  {recommendation.rankRationale ? (
                    <p data-testid="recommendation-rank-rationale">
                      Обоснование порядка от AI: {recommendation.rankRationale}
                    </p>
                  ) : null}
                  <p className="hint" data-testid="recommendation-ranking-total">
                    Приоритет по формуле:{" "}
                    {explanation.finalPriorityScore ?? INSUFFICIENT_RANKING_LABEL}
                    {explanation.finalPriorityScore !== null &&
                    recommendation.finalPriorityScore !== null &&
                    explanation.finalPriorityScore !== recommendation.finalPriorityScore
                      ? ` (сохранённое значение ${recommendation.finalPriorityScore} не совпадает: проверьте версию scoring-модели)`
                      : ""}
                  </p>

                  <h4>Обоснование AI (внутреннее)</h4>
                  <p data-testid="recommendation-rationale">
                    {recommendation.rationale ??
                      `${INSUFFICIENT_DATA_LABEL}: обоснование не заполнено.`}
                  </p>
                  {recommendation.riskNotes ? (
                    <p data-testid="recommendation-risk-notes">
                      Заметки о риске (внутренние): {recommendation.riskNotes}
                    </p>
                  ) : null}

                  <h4>Ограничения данных</h4>
                  <ul data-testid="recommendation-limits">
                    {limits.limits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                  {!limits.hasEvidence ? (
                    <p className="error" data-testid="recommendation-insufficient">
                      {INSUFFICIENT_DATA_LABEL}: у рекомендации нет подтверждающих доказательств,
                      это предложение, а не вывод.
                    </p>
                  ) : null}

                  <h4>Цели и evidence</h4>
                  {recommendation.targets.length === 0 ? (
                    <p className="hint" data-testid="recommendation-no-targets">
                      {INSUFFICIENT_DATA_LABEL}: рекомендация не ссылается на цели.
                    </p>
                  ) : (
                    <ul data-testid="recommendation-targets">
                      {recommendation.targets.map((target) => (
                        <TargetBlock key={target.id} target={target} />
                      ))}
                    </ul>
                  )}

                  <DecisionArea
                    clientId={id}
                    recommendation={recommendation}
                    canWrite={canWrite}
                    subject={recommendation.proposedCorrection}
                  />
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
