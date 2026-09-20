import {
  getDiagnosticsReadModel,
  type DiagnosticSessionWithSignals,
  type DiagnosticSignalRecord,
} from "@/lib/service/diagnostics";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import {
  DiagnosticSessionForm,
  SignalCard,
  SignalForm,
  type SessionOption,
  type SignalView,
} from "./diagnostics-forms";
import {
  AI_PROCESSING_STATUS_LABELS,
  EVIDENCE_LEVEL_MEANINGS,
  INSUFFICIENT_DATA_LABEL,
  REVIEW_STATUS_LABELS,
  SESSION_TYPE_LABELS,
  labelFor,
  signalReadiness,
} from "@/lib/service/diagnostics-presentation";

/**
 * Client-scoped diagnostics screen (ticket 10).
 *
 * The route id is the only client reference: the guard resolves the client
 * through RLS, the section rule is enforced server-side, and the read model is
 * loaded through RLS-protected tables. Write controls (session/signal forms and
 * per-Signal review) are rendered only for callers whose database access allows
 * writes, and every mutation still goes through a guarded atomic RPC.
 */

function toSignalView(
  signal: DiagnosticSignalRecord,
  lineage: { id: string; title: string; sessionType: string } | null
): SignalView {
  const readiness = signalReadiness(signal);
  return {
    id: signal.id,
    sourceType: signal.source_type,
    epistemicType: signal.epistemic_type,
    reviewStatus: signal.review_status,
    evidenceLevel: signal.evidence_level,
    visibility: signal.visibility,
    rawStatement: signal.raw_statement,
    polarity: signal.statement_polarity,
    testResult: signal.test_result,
    normalizedMeaning: signal.normalized_meaning,
    intensity: signal.intensity,
    confidence: signal.confidence,
    lifeAreas: signal.life_areas,
    tags: signal.tags,
    createdAt: signal.created_at,
    lineage,
    interpretation: readiness.interpretation,
    insufficientReason: readiness.reason,
  };
}

function SessionBlock({
  session,
  signals,
  clientId,
  canWrite,
}: {
  session: DiagnosticSessionWithSignals;
  signals: SignalView[];
  clientId: string;
  canWrite: boolean;
}) {
  return (
    <li data-testid="diagnostic-session" data-session-id={session.id}>
      <h3 data-testid="diagnostic-session-title">{session.title}</h3>
      <ul className="signal-meta">
        <li data-testid="diagnostic-session-type">
          Тип: {labelFor(SESSION_TYPE_LABELS, session.session_type)}
        </li>
        <li data-testid="diagnostic-session-review">
          Ревью сессии: {labelFor(REVIEW_STATUS_LABELS, session.human_review_status)}
        </li>
        <li data-testid="diagnostic-session-ai">
          AI: {labelFor(AI_PROCESSING_STATUS_LABELS, session.ai_processing_status)}
        </li>
        <li data-testid="diagnostic-session-created-at">
          Создана: <time dateTime={session.created_at}>{session.created_at}</time>
        </li>
      </ul>
      <p data-testid="diagnostic-session-raw-input">
        Исходные данные:{" "}
        {session.raw_input && session.raw_input.trim().length > 0
          ? session.raw_input
          : INSUFFICIENT_DATA_LABEL}
      </p>
      {session.notes && session.notes.trim().length > 0 ? (
        <p data-testid="diagnostic-session-notes">Заметки: {session.notes}</p>
      ) : null}

      <h4>Сигналы сессии</h4>
      {signals.length === 0 ? (
        <p className="hint" data-testid="diagnostic-session-no-signals">
          {INSUFFICIENT_DATA_LABEL}: в сессии ещё нет сигналов, вывод не сформирован.
        </p>
      ) : (
        <ul data-testid="diagnostic-session-signals">
          {signals.map((signal) => (
            <SignalCard key={signal.id} clientId={clientId} signal={signal} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </li>
  );
}

export default async function ClientDiagnosticsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "diagnostics")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="diagnostics" />
        <ClientSectionDenied section="diagnostics" />
      </main>
    );
  }

  const { sessions, sessionlessSignals, lineage } = await getDiagnosticsReadModel(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });

  const sessionOptions: SessionOption[] = sessions.map((session) => ({
    id: session.id,
    title: session.title,
    sessionType: session.session_type,
  }));
  const totalSignals =
    sessions.reduce((sum, session) => sum + session.signals.length, 0) + sessionlessSignals.length;

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="diagnostics" />

      {access.canWrite ? (
        <>
          <DiagnosticSessionForm clientId={id} defaultSessionType="individual" />
          <SignalForm clientId={id} sessions={sessionOptions} />
        </>
      ) : (
        <p className="hint" data-testid="diagnostics-read-only">
          Доступ только для чтения: создание сессий, добавление сигналов и ревью недоступны.
        </p>
      )}

      <section>
        <h2>Диагностические сессии</h2>
        {sessions.length === 0 ? (
          <p className="hint" data-testid="diagnostics-empty-sessions">
            {INSUFFICIENT_DATA_LABEL}: диагностических сессий пока нет.
          </p>
        ) : (
          <ul data-testid="diagnostic-sessions">
            {sessions.map((session) => (
              <SessionBlock
                key={session.id}
                session={session}
                signals={session.signals.map((signal) =>
                  toSignalView(signal, lineage.get(signal.id) ?? null)
                )}
                clientId={id}
                canWrite={access.canWrite}
              />
            ))}
          </ul>
        )}

        <h3>Сигналы вне сессий</h3>
        {sessionlessSignals.length === 0 ? (
          <p className="hint" data-testid="diagnostics-no-sessionless-signals">
            {INSUFFICIENT_DATA_LABEL}: сигналов вне сессий нет.
          </p>
        ) : (
          <ul data-testid="sessionless-signals">
            {sessionlessSignals.map((signal) => (
              <SignalCard
                key={signal.id}
                clientId={id}
                signal={toSignalView(signal, null)}
                canWrite={access.canWrite}
              />
            ))}
          </ul>
        )}

        <h3>Сводка</h3>
        <p data-testid="diagnostics-signal-count">Всего сигналов: {totalSignals}</p>
        <p data-testid="diagnostics-evidence-note">
          L0 (только AI) не считается независимым доказательством:{" "}
          {EVIDENCE_LEVEL_MEANINGS.L0_AI_ONLY}. Пустые или неподтверждённые данные показаны как «
          {INSUFFICIENT_DATA_LABEL}», а не как вывод.
        </p>
      </section>
    </main>
  );
}
