import { listFeedbackForms } from "@/lib/service/feedback-forms";
import { canUseSection, requireClientWorkspace } from "../workspace";
import { ClientSectionDenied, ClientWorkspaceHeader } from "../workspace-nav";
import { FeedbackFormBuilder, FeedbackFormCard } from "./feedback-forms";

/**
 * Client-scoped feedback section (ticket 16).
 *
 * The route id is the only client reference: the guard resolves the client
 * through RLS, the section rule is enforced server-side, and the form list is
 * read through the RLS-protected table. Creating and sending are separate
 * explicit actions; a completed form's answers are shown read-only, because the
 * submission already became a pending Signal and confirming it is the review
 * screen's job.
 */
export default async function ClientFeedbackPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, client, access } = await requireClientWorkspace(id);

  if (!canUseSection(access, "feedback")) {
    return (
      <main className="shell">
        <ClientWorkspaceHeader client={client} access={access} current="feedback" />
        <ClientSectionDenied section="feedback" />
      </main>
    );
  }

  const forms = await listFeedbackForms(supabase, {
    organizationId: client.organization_id,
    clientId: id,
  });

  return (
    <main className="shell">
      <ClientWorkspaceHeader client={client} access={access} current="feedback" />

      {access.canWrite ? (
        <FeedbackFormBuilder clientId={id} />
      ) : (
        <p className="hint" data-testid="feedback-read-only">
          Доступ только для чтения: создание и отправка форм недоступны.
        </p>
      )}

      <section>
        <h2>Формы обратной связи</h2>
        {forms.length === 0 ? (
          <p className="hint" data-testid="feedback-empty">
            Форм пока нет.
          </p>
        ) : (
          <ul data-testid="feedback-forms">
            {forms.map((form) => (
              <FeedbackFormCard key={form.id} clientId={id} form={form} />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
