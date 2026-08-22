import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { AcceptInvitationForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="shell">
      <h1>Приглашение в организацию</h1>
      {user ? (
        <>
          <p>Вы вошли как {user.email}.</p>
          <AcceptInvitationForm token={token} />
        </>
      ) : (
        <p>
          Сначала <Link href="/login">войдите</Link> или{" "}
          <Link href="/signup">зарегистрируйтесь</Link> на email приглашения, затем вернитесь по
          этой ссылке.
        </p>
      )}
    </main>
  );
}
