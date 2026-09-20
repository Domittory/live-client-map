import type { ReactNode } from "react";
import {
  getModelReview,
  type EvidenceTrailItem,
  type ReviewEvidenceTrail,
} from "@/lib/service/model-review";
import {
  EVIDENCE_LEVEL_LABELS,
  INSUFFICIENT_DATA_LABEL,
  REVIEW_STATUS_LABELS,
  SOURCE_TYPE_LABELS,
  labelFor,
} from "@/lib/service/diagnostics-presentation";
import {
  CONTRADICTING_EVIDENCE_LABEL,
  CORE_NODE_STATUS_LABELS,
  DATA_LIMITS_LABEL,
  HYPOTHESIS_STATUS_LABELS,
  NO_CONTRADICTING_EVIDENCE_LABEL,
  RELATION_TYPE_LABELS,
  SUPPORTING_EVIDENCE_LABEL,
  THEME_REVIEW_STATUS_LABELS,
  isReviewable,
} from "@/lib/service/model-review-presentation";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import { CoreNodeReviewForm, HypothesisReviewForm, ThemeReviewForm } from "./review-forms";

/**
 * Client-scoped model review screen (ticket 12, SPEC §36).
 *
 * The route id is the only client reference: the guard resolves the client
 * through RLS, the section rule is enforced server-side, and the read model is
 * loaded through RLS-protected tables. The screen shows Themes with their Signal
 * links, CoreNodes with their Theme links and every competing
 * DifferentialHypothesis — never an automatically chosen winner. Every
 * conclusion is rendered together with its Evidence Trail (supporting AND
 * contradicting evidence) and the limits of the data, so a bare conclusion can
 * never appear. Approve/reject controls are rendered only for entities whose
 * state still awaits a human decision, and each mutation still goes through a
 * guarded atomic RPC that resolves the actor in the database.
 */

function EvidenceTrailItemRow({ item }: { item: EvidenceTrailItem }) {
  return (
    <li data-testid="evidence-item" data-evidence-id={item.id}>
      <p data-testid="evidence-item-label">{item.label}</p>
      {item.kind === "signal" ? (
        <p className="hint" data-testid="evidence-item-meta">
          {labelFor(SOURCE_TYPE_LABELS, item.sourceType ?? null)} ·{" "}
          {labelFor(EVIDENCE_LEVEL_LABELS, item.evidenceLevel ?? null)} ·{" "}
          {labelFor(REVIEW_STATUS_LABELS, item.reviewStatus ?? null)}
        </p>
      ) : null}
      {item.relatedLabel ? <p className="hint">Связь: {item.relatedLabel}</p> : null}
    </li>
  );
}

