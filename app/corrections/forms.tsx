"use client";

import { useActionState } from "react";
import {
  archiveCorrectionAction,
  createCorrectionAction,
  updateCorrectionAction,
  type CorrectionState,
} from "@/app/actions/corrections";
import type {
  CorrectionDetail,
  CorrectionStatus,
  CorrectionTargetRole,
  CorrectionTargetType,
  ExpectedMarkerDirection,
  ExpectedMarkerMeasurementType,
} from "@/lib/service/corrections";

const initial: CorrectionState = { error: null };

const STATUSES: CorrectionStatus[] = [
  "planned",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
];

function parseStatus(value: FormDataEntryValue | null): CorrectionStatus | undefined {
  const s = String(value ?? "");
  return STATUSES.includes(s as CorrectionStatus) ? (s as CorrectionStatus) : undefined;
}

const TARGET_ROLES: CorrectionTargetRole[] = ["primary", "secondary", "downstream", "context"];
const TARGET_TYPES: CorrectionTargetType[] = [
  "core_node",
  "theme",
  "resource",
  "client_request",
  "development_target",
];
const MARKER_DIRECTIONS: ExpectedMarkerDirection[] = [
  "increase",
  "decrease",
  "stable",
  "observable_change",
];
const MARKER_MEASUREMENTS: ExpectedMarkerMeasurementType[] = [
  "scale",
  "boolean",
  "frequency",
  "subjective",
  "behavioral_count",
];

interface RecommendationTargetView {
  target_type: string;
  target_id: string;
  role: string;
  expected_effect: string | null;
}

