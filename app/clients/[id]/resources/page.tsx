import { listLinkableCoreNodes } from "@/lib/service/core-nodes";
import { listDevelopmentTargets } from "@/lib/service/development-targets";
import { INSUFFICIENT_DATA_LABEL, labelFor } from "@/lib/service/diagnostics-presentation";
import { listClientResources } from "@/lib/service/resources";
import {
  DEVELOPMENT_TARGET_LIMITS_LABEL,
  DEVELOPMENT_TARGET_IMPORTANCE_LABELS,
  DEVELOPMENT_TARGET_STATUS_LABELS,
  RESOURCE_EVIDENCE_LABEL,
  RESOURCE_REVIEW_STATUS_LABELS,
  RESOURCE_STATUS_LABELS,
  RESOURCE_TREND_LABELS,
  RESOURCE_VISIBILITY_LABELS,
  developmentTargetLimits,
  resourceEvidence,
} from "@/lib/service/resources-presentation";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import {
  DevelopmentTargetEditForm,
  DevelopmentTargetForm,
  ResourceEditForm,
  ResourceForm,
} from "./resources-forms";

/**
 * Client-scoped Resources + DevelopmentTargets screen (ticket 13, SPEC §8.18/§8.19).
 *
 * The route id is the only client reference: the guard resolves the client
 * through RLS, the section rule is enforced server-side, and the read model is
 * loaded through RLS-protected tables. DevelopmentTargets live on this screen
 * because they are the "developing" half of the same positive layer: a target is
 * linked to the Resources and CoreNodes of this client, and both are created and
 * edited in one place instead of two half-empty sections.
 *
 * Every Resource and every target is rendered together with its evidence and the
 * limits of that data (never as a bare conclusion), and write controls appear
 * only for callers whose database access allows writes.
 */

