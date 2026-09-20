import Link from "next/link";
import { portalSignOut } from "@/app/actions/portal";
import type { ClientPortalOverview } from "@/lib/service/client-portal";

/**
 * Portal presentation (ticket 15).
 *
 * The component renders only the fields of the privacy-filtered projection
 * (`ClientPortalOverview`): published client-visible notes, active
 * DevelopmentTargets, published correction summaries and human-approved
 * client-visible Recommendations. Private specialist reasoning and pending AI
 * output are not part of the type, so they cannot be rendered here.
 */

function LevelBadge({ current, target }: { current: number | null; target: number | null }) {
  if (current === null && target === null) return null;
  return (
    <span className="hint">
      {" "}
      (текущий уровень: {current ?? "—"}, цель: {target ?? "—"})
    </span>
  );
}

export function PortalView({ overview }: { overview: ClientPortalOverview }) {
  const hasContent =
    Boolean(overview.notes && overview.notes.trim()) ||
    overview.agreedTargets.length > 0 ||
    overview.publishedSummaries.length > 0 ||
    overview.clientVisibleRecommendations.length > 0;

  return (
    <main className="shell" data-testid="portal-page">
      <h1 data-testid="portal-title">Портал клиента</h1>
      <p data-testid="portal-client-name">Клиент: {overview.displayName ?? overview.clientId}</p>

      <section>
        <h2>Опубликованная сводка</h2>
        {overview.notes && overview.notes.trim() ? (
          <p data-testid="portal-notes">{overview.notes}</p>
        ) : (
          <p className="hint" data-testid="portal-notes-empty">
            Специалист ещё не опубликовал сводку.
          </p>
        )}
      </section>

      <section>
        <h2>Согласованные цели развития</h2>
        {overview.agreedTargets.length === 0 ? (
          <p className="hint" data-testid="portal-targets-empty">
            Согласованных целей пока нет.
          </p>
        ) : (
          <ul data-testid="portal-targets">
            {overview.agreedTargets.map((target) => (
              <li key={target.id} data-testid="portal-target" data-target-id={target.id}>
                {target.name}
                <LevelBadge current={target.current_level} target={target.target_level} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Опубликованные итоги работы</h2>
        {overview.publishedSummaries.length === 0 ? (
          <p className="hint" data-testid="portal-summaries-empty">
            Опубликованных итогов пока нет.
          </p>
        ) : (
          <ul data-testid="portal-summaries">
            {overview.publishedSummaries.map((summary) => (
              <li key={summary.id} data-testid="portal-summary" data-summary-id={summary.id}>
                <strong>{summary.title}</strong>
                {summary.date ? <span className="hint"> · {summary.date}</span> : null}
                <p>{summary.summary}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Рекомендации для вас</h2>
        {overview.clientVisibleRecommendations.length === 0 ? (
          <p className="hint" data-testid="portal-recommendations-empty">
            Опубликованных рекомендаций пока нет.
          </p>
        ) : (
          <ol data-testid="portal-recommendations">
            {overview.clientVisibleRecommendations.map((recommendation) => (
              <li
                key={recommendation.id}
                data-testid="portal-recommendation"
                data-recommendation-id={recommendation.id}
              >
                {recommendation.proposed_correction}
              </li>
            ))}
          </ol>
        )}
      </section>

      {!hasContent ? (
        <p className="hint" data-testid="portal-empty">
          Опубликованного содержимого пока нет. Специалист подготовит его позже.
        </p>
      ) : null}

      <p className="hint" data-testid="portal-privacy-note">
        Здесь показано только то, что специалист опубликовал для вас: сводки, согласованные цели и
        рекомендации. Внутренние заметки и черновики AI в портал не попадают.
      </p>

      <form action={portalSignOut}>
        <button type="submit" data-testid="portal-sign-out">
          Выйти
        </button>
      </form>

      <p>
        <Link href="/portal/login">О портале</Link>
      </p>
    </main>
  );
}

/**
 * Neutral denial for a signed-in identity with no active portal access (never
 * granted, revoked, or `client_portal` consent withdrawn). It deliberately does
 * not reveal whether the client or the access exists.
 */
export function PortalDenied({ email }: { email: string }) {
  return (
    <main className="shell" data-testid="portal-denied">
      <h1>Портал клиента</h1>
      <p className="error" data-testid="portal-denied-message">
        Доступ к порталу недоступен: доступ не выдан или отозван.
      </p>
      <p className="hint">
        Вход выполнен как {email}. Если доступ должен быть, попросите специалиста выдать или
        обновить ссылку-приглашение.
      </p>
      <form action={portalSignOut}>
        <button type="submit" data-testid="portal-sign-out">
          Выйти
        </button>
      </form>
    </main>
  );
}