function EvidenceTrail({ trail }: { trail: ReviewEvidenceTrail }) {
  return (
    <div className="evidence-trail" data-testid="evidence-trail">
      <h4>{SUPPORTING_EVIDENCE_LABEL}</h4>
      {trail.supporting.length === 0 ? (
        <p className="hint" data-testid="no-supporting-evidence">
          {INSUFFICIENT_DATA_LABEL}: подтверждающих доказательств нет.
        </p>
      ) : (
        <ul data-testid="supporting-evidence">
          {trail.supporting.map((item) => (
            <EvidenceTrailItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      <h4>{CONTRADICTING_EVIDENCE_LABEL}</h4>
      {trail.contradicting.length === 0 ? (
        <p className="hint" data-testid="no-contradicting-evidence">
          {NO_CONTRADICTING_EVIDENCE_LABEL}
        </p>
      ) : (
        <ul data-testid="contradicting-evidence">
          {trail.contradicting.map((item) => (
            <EvidenceTrailItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      <h4>{DATA_LIMITS_LABEL}</h4>
      <ul data-testid="data-limits">
        {trail.limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
    </div>
  );
}

function DecisionBlock({
  canWrite,
  reviewable,
  form,
  confirmedLabel,
}: {
  canWrite: boolean;
  reviewable: boolean;
  form: ReactNode;
  confirmedLabel: string;
}) {
  if (!canWrite) {
    return (
      <p className="hint" data-testid="review-read-only">
        Решение человека доступно специалистам с правом записи.
      </p>
    );
  }
  if (!reviewable) {
    return (
      <p className="hint" data-testid="review-decided">
        {confirmedLabel}
      </p>
    );
  }
  return form;
}

export default async function ClientReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "review")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="review" />
        <ClientSectionDenied section="review" />
      </main>
    );
  }

  const review = await getModelReview(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });
  const canWrite = access.canWrite;

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="review" />

      <p className="hint" data-testid="review-policy-note">
        Предложения AI остаются в статусе ревью (L0) до явного решения человека. Подтверждённые
        человеком сущности AI не изменяет молча, а каждая conclusion показана вместе с
        подтверждающими и противоречащими доказательствами и ограничениями данных.
      </p>

      <section>
        <h2>Темы и связи с сигналами</h2>
        {review.themes.length === 0 ? (
          <p className="hint" data-testid="review-no-themes">
            {INSUFFICIENT_DATA_LABEL}: тем пока нет.
          </p>
        ) : (
          <ul data-testid="review-themes">
            {review.themes.map((theme) => (
              <li key={theme.id} data-testid="review-theme" data-theme-id={theme.id}>
                <h3 data-testid="review-theme-name">{theme.name}</h3>
                <ul className="signal-meta">
                  <li data-testid="review-theme-status">
                    Ревью: {labelFor(THEME_REVIEW_STATUS_LABELS, theme.reviewStatus)}
                  </li>
                  <li data-testid="review-theme-counts">
                    Подтверждённых сигналов: {theme.evidenceCount}, независимых контекстов:{" "}
                    {theme.independentEvidenceCount}
                  </li>
                </ul>
                {theme.description ? <p>{theme.description}</p> : null}

                <h4>Связи с сигналами</h4>
                {theme.signalLinks.length === 0 ? (
                  <p className="hint" data-testid="review-theme-no-signals">
                    {INSUFFICIENT_DATA_LABEL}: сигналы к теме не привязаны.
                  </p>
                ) : (
                  <ul data-testid="review-theme-signal-links">
                    {theme.signalLinks.map((link) => (
                      <li key={link.signalId} data-testid="review-theme-signal-link">
                        <p>{link.rawStatement}</p>
                        <p className="hint">
                          {labelFor(SOURCE_TYPE_LABELS, link.sourceType)} ·{" "}
                          {labelFor(EVIDENCE_LEVEL_LABELS, link.evidenceLevel)} ·{" "}
                          {labelFor(REVIEW_STATUS_LABELS, link.reviewStatus)}
                        </p>
                        {link.linkRationale ? (
                          <p className="hint">Обоснование связи: {link.linkRationale}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                <EvidenceTrail trail={theme.trail} />
                <DecisionBlock
                  canWrite={canWrite}
                  reviewable={isReviewable("theme", theme.reviewStatus)}
                  confirmedLabel="Решение по теме уже принято человеком."
                  form={<ThemeReviewForm clientId={id} themeId={theme.id} />}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Ключевые узлы и связи с темами</h2>
        {review.coreNodes.length === 0 ? (
          <p className="hint" data-testid="review-no-core-nodes">
            {INSUFFICIENT_DATA_LABEL}: ключевых узлов пока нет.
          </p>
        ) : (
          <ul data-testid="review-core-nodes">
            {review.coreNodes.map((node) => (
              <li key={node.id} data-testid="review-core-node" data-core-node-id={node.id}>
                <h3 data-testid="review-core-node-title">{node.title}</h3>
                {node.hypothesis ? <p>{node.hypothesis}</p> : null}
                <ul className="signal-meta">
                  <li data-testid="review-core-node-status">
                    Статус: {labelFor(CORE_NODE_STATUS_LABELS, node.status)}
                  </li>
                  <li data-testid="review-core-node-confidence">
                    Уверенность: {node.confidenceScore ?? "—"}
                  </li>
                  <li data-testid="review-core-node-confirmed">
                    Подтверждён человеком: {node.lastConfirmedAt ? "да" : "нет"}
                  </li>
                </ul>

                <h4>Связи с темами</h4>
                {node.themeLinks.length === 0 ? (
                  <p className="hint" data-testid="review-core-node-no-themes">
                    {INSUFFICIENT_DATA_LABEL}: темы к узлу не привязаны.
                  </p>
                ) : (
                  <ul data-testid="review-core-node-theme-links">
                    {node.themeLinks.map((link) => (
                      <li key={link.themeId} data-testid="review-core-node-theme-link">
                        <p>
                          {link.themeName} — {labelFor(RELATION_TYPE_LABELS, link.relationshipType)}
                        </p>
                        {link.linkRationale ? (
                          <p className="hint">Обоснование связи: {link.linkRationale}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}

                <EvidenceTrail trail={node.trail} />
                <DecisionBlock
                  canWrite={canWrite}
                  reviewable={isReviewable("core_node", node.status)}
                  confirmedLabel="Решение по узлу уже принято человеком."
                  form={<CoreNodeReviewForm clientId={id} coreNodeId={node.id} />}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Конкурирующие гипотезы</h2>
        <p className="hint" data-testid="review-hypotheses-note">
          Система не выбирает победителя автоматически. Подтверждение одной гипотезы не удаляет
          остальные гипотезы и противоречащие доказательства.
        </p>
        {review.hypotheses.length === 0 ? (
          <p className="hint" data-testid="review-no-hypotheses">
            {INSUFFICIENT_DATA_LABEL}: гипотез пока нет.
          </p>
        ) : (
          <ul data-testid="review-hypotheses">
            {review.hypotheses.map((hypothesis) => (
              <li
                key={hypothesis.id}
                data-testid="review-hypothesis"
                data-hypothesis-id={hypothesis.id}
              >
                <h3 data-testid="review-hypothesis-title">{hypothesis.title}</h3>
                {hypothesis.description ? <p>{hypothesis.description}</p> : null}
                <ul className="signal-meta">
                  <li data-testid="review-hypothesis-status">
                    Статус: {labelFor(HYPOTHESIS_STATUS_LABELS, hypothesis.status)}
                  </li>
                  <li data-testid="review-hypothesis-confidence">
                    Уверенность: {hypothesis.confidenceScore ?? "—"}
                  </li>
                  <li data-testid="review-hypothesis-evidence-against">
                    Противоречащих ссылок: {hypothesis.evidenceAgainst.length}
                  </li>
                </ul>

                <EvidenceTrail trail={hypothesis.trail} />
                <DecisionBlock
                  canWrite={canWrite}
                  reviewable={isReviewable("differential_hypothesis", hypothesis.status)}
                  confirmedLabel="Решение по гипотезе уже принято человеком."
                  form={<HypothesisReviewForm clientId={id} hypothesisId={hypothesis.id} />}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
