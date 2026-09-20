"use client";

import { useActionState } from "react";
import {
  commitImportSelectionAction,
  previewImportAction,
  type ImportCommitState,
  type ImportPreviewState,
} from "@/app/actions/import";
import type { ClientImportSummary, ImportReport, ImportReportRecord } from "@/lib/service/import";

/**
 * Client-scoped import workflow (ticket 11).
 *
 * Two explicit phases: "Разобрать" stages the source, its DiagnosticSession and
 * the validation report without writing a single Signal; "Закоммитить
 * выбранных" turns ONLY the checked candidates into pending Signals. Nothing is
 * auto-confirmed — committed Signals await the same human review as any other
 * pending evidence.
 */

const INITIAL_PREVIEW: ImportPreviewState = { error: null, report: null };
const INITIAL_COMMIT: ImportCommitState = { error: null, report: null, message: null };

export const IMPORT_FORMAT_LABELS: Record<string, string> = {
  plain_text: "Обычный текст",
  markdown: "Markdown",
  chatgpt_analysis: "Анализ ChatGPT",
  signals_csv: "Signals CSV",
  signals_json: "Signals JSON",
};

export const IMPORT_STATUS_LABELS: Record<string, string> = {
  validating: "Проверка",
  parsing: "Разбор",
  awaiting_review: "Ожидает ревью",
  committing: "Коммит",
  completed: "Завершён",
  failed: "Ошибка",
};

export const RECORD_STATUS_LABELS: Record<string, string> = {
  valid: "Валиден",
  invalid: "Ошибка записи",
  duplicate: "Дубликат",
  accepted: "Принят",
  rejected_by_reviewer: "Отклонён ревьюером",
  committed: "Закоммичен",
};

function labelFor(labels: Record<string, string>, value: string | null | undefined): string {
  if (!value) return "—";
  return labels[value] ?? "Неизвестное значение";
}

function RecordRow({ record, canSelect }: { record: ImportReportRecord; canSelect: boolean }) {
  const selectable = canSelect && record.status === "valid";
  return (
    <li
      className="import-record"
      data-testid="import-record-row"
      data-external-id={record.external_id}
      data-status={record.status}
    >
      <label>
        <input
          type="checkbox"
          name="selected"
          value={record.external_id}
          disabled={!selectable}
          data-testid="import-candidate"
        />
        <span data-testid="import-record-index">#{record.index}</span>{" "}
        <span data-testid="import-record-external-id">{record.external_id}</span>
      </label>
      <span data-testid="import-record-status">
        {labelFor(RECORD_STATUS_LABELS, record.status)}
      </span>
      <p data-testid="import-record-statement">{record.statement ?? "—"}</p>
      {record.errors.length > 0 ? (
        <ul className="error" data-testid="import-record-errors">
          {record.errors.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{`${issue.code}: ${issue.message}`}</li>
          ))}
        </ul>
      ) : null}
      {record.warnings.length > 0 ? (
        <ul className="hint" data-testid="import-record-warnings">
          {record.warnings.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>{`${issue.code}: ${issue.message}`}</li>
          ))}
        </ul>
      ) : null}
      {record.signal_id ? (
        <p className="hint" data-testid="import-record-signal-id">
          Signal: {record.signal_id}
        </p>
      ) : null}
    </li>
  );
}

