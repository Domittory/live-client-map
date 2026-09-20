"use client";

import Link from "next/link";
import { useActionState } from "react";
import { invitePortalUser, revokePortalUserAccess } from "@/app/actions/portal";
import type { PortalUser } from "@/lib/service/client-portal";

/**
 * Portal access management form (ticket 15).
 *
 * The client id always comes from the workspace (hidden field) — the specialist
 * never types an id. The invite action grants the identity and sends the
 * single-use sign-in link; the revoke action takes effect on the client's next
 * request.
 */
export function PortalAccessForm({
  clientId,
  portalUsers,
  consentActive,
}: {
  clientId: string;
  portalUsers: PortalUser[];
  consentActive: boolean;
}) {
  const [inviteState, inviteAction, invitePending] = useActionState(invitePortalUser, {
    error: null,
    sent: false,
  });
  const [revokeState, revokeAction, revokePending] = useActionState(revokePortalUserAccess, {
    error: null,
    revoked: false,
  });

  return (
    <div>
      <p className="hint" data-testid="portal-policy-note">
        Портал клиента — отдельный доступ по ссылке-приглашению. Клиент не становится участником
        организации и видит только опубликованные сводки, согласованные цели и видимые ему
        рекомендации. Внутренние заметки и черновики AI в портал не попадают.
      </p>

      {!consentActive ? (
        <p className="error" data-testid="portal-consent-missing">
          Нет действующего согласия «Портал клиента». Выдайте его в разделе{" "}
          <Link href={`/clients/${clientId}/consent`}>Согласия</Link>, иначе база данных отклонит
          выдачу доступа.
        </p>
      ) : null}

      <h2>Текущий доступ</h2>
      {portalUsers.length === 0 ? (
        <p data-testid="portal-users-empty">Доступ к порталу ещё не выдан.</p>
      ) : (
        <ul data-testid="portal-users">
          {portalUsers.map((portalUser) => (
            <li key={portalUser.id} data-testid="portal-user-row">
              <span data-testid="portal-user-email">{portalUser.email}</span> —{" "}
              {portalUser.status === "active" ? "действует" : "отозван"}
              {portalUser.status === "active" ? (
                <form className="inline-form" action={revokeAction}>
                  <input type="hidden" name="clientId" value={clientId} />
                  <input type="hidden" name="portalUserId" value={portalUser.id} />
                  <button type="submit" disabled={revokePending}>
                    Отозвать
                  </button>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {revokeState.error && <p className="error">{revokeState.error}</p>}

      <h2>Пригласить в портал</h2>
      <form action={inviteAction}>
        <input type="hidden" name="clientId" value={clientId} />
        <label>
          Email клиента
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            data-testid="portal-invite-email"
          />
        </label>
        <button type="submit" disabled={invitePending} data-testid="portal-invite-submit">
          Выдать доступ и отправить ссылку
        </button>
        {inviteState.error && <p className="error">{inviteState.error}</p>}
        {inviteState.sent && (
          <p data-testid="portal-invite-sent">
            Доступ выдан. Клиенту отправлена одноразовая ссылка для входа; она действует
            ограниченное время.
          </p>
        )}
      </form>
    </div>
  );
}
