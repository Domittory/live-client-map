"use client";

import { useActionState } from "react";
import {
  createMarkerAction,
  createObservationAction,
  recordMarkerValueAction,
  type ObservationState,
} from "@/app/actions/observations";
import type {
  MarkerType,
  ObservationSourceType,
  ObservationValence,
  ObservationVisibility,
} from "@/lib/service/observations";

const initial: ObservationState = { error: null };

const SOURCE_TYPES: ObservationSourceType[] = [
  "specialist_observation",
  "client_report",
  "measurement",
  "external_report",
];
const VALENCES: ObservationValence[] = ["positive", "negative", "neutral"];
const VISIBILITIES: ObservationVisibility[] = ["private", "client_visible"];
const MARKER_TYPES: MarkerType[] = [
  "scale",
  "boolean",
  "frequency",
  "subjective",
  "behavioral_count",
];

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function uuidOrUndefined(value: FormDataEntryValue | null): string | undefined {
  const raw = String(value ?? "").trim();
  return raw || undefined;
}

export function CreateObservationForm({
  organizationId,
  clientId,
}: {
  organizationId: string;
  clientId: string;
}) {
  const [state, dispatch, pending] = useActionState(createObservationAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const lifeAreas = String(formData.get("lifeAreas") ?? "")
          .split(",")
          .map((area) => area.trim())
          .filter(Boolean);
        dispatch({
          organizationId,
          clientId,
          correctionId: uuidOrUndefined(formData.get("correctionId")),
          date: String(formData.get("date") ?? "") || undefined,
          sourceType: String(formData.get("sourceType") ?? "") as ObservationSourceType,
          description: String(formData.get("description") ?? ""),
          lifeAreas,
          valence: String(formData.get("valence") ?? "") as ObservationValence,
          intensity: Number(formData.get("intensity") ?? 0),
          supportsImprovement: formData.get("supportsImprovement") === "on",
          confidence: Number(formData.get("confidence") ?? 0),
          visibility: String(formData.get("visibility") ?? "private") as ObservationVisibility,
        });
      }}
    >
      <label>
        Описание
        <textarea name="description" rows={3} required maxLength={4000} />
      </label>
      <label>
        Дата
        <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} />
      </label>
      <label>
        Источник
        <select name="sourceType" defaultValue="specialist_observation">
          {SOURCE_TYPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>
      <label>
        Сферы жизни (через запятую)
        <input name="lifeAreas" type="text" />
      </label>
      <label>
        Валентность
        <select name="valence" defaultValue="neutral">
          {VALENCES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Интенсивность (1–10)
        <input name="intensity" type="number" min={1} max={10} defaultValue={5} required />
      </label>
      <label>
        Уверенность (0–100)
        <input name="confidence" type="number" min={0} max={100} defaultValue={50} required />
      </label>
      <label>
        <input name="supportsImprovement" type="checkbox" />
        Поддерживает улучшение
      </label>
      <label>
        Видимость
        <select name="visibility" defaultValue="private">
          {VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </label>
      <label>
        Correction (ID, необязательно)
        <input name="correctionId" type="text" />
      </label>
      <button type="submit" disabled={pending}>
        Сохранить наблюдение
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function CreateMarkerForm({
  organizationId,
  clientId,
}: {
  organizationId: string;
  clientId: string;
}) {
  const [state, dispatch, pending] = useActionState(createMarkerAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        dispatch({
          organizationId,
          clientId,
          name: String(formData.get("name") ?? ""),
          description: String(formData.get("description") ?? "") || undefined,
          lifeArea: String(formData.get("lifeArea") ?? "") || undefined,
          markerType: String(formData.get("markerType") ?? "") as MarkerType,
          scaleMin: numberOrUndefined(formData.get("scaleMin")) ?? 0,
          scaleMax: numberOrUndefined(formData.get("scaleMax")) ?? 10,
          baselineValue: numberOrUndefined(formData.get("baselineValue")),
          currentValue: numberOrUndefined(formData.get("currentValue")),
          linkedCoreNodeId: uuidOrUndefined(formData.get("linkedCoreNodeId")),
          linkedThemeId: uuidOrUndefined(formData.get("linkedThemeId")),
          linkedResourceId: uuidOrUndefined(formData.get("linkedResourceId")),
        });
      }}
    >
      <label>
        Название
        <input name="name" type="text" required maxLength={500} />
      </label>
      <label>
        Описание
        <textarea name="description" rows={2} maxLength={4000} />
      </label>
      <label>
        Сфера жизни
        <input name="lifeArea" type="text" maxLength={200} />
      </label>
      <label>
        Тип маркера
        <select name="markerType" defaultValue="scale">
          {MARKER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Шкала min
        <input name="scaleMin" type="number" step="any" defaultValue={0} />
      </label>
      <label>
        Шкала max
        <input name="scaleMax" type="number" step="any" defaultValue={10} />
      </label>
      <label>
        Baseline
        <input name="baselineValue" type="number" step="any" />
      </label>
      <label>
        Текущее значение
        <input name="currentValue" type="number" step="any" />
      </label>
      <label>
        Core node (ID, необязательно)
        <input name="linkedCoreNodeId" type="text" />
      </label>
      <label>
        Theme (ID, необязательно)
        <input name="linkedThemeId" type="text" />
      </label>
      <label>
        Resource (ID, необязательно)
        <input name="linkedResourceId" type="text" />
      </label>
      <button type="submit" disabled={pending}>
        Создать маркер
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}

export function RecordMarkerValueForm({
  markerId,
  scaleMin,
  scaleMax,
}: {
  markerId: string;
  scaleMin: number;
  scaleMax: number;
}) {
  const [state, dispatch, pending] = useActionState(recordMarkerValueAction, initial);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        dispatch({
          markerId,
          value: Number(formData.get("value") ?? 0),
          note: String(formData.get("note") ?? "") || undefined,
        });
      }}
      style={{ display: "inline" }}
    >
      <input
        name="value"
        type="number"
        step="any"
        min={scaleMin}
        max={scaleMax}
        placeholder="Новое значение"
        required
      />
      <input name="note" type="text" placeholder="Заметка" maxLength={2000} />
      <button type="submit" disabled={pending}>
        Записать
      </button>
      {state.error && <p className="error">{state.error}</p>}
    </form>
  );
}