export default async function ClientResourcesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "resources")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="resources" />
        <ClientSectionDenied section="resources" />
      </main>
    );
  }

  const query = { organizationId: client.organization_id, clientId: id };
  const [resources, targets, coreNodes] = await Promise.all([
    listClientResources(supabase, query),
    listDevelopmentTargets(supabase, query),
    listLinkableCoreNodes(supabase, query),
  ]);
  const canWrite = access.canWrite;
  const resourceOptions = resources.map((resource) => ({
    id: resource.id,
    label: resource.name,
  }));
  const coreNodeOptions = coreNodes.map((node) => ({ id: node.id, label: node.title }));

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="resources" />

      <p className="hint" data-testid="resources-policy-note">
        Ресурсы и цели развития — положительная часть модели. Ресурс не выводится из проблем, а
        оценка ресурса и уровень цели меняются только вместе с доказательством или причиной; пустые
        данные показаны как «{INSUFFICIENT_DATA_LABEL}», а не как вывод.
      </p>

      {canWrite ? (
        <>
          <ResourceForm clientId={id} />
          <DevelopmentTargetForm
            clientId={id}
            resources={resourceOptions}
            coreNodes={coreNodeOptions}
          />
        </>
      ) : (
        <p className="hint" data-testid="resources-read-only">
          Доступ только для чтения: создание и изменение ресурсов и целей развития недоступны.
        </p>
      )}

      <section>
        <h2>Ресурсы</h2>
        {resources.length === 0 ? (
          <p className="hint" data-testid="resources-empty">
            {INSUFFICIENT_DATA_LABEL}: ресурсы ещё не зафиксированы.
          </p>
        ) : (
          <ul data-testid="resource-list">
            {resources.map((resource) => {
              const evidence = resourceEvidence({
                reviewStatus: resource.review_status,
                strengthScore: resource.strength_score,
                confidenceScore: resource.confidence_score,
                evidenceSummary: resource.evidence_summary,
                evidenceRefs: resource.evidence_refs,
              });
              return (
                <li key={resource.id} data-testid="resource-card" data-resource-id={resource.id}>
                  <h3 data-testid="resource-name">{resource.name}</h3>
                  {resource.description ? <p>{resource.description}</p> : null}
                  <ul className="signal-meta">
                    <li data-testid="resource-status">
                      Статус: {labelFor(RESOURCE_STATUS_LABELS, resource.status)}
                    </li>
                    <li data-testid="resource-review-status">
                      Ревью: {labelFor(RESOURCE_REVIEW_STATUS_LABELS, resource.review_status)}
                    </li>
                    <li data-testid="resource-strength">
                      Сила: {resource.strength_score ?? INSUFFICIENT_DATA_LABEL}
                    </li>
                    <li data-testid="resource-confidence">
                      Уверенность: {resource.confidence_score ?? INSUFFICIENT_DATA_LABEL}
                    </li>
                    <li data-testid="resource-trend">
                      Динамика: {labelFor(RESOURCE_TREND_LABELS, resource.trend)}
                    </li>
                    <li data-testid="resource-visibility">
                      Видимость: {labelFor(RESOURCE_VISIBILITY_LABELS, resource.visibility)}
                    </li>
                  </ul>

                  <h4>{RESOURCE_EVIDENCE_LABEL}</h4>
                  <p data-testid="resource-evidence">
                    {evidence.summary ??
                      `${INSUFFICIENT_DATA_LABEL}: описание доказательств пусто.`}
                  </p>
                  {resource.evidence_refs.length > 0 ? (
                    <ul data-testid="resource-evidence-refs">
                      {resource.evidence_refs.map((ref) => (
                        <li key={ref}>{ref}</li>
                      ))}
                    </ul>
                  ) : null}

                  <h4>Ограничения данных ресурса</h4>
                  <ul data-testid="resource-limits">
                    {evidence.limits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>

                  {canWrite ? (
                    <ResourceEditForm
                      clientId={id}
                      resource={{
                        id: resource.id,
                        name: resource.name,
                        strengthScore: resource.strength_score,
                        confidenceScore: resource.confidence_score,
                        evidenceSummary: resource.evidence_summary,
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>Цели развития</h2>
        <p className="hint" data-testid="development-targets-note">
          Цель развития измеряется уровнями и проверяется маркерами успеха; связь с ресурсами и
          ключевыми узлами показывает, на что она опирается.
        </p>
        {targets.length === 0 ? (
          <p className="hint" data-testid="development-targets-empty">
            {INSUFFICIENT_DATA_LABEL}: цели развития ещё не зафиксированы.
          </p>
        ) : (
          <ul data-testid="development-target-list">
            {targets.map((target) => {
              const limits = developmentTargetLimits({
                status: target.status,
                currentLevel: target.current_level,
                targetLevel: target.target_level,
                successMarkers: target.success_markers,
                linkedResources: target.linked_resources,
                linkedCoreNodes: target.linked_core_nodes,
              });
              return (
                <li
                  key={target.id}
                  data-testid="development-target-card"
                  data-development-target-id={target.id}
                >
                  <h3 data-testid="development-target-name">{target.name}</h3>
                  {target.description ? <p>{target.description}</p> : null}
                  <ul className="signal-meta">
                    <li data-testid="development-target-status">
                      Статус: {labelFor(DEVELOPMENT_TARGET_STATUS_LABELS, target.status)}
                    </li>
                    <li data-testid="development-target-importance">
                      Важность: {labelFor(DEVELOPMENT_TARGET_IMPORTANCE_LABELS, target.importance)}
                    </li>
                    <li data-testid="development-target-levels">
                      Уровни: {target.current_level ?? "—"} → {target.target_level ?? "—"}
                    </li>
                    <li data-testid="development-target-links">
                      Связи: ресурсов {target.linked_resources.length}, узлов{" "}
                      {target.linked_core_nodes.length}
                    </li>
                  </ul>

                  <h4>Маркеры успеха</h4>
                  {target.success_markers.length === 0 ? (
                    <p className="hint" data-testid="development-target-no-markers">
                      {INSUFFICIENT_DATA_LABEL}: маркеры успеха не заданы.
                    </p>
                  ) : (
                    <ul data-testid="development-target-markers">
                      {target.success_markers.map((marker) => (
                        <li key={marker}>{marker}</li>
                      ))}
                    </ul>
                  )}

                  <h4>{DEVELOPMENT_TARGET_LIMITS_LABEL}</h4>
                  <ul data-testid="development-target-limits">
                    {limits.limits.map((limit) => (
                      <li key={limit}>{limit}</li>
                    ))}
                  </ul>

                  {canWrite ? (
                    <DevelopmentTargetEditForm
                      clientId={id}
                      resources={resourceOptions}
                      coreNodes={coreNodeOptions}
                      target={{
                        id: target.id,
                        name: target.name,
                        description: target.description,
                        domain: target.domain,
                        currentLevel: target.current_level,
                        targetLevel: target.target_level,
                        importance: target.importance,
                        status: target.status,
                        linkedResources: target.linked_resources,
                        linkedCoreNodes: target.linked_core_nodes,
                        successMarkers: target.success_markers,
                      }}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
