"use client";

import { useActionState } from "react";
import {
  createDevelopmentTargetAction,
  createResourceAction,
  updateDevelopmentTargetAction,
  updateResourceAction,
  type PositiveLayerActionState,
} from "@/app/actions/resources";
import {
  DEVELOPMENT_TARGET_IMPORTANCE_LABELS,
  DEVELOPMENT_TARGET_STATUS_LABELS,
} from "@/lib/service/resources-presentation";

/**
 * Resources + DevelopmentTargets client components (ticket 13).
 *
 * Every mutation is a form post to a Server Action; the action resolves the
 * client through RLS and the atomic RPC rechecks write access in the database,
 * so the browser only ever supplies business fields — never the client id of
 * another tenant, never an actor. Each edit form is bound to exactly one row,
 * so a score or level change is always an explicit action with its reason.
 */

const INITIAL: PositiveLayerActionState = { error: null };

export interface LinkOption {
  id: string;
  label: string;
}

function ErrorLine({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p className="error" role="alert" data-testid={id}>
      {message}
    </p>
  );
}

function NumberField({
  name,
  label,
  defaultValue,
}: {
  name: string;
  label: string;
  defaultValue?: number | null;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        type="number"
        min={0}
        max={100}
        step={1}
        defaultValue={defaultValue ?? undefined}
      />
    </label>
  );
}

export function ResourceForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(createResourceAction, INITIAL);

  return (
    <section>
      <h2>Новый ресурс</h2>
      <p className="hint">
        Ресурс — самостоятельная сущность положительной части модели: он не выводится из проблем и
        создаётся только явным действием специалиста.
      </p>
      <form action={action} data-testid="resource-form">
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Название
          <input name="name" type="text" required />
        </label>
        <label>
          Описание
          <textarea name="description" rows={2} />
        </label>
        <label>
          Сфера
          <input name="domain" type="text" placeholder="работа, отношения" />
        </label>
        <NumberField name="strengthScore" label="Сила ресурса (0–100)" />
        <NumberField name="confidenceScore" label="Уверенность (0–100)" />
        <label>
          Доказательства
          <textarea
            name="evidenceSummary"
            rows={2}
            placeholder="Наблюдения и сигналы, на которые опирается ресурс"
          />
        </label>
        <button type="submit" disabled={pending}>
          Создать ресурс
        </button>
        <ErrorLine id="resource-form-error" message={state.error} />
      </form>
    </section>
  );
}

export interface ResourceValues {
  id: string;
  name: string;
  strengthScore: number | null;
  confidenceScore: number | null;
  evidenceSummary: string | null;
}

export function ResourceEditForm({
  clientId,
  resource,
}: {
  clientId: string;
  resource: ResourceValues;
}) {
  const [state, action, pending] = useActionState(updateResourceAction, INITIAL);

  return (
    <form className="review-form" action={action} data-testid="resource-edit-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="resourceId" value={resource.id} />
      <NumberField
        name="strengthScore"
        label={`Сила ресурса «${resource.name}»`}
        defaultValue={resource.strengthScore}
      />
      <NumberField
        name="confidenceScore"
        label="Уверенность"
        defaultValue={resource.confidenceScore}
      />
      <label>
        Доказательства или причина изменения
        <textarea name="evidenceSummary" rows={2} defaultValue={resource.evidenceSummary ?? ""} />
      </label>
      <button type="submit" disabled={pending}>
        Сохранить ресурс
      </button>
      <ErrorLine id="resource-edit-form-error" message={state.error} />
    </form>
  );
}

export interface DevelopmentTargetValues {
  id: string;
  name: string;
  description: string | null;
  domain: string | null;
  currentLevel: number | null;
  targetLevel: number | null;
  importance: string;
  status: string;
  linkedResources: string[];
  linkedCoreNodes: string[];
  successMarkers: string[];
}

function TargetFields({
  target,
  resources,
  coreNodes,
}: {
  target?: DevelopmentTargetValues;
  resources: LinkOption[];
  coreNodes: LinkOption[];
}) {
  return (
    <>
      <label>
        Название
        <input name="name" type="text" required defaultValue={target?.name ?? ""} />
      </label>
      <label>
        Описание
        <textarea name="description" rows={2} defaultValue={target?.description ?? ""} />
      </label>
      <label>
        Сфера
        <input name="domain" type="text" defaultValue={target?.domain ?? ""} />
      </label>
      <NumberField
        name="currentLevel"
        label="Текущий уровень (0–100)"
        defaultValue={target?.currentLevel ?? null}
      />
      <NumberField
        name="targetLevel"
        label="Целевой уровень (0–100)"
        defaultValue={target?.targetLevel ?? null}
      />
      <label>
        Важность
        <select name="importance" defaultValue={target?.importance ?? "normal"}>
          {Object.entries(DEVELOPMENT_TARGET_IMPORTANCE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {target ? (
        <label>
          Статус цели
          <select name="status" defaultValue={target.status}>
            {Object.entries(DEVELOPMENT_TARGET_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label>
        Маркеры успеха (через запятую)
        <input
          name="successMarkers"
          type="text"
          defaultValue={target ? target.successMarkers.join(", ") : ""}
          placeholder="спокойно говорит с руководителем"
        />
      </label>
      <label>
        Связанные ресурсы
        <select
          name="linkedResources"
          multiple
          size={Math.min(4, Math.max(1, resources.length))}
          defaultValue={target?.linkedResources ?? []}
        >
          {resources.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Связанные ключевые узлы
        <select
          name="linkedCoreNodes"
          multiple
          size={Math.min(4, Math.max(1, coreNodes.length))}
          defaultValue={target?.linkedCoreNodes ?? []}
        >
          {coreNodes.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

export function DevelopmentTargetForm({
  clientId,
  resources,
  coreNodes,
}: {
  clientId: string;
  resources: LinkOption[];
  coreNodes: LinkOption[];
}) {
  const [state, action, pending] = useActionState(createDevelopmentTargetAction, INITIAL);

  return (
    <section>
      <h2>Новая цель развития</h2>
      <form action={action} data-testid="development-target-form">
        <input type="hidden" name="clientId" value={clientId} />
        <TargetFields resources={resources} coreNodes={coreNodes} />
        <button type="submit" disabled={pending}>
          Создать цель
        </button>
        <ErrorLine id="development-target-form-error" message={state.error} />
      </form>
    </section>
  );
}

export function DevelopmentTargetEditForm({
  clientId,
  target,
  resources,
  coreNodes,
}: {
  clientId: string;
  target: DevelopmentTargetValues;
  resources: LinkOption[];
  coreNodes: LinkOption[];
}) {
  const [state, action, pending] = useActionState(updateDevelopmentTargetAction, INITIAL);

  return (
    <form className="review-form" action={action} data-testid="development-target-edit-form">
      <input type="hidden" name="clientId" value={clientId} />
      <input type="hidden" name="targetId" value={target.id} />
      <TargetFields target={target} resources={resources} coreNodes={coreNodes} />
      <label>
        Причина изменения уровней или статуса
        <input name="reason" type="text" />
      </label>
      <button type="submit" disabled={pending}>
        Сохранить цель
      </button>
      <ErrorLine id="development-target-edit-form-error" message={state.error} />
    </form>
  );
}
