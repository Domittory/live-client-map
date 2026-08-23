/**
 * Alert rules (ticket 62). Declarative: each rule has an owner, a severity and
 * concrete response guidance, plus the metric/log condition that should trigger
 * it. There is no alerting backend in the current single-instance deployment, so
 * these rules are the contract an external monitor (or a future backend) follows.
 */

export type AlertSeverity = "critical" | "warning";

export interface AlertRule {
  name: string;
  severity: AlertSeverity;
  owner: string;
  /** Human-readable trigger, e.g. the metric/threshold or log event. */
  trigger: string;
  guidance: string;
}

/**
 * Operational log retention (ticket 62). Logs are emitted to stdout; the
 * collector that ships them must honor this retention. 30 days matches the
 * backups retention fixed by the ticket-05 policy.
 */
export const TELEMETRY_RETENTION_DAYS = 30;

export const ALERT_RULES: AlertRule[] = [
  {
    name: "ai_provider_failure_rate_high",
    severity: "warning",
    owner: "platform",
    trigger: 'ai_run_total{status=~"provider_.*"} / ai_run_total > 0.2 over 10m',
    guidance:
      "Проверить API-ключ и доступность провайдера. Если выше rate_limit — пересмотреть лимиты; иначе эскалировать провайдеру.",
  },
  {
    name: "http_500_rate_high",
    severity: "critical",
    owner: "platform",
    trigger: 'http_response_total{status_class="5xx"} / sum(http_response_total) > 0.05 over 10m',
    guidance:
      "Связать с correlation_id в логах, найти топ событий `http_error`, разобрать первый стек. При недоступности БД проверить Supabase.",
  },
  {
    name: "ai_safety_blocked_spike",
    severity: "warning",
    owner: "clinical",
    trigger: "ai_run_total{status=safety_blocked} >= 3 over 10m",
    guidance:
      "AI массово отказывает по safety. Проверить содержимое redacted payload и триггеры safety-идентификации; человек должен просмотреть случаи.",
  },
  {
    name: "upload_size_limit_exceeded_spike",
    severity: "warning",
    owner: "platform",
    trigger: "import_total{outcome=size_limit_exceeded} >= 10 over 10m",
    guidance:
      "Слишком много oversized uploads. Проверить UX клиентской загрузки и не блокирует ли это легитимный импорт.",
  },
  {
    name: "database_health_unavailable",
    severity: "critical",
    owner: "platform",
    trigger: "GET /api/health returns database=unavailable",
    guidance:
      "БД недоступна. Проверить Supabase/соединение и зависимые API; не обрабатывать пользовательские мутации до восстановления.",
  },
];