export function CreateCorrectionForm({
  organizationId,
  clientId,
  recommendationId,
  defaultTitle,
  defaultRationale,
  defaultExpectedEffect,
  recommendationTargets,
}: {
  organizationId: string;
  clientId: string;
  recommendationId: string;
  defaultTitle: string;
  defaultRationale: string | null;
  defaultExpectedEffect: string | null;
  recommendationTargets: RecommendationTargetView[];
}) {
  const [state, dispatch, pending] = useActionState(createCorrectionAction, initial);

  const mappedTargets = recommendationTargets.map((t) => ({
    targetType: TARGET_TYPES.includes(t.target_type as CorrectionTargetType)
      ? (t.target_type as CorrectionTargetType)
      : "core_node",
    targetId: t.target_id,
    role: TARGET_ROLES.includes(t.role as CorrectionTargetRole)
      ? (t.role as CorrectionTargetRole)
      : "context",
    expectedEffect: t.expected_effect ?? undefined,
  }));

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const formData = new FormData(form);

        const targets: {
          targetType: CorrectionTargetType;
          targetId: string;
          role: CorrectionTargetRole;
          expectedEffect?: string;
        }[] = [];
        const targetRows = form.querySelectorAll<HTMLDivElement>("[data-target-row]");
        targetRows.forEach((row) => {
          const targetType = (row.querySelector('[name="targetType"]') as HTMLSelectElement).value;
          const targetId = (row.querySelector('[name="targetId"]') as HTMLInputElement).value;
          const role = (row.querySelector('[name="role"]') as HTMLSelectElement).value;
          const expectedEffect = (row.querySelector('[name="expectedEffect"]') as HTMLInputElement)
            .value;
          targets.push({
            targetType: targetType as CorrectionTargetType,
            targetId,
            role: role as CorrectionTargetRole,
            ...(expectedEffect ? { expectedEffect } : {}),
          });
        });

        const markers: {
          marker: string;
          lifeArea?: string;
          expectedDirection: ExpectedMarkerDirection;
          measurementType: ExpectedMarkerMeasurementType;
          baselineValue?: string;
          targetValue?: string;
        }[] = [];
        const markerRows = form.querySelectorAll<HTMLDivElement>("[data-marker-row]");
        markerRows.forEach((row) => {
          const marker = (row.querySelector('[name="marker"]') as HTMLInputElement).value;
          const lifeArea = (row.querySelector('[name="lifeArea"]') as HTMLInputElement).value;
          const expectedDirection = (
            row.querySelector('[name="expectedDirection"]') as HTMLSelectElement
          ).value;
          const measurementType = (
            row.querySelector('[name="measurementType"]') as HTMLSelectElement
          ).value;
          const baselineValue = (row.querySelector('[name="baselineValue"]') as HTMLInputElement)
            .value;
          const targetValue = (row.querySelector('[name="targetValue"]') as HTMLInputElement).value;
          markers.push({
            marker,
            ...(lifeArea ? { lifeArea } : {}),
            expectedDirection: expectedDirection as ExpectedMarkerDirection,
            measurementType: measurementType as ExpectedMarkerMeasurementType,
            ...(baselineValue ? { baselineValue } : {}),
            ...(targetValue ? { targetValue } : {}),
          });
        });

        dispatch({
          organizationId,
          clientId,
          recommendationId,
          title: String(formData.get("title") ?? ""),
          date: String(formData.get("date") ?? ""),
          methodNotes: String(formData.get("methodNotes") ?? "") || undefined,
          rationale: String(formData.get("rationale") ?? "") || undefined,
          expectedEffect: String(formData.get("expectedEffect") ?? "") || undefined,
          specialistNotes: String(formData.get("specialistNotes") ?? "") || undefined,
          clientVisibleSummary: String(formData.get("clientVisibleSummary") ?? "") || undefined,
          contraindicationsAcknowledged: formData.get("contraindicationsAcknowledged") === "on",
          targets,
          expectedMarkers: markers,
        });
      }}
    >
      <label>
        Название
        <input name="title" type="text" defaultValue={defaultTitle} required maxLength={500} />
      </label>
      <label>
        Дата
        <input
          name="date"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          required
        />
      </label>
      <label>
        Обоснование
        <textarea
          name="rationale"
          rows={3}
          defaultValue={defaultRationale ?? ""}
          maxLength={4000}
        />
      </label>
      <label>
        Ожидаемый эффект
        <textarea
          name="expectedEffect"
          rows={3}
          defaultValue={defaultExpectedEffect ?? ""}
          maxLength={4000}
        />
      </label>
      <label>
        Методические заметки
        <textarea name="methodNotes" rows={3} maxLength={4000} />
      </label>
      <label>
        Заметки специалиста
        <textarea name="specialistNotes" rows={3} maxLength={4000} />
      </label>
      <label>
        Сводка для клиента
        <textarea name="clientVisibleSummary" rows={3} maxLength={4000} />
      </label>
      <label>
        <input name="contraindicationsAcknowledged" type="checkbox" />
        Противопоказания метода учтены
      </label>

      <section>
        <h3>Targets</h3>
        {mappedTargets.length === 0 ? <p>Добавьте хотя бы один target.</p> : null}
        {mappedTargets.map((target, index) => (
          <div key={index} data-target-row>
            <select name="targetType" defaultValue={target.targetType}>
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input name="targetId" type="text" defaultValue={target.targetId} required />
            <select name="role" defaultValue={target.role}>
              {TARGET_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <input
              name="expectedEffect"
              type="text"
              defaultValue={target.expectedEffect ?? ""}
              placeholder="Expected effect"
              maxLength={2000}
            />
          </div>
        ))}
      </section>

      <section>
        <h3>Expected markers</h3>
        {[0, 1].map((index) => (
          <div key={index} data-marker-row>
            <input name="marker" type="text" placeholder="Маркер" required maxLength={500} />
            <input name="lifeArea" type="text" placeholder="Сфера жизни" maxLength={200} />
            <select name="expectedDirection" defaultValue="observable_change">
              {MARKER_DIRECTIONS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select name="measurementType" defaultValue="subjective">
              {MARKER_MEASUREMENTS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              name="baselineValue"
              type="text"
              placeholder="Базовое значение"
              maxLength={500}
            />
            <input name="targetValue" type="text" placeholder="Целевое значение" maxLength={500} />
          </div>
        ))}
      </section>

      <button type="submit" disabled={pending}>
        Создать Correction
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function UpdateCorrectionForm({ correction }: { correction: CorrectionDetail }) {
  const [state, dispatch, pending] = useActionState(updateCorrectionAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        dispatch({
          correctionId: correction.id,
          title: String(formData.get("title") ?? "") || undefined,
          status: parseStatus(formData.get("status")),
          specialistNotes: String(formData.get("specialistNotes") ?? "") || undefined,
          clientVisibleSummary: String(formData.get("clientVisibleSummary") ?? "") || undefined,
        });
      }}
    >
      <input type="hidden" name="correctionId" value={correction.id} />
      <label>
        Название
        <input name="title" type="text" defaultValue={correction.title} maxLength={500} />
      </label>
      <label>
        Статус
        <select name="status" defaultValue={correction.status}>
          {["planned", "in_progress", "completed", "cancelled"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Заметки специалиста
        <textarea
          name="specialistNotes"
          rows={3}
          defaultValue={correction.specialist_notes ?? ""}
          maxLength={4000}
        />
      </label>
      <label>
        Сводка для клиента
        <textarea
          name="clientVisibleSummary"
          rows={3}
          defaultValue={correction.client_visible_summary ?? ""}
          maxLength={4000}
        />
      </label>
      <button type="submit" disabled={pending}>
        Обновить
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function ArchiveCorrectionButton({ correctionId }: { correctionId: string }) {
  const [state, dispatch, pending] = useActionState(archiveCorrectionAction, initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        dispatch(correctionId);
      }}
      style={{ display: "inline" }}
    >
      <button type="submit" disabled={pending}>
        Архивировать
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