function ReportBody({ clientId, report }: { clientId: string; report: ImportReport }) {
  const [commitState, commitAction, commitPending] = useActionState(
    commitImportSelectionAction,
    INITIAL_COMMIT
  );

  const committed = report.status === "completed";
  const commitReport =
    commitState.report && commitState.report.import_id === report.import_id
      ? commitState.report
      : null;
  const active = commitReport ?? report;

  const counts = active.counts ?? {};

  return (
    <section data-testid="import-report" data-import-id={active.import_id}>
      <h2>Отчёт о валидации</h2>
      <ul className="signal-meta">
        <li data-testid="import-report-status">
          Статус: {labelFor(IMPORT_STATUS_LABELS, active.status)}
        </li>
        <li data-testid="import-report-import-id">Импорт: {active.import_id}</li>
        <li data-testid="import-report-session-id">
          Диагностическая сессия (lineage): {active.diagnostic_session_id}
        </li>
        <li data-testid="import-report-content-sha">SHA-256 источника: {active.content_sha256}</li>
      </ul>

      <h3>Счётчики</h3>
      <ul className="signal-meta" data-testid="import-counts">
        <li data-testid="import-count-total">Всего: {counts.total ?? 0}</li>
        <li data-testid="import-count-valid">Валидных: {counts.valid ?? 0}</li>
        <li data-testid="import-count-invalid">С ошибками: {counts.invalid ?? 0}</li>
        <li data-testid="import-count-duplicate">Дубликатов: {counts.duplicate ?? 0}</li>
        <li data-testid="import-count-warning">С предупреждениями: {counts.warning ?? 0}</li>
        <li data-testid="import-count-committed">Закоммичено: {counts.committed ?? 0}</li>
      </ul>

      {active.fatal_errors.length > 0 ? (
        <div className="error" data-testid="import-fatal-errors">
          <p>Ошибки уровня контейнера:</p>
          <pre>{JSON.stringify(active.fatal_errors, null, 2)}</pre>
        </div>
      ) : null}

      <form action={commitAction} data-testid="import-commit-form">
        <input type="hidden" name="clientId" value={clientId} />
        <input type="hidden" name="importId" value={report.import_id} />

        <h3>Записи</h3>
        {active.records.length === 0 ? (
          <p className="hint" data-testid="import-no-records">
            Контейнер валиден, но кандидатов нет: коммитить нечего.
          </p>
        ) : (
          <ul data-testid="import-records">
            {active.records.map((record) => (
              <RecordRow
                key={`${record.index}-${record.external_id}`}
                record={record}
                canSelect={!committed}
              />
            ))}
          </ul>
        )}

        {committed ? (
          <p className="hint" data-testid="import-already-committed">
            Импорт закоммичен. Отклонённые кандидаты не создали сигналов; повторный коммит с другим
            набором отклоняется.
          </p>
        ) : (
          <>
            <p className="hint">
              Кандидаты коммитятся как pending-сигналы: подтверждение возможно только через
              последующий human review.
            </p>
            <button type="submit" disabled={commitPending} data-testid="import-commit-submit">
              Закоммитить выбранных кандидатов
            </button>
          </>
        )}

        {commitState.error ? (
          <p className="error" role="alert" data-testid="import-commit-error">
            {commitState.error}
          </p>
        ) : null}
        {commitReport && commitState.message ? (
          <p className="hint" data-testid="import-commit-message">
            {commitState.message}
          </p>
        ) : null}
      </form>

      {active.signal_ids.length > 0 ? (
        <p data-testid="import-signal-ids">Созданные сигналы: {active.signal_ids.join(", ")}</p>
      ) : null}
    </section>
  );
}

function ImportHistory({ imports }: { imports: ClientImportSummary[] }) {
  if (imports.length === 0) {
    return (
      <p className="hint" data-testid="import-history-empty">
        Импортов по этому клиенту ещё не было.
      </p>
    );
  }
  return (
    <ul data-testid="import-history">
      {imports.map((entry) => (
        <li key={entry.id} data-testid="import-history-row" data-import-id={entry.id}>
          <span data-testid="import-history-format">
            {labelFor(IMPORT_FORMAT_LABELS, entry.input_format)}
          </span>
          {" · "}
          <span data-testid="import-history-status">
            {labelFor(IMPORT_STATUS_LABELS, entry.status)}
          </span>
          {" · "}
          <span data-testid="import-history-committed">
            закоммичено: {entry.counts.committed ?? 0}
          </span>
          {" · "}
          <span data-testid="import-history-session">
            сессия: {entry.diagnostic_session_id ?? "—"}
          </span>
          {" · "}
          <time dateTime={entry.created_at}>{entry.created_at}</time>
        </li>
      ))}
    </ul>
  );
}

export function ImportWorkflow({
  clientId,
  imports,
}: {
  clientId: string;
  imports: ClientImportSummary[];
}) {
  const [state, action, pending] = useActionState(previewImportAction, INITIAL_PREVIEW);

  return (
    <>
      <section>
        <h2>Импорт данных</h2>
        <p className="hint">
          Разбор ничего не подтверждает: сначала вы видите отчёт (ошибки контейнера, ошибки записей,
          дубликаты, предупреждения), затем выбираете кандидатов для коммита.
        </p>
        <form action={action} data-testid="import-form">
          <input type="hidden" name="clientId" value={clientId} />
          <label>
            Формат
            <select name="format" aria-label="Формат" defaultValue="plain_text">
              {Object.entries(IMPORT_FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Название (необязательно)
            <input name="title" type="text" maxLength={200} />
          </label>
          <label>
            Содержимое
            <textarea
              name="content"
              aria-label="Содержимое"
              rows={8}
              required
              placeholder="Вставьте текст, CSV или JSON по контракту live-client-map"
            />
          </label>
          <button type="submit" disabled={pending} data-testid="import-preview-submit">
            Разобрать и показать отчёт
          </button>
          {state.error ? (
            <p className="error" role="alert" data-testid="import-preview-error">
              {state.error}
            </p>
          ) : null}
        </form>
      </section>

      {state.report ? <ReportBody clientId={clientId} report={state.report} /> : null}

      <section>
        <h2>История импортов</h2>
        <p className="hint">
          Lineage: каждый сигнал ссылается на свою диагностическую сессию импорта.
        </p>
        <ImportHistory imports={imports} />
      </section>
    </>
  );
}
