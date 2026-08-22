"use client";

import { useActionState } from "react";
import { grantConsent, revokeConsent } from "@/app/actions/consent";
import { CONSENT_TYPES } from "@/lib/service/consent";

export function ConsentForm() {
  const [grantState, grantAction, grantPending] = useActionState(grantConsent, {
    error: null,
  });
  const [revokeState, revokeAction, revokePending] = useActionState(revokeConsent, {
    error: null,
  });

  return (
    <div>
      <h3>Выдать согласие</h3>
      <form action={grantAction}>
        <label>
          client_id
          <input name="clientId" type="text" required />
        </label>
        <label>
          Тип согласия
          <select name="consentType">
            {CONSENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <input name="scope" type="text" />
        </label>
        <label>
          Версия документа
          <input name="documentVersion" type="text" required placeholder="1.0" />
        </label>
        <button type="submit" disabled={grantPending}>
          Выдать
        </button>
        {grantState.error && <p className="error">{grantState.error}</p>}
      </form>

      <h3>Отозвать согласие</h3>
      <form action={revokeAction}>
        <label>
          client_id
          <input name="clientId" type="text" required />
        </label>
        <label>
          Тип согласия
          <select name="consentType">
            {CONSENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" disabled={revokePending}>
          Отозвать
        </button>
        {revokeState.error && <p className="error">{revokeState.error}</p>}
      </form>
    </div>
  );
}
