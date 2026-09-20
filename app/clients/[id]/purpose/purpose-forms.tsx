"use client";

import { useActionState } from "react";
import {
  createPurposeProfileAction,
  createPurposeSynthesisAction,
  type PurposeActionState,
} from "@/app/actions/purpose";
import {
  PURPOSE_SOURCE_SYSTEM_LABELS,
  PURPOSE_VISIBILITY_LABELS,
} from "@/lib/service/purpose-presentation";

/**
 * Purpose client components (ticket 13).
 *
 * The purpose layer is entered manually by a specialist — there is no automatic
 * purpose-detection algorithm — so both forms are plain text entry: the source
 * system, the specialist's interpretation and the manual synthesis across the
 * stored profiles. The atomic RPC revalidates write access in the database.
 */

const INITIAL: PurposeActionState = { error: null };

export function PurposeProfileForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(createPurposeProfileAction, INITIAL);

  return (
    <section>
      <h2>Новый профиль предназначения</h2>
      <p className="hint">
        Джйотиш и Дизайн человека — интерпретационные системы и источники гипотез, а не объективные
        психологические факты. Профиль заполняется специалистом вручную и хранится вместе с
        исходными данными источника.
      </p>
      <form action={action} data-testid="purpose-profile-form">
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Источник
          <select name="sourceSystem" aria-label="Источник" defaultValue="specialist_assessment">
            {Object.entries(PURPOSE_SOURCE_SYSTEM_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Исходные данные источника (JSON-объект)
          <textarea name="rawData" rows={3} placeholder={'{"type": "Projector"}'} />
        </label>
        <label>
          Интерпретация специалиста
          <textarea name="interpretation" rows={3} />
        </label>
        <label>
          Сильные стороны (через запятую)
          <input name="strengths" type="text" />
        </label>
        <label>
          Возможные роли (через запятую)
          <input name="potentialRoles" type="text" />
        </label>
        <label>
          Направления развития (через запятую)
          <input name="developmentDirections" type="text" />
        </label>
        <label>
          Уверенность в источнике (0–100)
          <input name="confidence" type="number" min={0} max={100} step={1} />
        </label>
        <label>
          Видимость
          <select name="visibility" aria-label="Видимость" defaultValue="internal">
            {Object.entries(PURPOSE_VISIBILITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={pending}>
          Сохранить профиль
        </button>
        {state.error ? (
          <p className="error" role="alert" data-testid="purpose-profile-form-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}

export function PurposeSynthesisForm({ clientId }: { clientId: string }) {
  const [state, action, pending] = useActionState(createPurposeSynthesisAction, INITIAL);

  return (
    <section>
      <h2>Новый синтез предназначения</h2>
      <p className="hint">
        Синтез — ручной вывод специалиста по уже сохранённым профилям. Система не определяет
        предназначение автоматически и не выбирает источник за специалиста.
      </p>
      <form action={action} data-testid="purpose-synthesis-form">
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Резюме синтеза
          <textarea name="summary" rows={3} required />
        </label>
        <label>
          Совпадения между системами (через запятую)
          <input name="crossSystemMatches" type="text" />
        </label>
        <label>
          Возможные конфликты (через запятую)
          <input name="potentialConflicts" type="text" />
        </label>
        <label>
          Рекомендуемые векторы развития (через запятую)
          <input name="recommendedDevelopmentVectors" type="text" />
        </label>
        <button type="submit" disabled={pending}>
          Сохранить синтез
        </button>
        {state.error ? (
          <p className="error" role="alert" data-testid="purpose-synthesis-form-error">
            {state.error}
          </p>
        ) : null}
      </form>
    </section>
  );
}
