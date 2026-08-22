import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/actions/auth";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .eq("user_id", user.id)
    .maybeSingle();

  let orgName: string | null = null;
  if (membership) {
    const { data: org } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", membership.organization_id)
      .maybeSingle();
    orgName = org?.name ?? null;
  }

  return (
    <main className="shell">
      <h1>Живая карта клиента</h1>
      <p data-testid="app-status">ready</p>
      <p>Вы вошли как {user.email}</p>
      {orgName ? <p>Организация: {orgName}</p> : <p>Организация ещё не создана.</p>}
      <p>
        <Link href="/library">Диагностическая библиотека</Link>
      </p>
      <p>
        <Link href="/audit">Audit log</Link>
      </p>
      <p>
        <Link href="/admin">Администрирование</Link>
      </p>
      <form action={signOut}>
        <button type="submit">Выйти</button>
      </form>
    </main>
  );
}
