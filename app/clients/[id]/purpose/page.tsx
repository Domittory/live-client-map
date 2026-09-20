import { INSUFFICIENT_DATA_LABEL, labelFor } from "@/lib/service/diagnostics-presentation";
import { getClientPurpose } from "@/lib/service/purpose";
import {
  PURPOSE_PROFILE_LIMITS_LABEL,
  PURPOSE_SOURCE_SYSTEM_LABELS,
  PURPOSE_SYNTHESIS_LIMITS_LABEL,
  PURPOSE_SYNTHESIS_SOURCES_LABEL,
  PURPOSE_VISIBILITY_LABELS,
  purposeProfileLimits,
  purposeSynthesisLimits,
} from "@/lib/service/purpose-presentation";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import { PurposeProfileForm, PurposeSynthesisForm } from "./purpose-forms";

/**
 * Client-scoped Purpose screen (ticket 13, SPEC §8.20/§8.21).
 *
 * Manual entry and viewing only: the product has no automatic purpose-detection
 * algorithm, so this screen never derives a purpose on its own. Every profile is
 * shown with its named source system, its interpretive-system limit and the
 * limits of the entered data; every synthesis is shown together with the profiles
 * it is based on, and without any source profile it is rendered as
 * «недостаточно данных» instead of a conclusion.
 */

