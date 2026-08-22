import Link from "next/link";
import { redirect } from "next/navigation";
import { listMembers, RETENTION_POLICY } from "@/lib/service/admin";
import { createClient } from "@/lib/supabase/server";
import { InviteForm, MemberControls, SettingsForm, TransferOwnershipForm } from "./forms";

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: org } = await supabase
    .from("organizations")
    .select("id, name, plan, settings")
    .eq("owner_user_id", user.id)
    .maybeSingle();

  if (!org) {
    return (
      <main className="shell">
        <h1>Администрирование</h1>
        <p>
          <Link href="/">← На главную</Link>
        </p>
        <p>Раздел доступен только владельцу организации.</p>
      </main>
    );
  }

  const { members, invitations } = await listMembers(supabase, org.id);
  const settings = org.settings as {
    retention?: { client_data_years?: number; export_days?: number };
  };
  const transferCandidates = members.filter(
    (member) => !member.isOwner && member.status === "active"
  );

  return (
    <main className="shell">
      <h1>Администрирование — {org.name}</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <section>
        <h2>Участники</h2>
        <ul>
          {members.map((member) => (
            <li key={member.userId}>
              {member.email} — {member.role}, {member.status}
              {member.isOwner ? (
                " (владелец)"
              ) : (
                <>
                  {" "}
                  <MemberControls
                    organizationId={org.id}
                    userId={member.userId}
                    role={member.role}
                    status={member.status}
                  />
                </>
              )}
            </li>
          ))}
        </ul>

        <h3>Приглашения</h3>
        {invitations.length === 0 ? (
          <p>Нет ожидающих приглашений.</p>
        ) : (
          <ul>
            {invitations.map((invitation) => (
              <li key={invitation.id}>
                {invitation.email} — {invitation.role}, действует до{" "}
                {new Date(invitation.expiresAt).toLocaleDateString("ru-RU")} ·{" "}
                <code>/invite/{invitation.token}</code>
              </li>
            ))}
          </ul>
        )}
        <InviteForm organizationId={org.id} />
      </section>

      <section>
        <h2>Настройки и retention</h2>
        <p>
          <small>
            Audit log хранится {RETENTION_POLICY.auditYears} года, бэкапы ротируются за{" "}
            {RETENTION_POLICY.backupDays} дней — зафиксировано политикой и не настраивается.
          </small>
        </p>
        <SettingsForm
          organizationId={org.id}
          name={org.name}
          clientDataYears={
            settings.retention?.client_data_years ?? RETENTION_POLICY.clientDataYears.default
          }
          exportDays={settings.retention?.export_days ?? RETENTION_POLICY.exportDays.default}
        />
      </section>

      <section>
        <h2>Тариф</h2>
        <p>
          Текущий план: <strong>{org.plan}</strong>
        </p>
        <p>
          <small>
            Оплата не подключена: внешний billing-провайдер отложен решением владельца продукта
            (тикет 02). План меняется вручную администратором платформы.
          </small>
        </p>
      </section>

      <section>
        <h2>Передача ownership</h2>
        {transferCandidates.length === 0 ? (
          <p>Некому передать: нет других активных участников.</p>
        ) : (
          <TransferOwnershipForm organizationId={org.id} members={transferCandidates} />
        )}
      </section>
    </main>
  );
}
