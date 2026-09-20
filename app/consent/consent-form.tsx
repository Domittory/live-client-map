"use client";

import { useActionState } from "react";
import { grantConsent, revokeConsent } from "@/app/actions/consent";
import { CONSENT_TYPES, type ClientConsent } from "@/lib/service/consent";
import { CONSENT_TYPE_LABELS } from "./labels";

/**
 * Client-context consent management (ticket 09).
 *
 * The client id comes from the workspace (hidden field) — no manual id entry.
 * Grant/revoke call the guarded `grant_consent` / `revoke_consent` RPCs through
 * the Server Actions, so the database revalidates write access and consent.
 */

export function ConsentForm({
  clientId,
  consents,
}: {
  clientId: string;
  consents: ClientConsent[];
}) {
  const [grantState, grantAction, grantPending] = useActionState(grantConsent, {
    error: null,
  });
  const [revokeState, revokeAction, revokePending] = useActionState(revokeConsent, {
    error: null,
  });

  return (
    <div>
      <h2>Текущие согласия</h2>
      <ul data-testid="client-consents">
        {consents.map((consent) => (
          <li key={consent.consentType} data-testid={`client-consent-${consent.consentType}`}>
            {CONSENT_TYPE_LABELS[consent.consentType] ?? consent.consentType} —{" "}
            {consent.isActive ? (
              <>
                действует (v{consent.documentVersion})
                <form className="inline-form" action={revokeAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="consentType" value={consent.consentType} />
                  <button type="submit" disabled={revokePending}>
                    Отозвать
                  </button>
                </form>
              </>
            ) : (
              "не выдано"
            )}
          </li>
        ))}
      </ul>
      {revokeState.error && <p className="error">{revokeState.error}</p>}

      <h2>Выдать согласие</h2>
      <form action={grantAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Тип согласия
          <select name="consentType" defaultValue={CONSENT_TYPES[0]}>
            {CONSENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {CONSENT_TYPE_LABELS[type] ?? type}
              </option>
            ))}
          </select>
        </label>
        <label>
          Область действия
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
    </div>
  );
}