export default async function ClientPurposePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "purpose")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="purpose" />
        <ClientSectionDenied section="purpose" />
      </main>
    );
  }

  const purpose = await getClientPurpose(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });
  const canWrite = access.canWrite;

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="purpose" />

      <p className="hint" data-testid="purpose-policy-note">
        Предназначение не определяется автоматически. Профиль вносит специалист, синтез — ручной
        вывод по сохранённым профилям; источники Джйотиш и Дизайн человека остаются
        интерпретационными системами и источниками гипотез.
      </p>

      {canWrite ? (
        <>
          <PurposeProfileForm clientId={id} />
          <PurposeSynthesisForm clientId={id} />
        </>
      ) : (
        <p className="hint" data-testid="purpose-read-only">
          Доступ только для чтения: внесение профилей и синтезов недоступно.
        </p>
      )}

      <section>
        <h2>Профили предназначения</h2>
        {purpose.profiles.length === 0 ? (
          <p className="hint" data-testid="purpose-profiles-empty">
            {INSUFFICIENT_DATA_LABEL}: профили предназначения ещё не внесены.
          </p>
        ) : (
          <ul data-testid="purpose-profile-list">
            {purpose.profiles.map((profile) => {
              const limits = purposeProfileLimits({
                sourceSystem: profile.source_system,
                interpretation: profile.interpretation,
                confidence: profile.confidence,
                strengths: profile.strengths,
                developmentDirections: profile.development_directions,
              });
              return (
                <li
                  key={profile.id}
                  data-testid="purpose-profile"
                  data-purpose-profile-id={profile.id}
                >
                  <h3 data-testid="purpose-profile-source">
                    {labelFor(PURPOSE_SOURCE_SYSTEM_LABELS, profile.source_system)}
                  </h3>
                  <ul className="signal-meta">
                    <li data-testid="purpose-profile-confidence">
                      Уверенность: {profile.confidence ?? INSUFFICIENT_DATA_LABEL}
                    </li>
                    <li data-testid="purpose-profile-visibility">
                      Видимость: {labelFor(PURPOSE_VISIBILITY_LABELS, profile.visibility)}
                    </li>
                    <li data-testid="purpose-profile-created-at">
                      Внесён: <time dateTime={profile.created_at}>{profile.created_at}</time>
                    </li>
                  </ul>

                  <p data-testid="purpose-profile-interpretation">
                    Интерпретация:{" "}
                    {profile.interpretation ??
                      `${INSUFFICIENT_DATA_LABEL}: интерпретация не внесена.`}
                  </p>

                  <h4>Сильные стороны</h4>
                  {profile.strengths.length === 0 ? (
                    <p className="hint" data-testid="purpose-profile-no-strengths">
                      {INSUFFICIENT_DATA_LABEL}: сильные стороны не заполнены.
                    </p>
                  ) : (
                    <ul data-testid="purpose-profile-strengths">
                      {profile.strengths.map((strength) => (
                        <li key={strength}>{strength}</li>
                      ))}
                    </ul>
                  )}

                  <h4>Возможные роли</h4>
                  {profile.potential_roles.length === 0 ? (
                    <p className="hint" data-testid="purpose-profile-no-roles">
                      {INSUFFICIENT_DATA_LABEL}: роли не заполнены.
                    </p>
                  ) : (
                    <ul data-testid="purpose-profile-roles">
                      {profile.potential_roles.map((role) => (
                        <li key={role}>{role}</li>
                      ))}
                    </ul>
                  )}

                  <h4>Направления развития</h4>
                  {profile.development_directions.length === 0 ? (
                    <p className="hint" data-testid="purpose-profile-no-directions">
                      {INSUFFICIENT_DATA_LABEL}: направления развития не заполнены.
                    </p>
                  ) : (
                    <ul data-testid="purpose-profile-directions">
                      {profile.development_directions.map((direction) => (
                        <li key={direction}>{direction}</li>
                      ))}
                    </ul>
                  )}

                  <h4>{PURPOSE_PROFILE_LIMITS_LABEL}</h4>
                  <ul data-testid="purpose-profile-limits">
                    {limits.limits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Синтез предназначения</h2>
        {purpose.syntheses.length === 0 ? (
          <p className="hint" data-testid="purpose-syntheses-empty">
            {INSUFFICIENT_DATA_LABEL}: синтез ещё не внесён.
          </p>
        ) : (
          <ul data-testid="purpose-synthesis-list">
            {purpose.syntheses.map((synthesis) => {
              const limits = purposeSynthesisLimits({
                sourceProfileCount: purpose.profiles.length,
                summary: synthesis.summary,
                crossSystemMatches: synthesis.cross_system_matches,
                potentialConflicts: synthesis.potential_conflicts,
                recommendedDevelopmentVectors: synthesis.recommended_development_vectors,
              });
              return (
                <li
                  key={synthesis.id}
                  data-testid="purpose-synthesis"
                  data-purpose-synthesis-id={synthesis.id}
                >
                  <p data-testid="purpose-synthesis-summary">
                    {limits.hasEvidence
                      ? synthesis.summary
                      : `${INSUFFICIENT_DATA_LABEL}: ${synthesis.summary ?? "резюме не заполнено."}`}
                  </p>

                  <h4>{PURPOSE_SYNTHESIS_SOURCES_LABEL}</h4>
                  {purpose.profiles.length === 0 ? (
                    <p className="hint" data-testid="purpose-synthesis-no-sources">
                      {INSUFFICIENT_DATA_LABEL}: профилей, на которые опирается синтез, нет.
                    </p>
                  ) : (
                    <ul data-testid="purpose-synthesis-sources">
                      {purpose.profiles.map((profile) => (
                        <li key={profile.id}>
                          {labelFor(PURPOSE_SOURCE_SYSTEM_LABELS, profile.source_system)}
                        </li>
                      ))}
                    </ul>
                  )}

                  <h4>Совпадения между системами</h4>
                  {synthesis.cross_system_matches.length === 0 ? (
                    <p className="hint" data-testid="purpose-synthesis-no-matches">
                      {INSUFFICIENT_DATA_LABEL}: совпадения не зафиксированы.
                    </p>
                  ) : (
                    <ul data-testid="purpose-synthesis-matches">
                      {synthesis.cross_system_matches.map((match) => (
                        <li key={match}>{match}</li>
                      ))}
                    </ul>
                  )}

                  <h4>Возможные конфликты</h4>
                  {synthesis.potential_conflicts.length === 0 ? (
                    <p className="hint" data-testid="purpose-synthesis-no-conflicts">
                      {INSUFFICIENT_DATA_LABEL}: конфликты не зафиксированы.
                    </p>
                  ) : (
                    <ul data-testid="purpose-synthesis-conflicts">
                      {synthesis.potential_conflicts.map((conflict) => (
                        <li key={conflict}>{conflict}</li>
                      ))}
                    </ul>
                  )}

                  <h4>Рекомендуемые векторы развития</h4>
                  {synthesis.recommended_development_vectors.length === 0 ? (
                    <p className="hint" data-testid="purpose-synthesis-no-vectors">
                      {INSUFFICIENT_DATA_LABEL}: векторы не зафиксированы.
                    </p>
                  ) : (
                    <ul data-testid="purpose-synthesis-vectors">
                      {synthesis.recommended_development_vectors.map((vector) => (
                        <li key={vector}>{vector}</li>
                      ))}
                    </ul>
                  )}

                  <h4>{PURPOSE_SYNTHESIS_LIMITS_LABEL}</h4>
                  <ul data-testid="purpose-synthesis-limits">
                    {limits.limits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
