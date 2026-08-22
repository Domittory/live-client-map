import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CreateCorrectionForm } from "../forms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewCorrectionPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const recommendationId = first(params.recommendationId);
  if (!recommendationId) {
    return (
      <main className="shell">
        <h1>Новая Correction</h1>
        <p>Укажите recommendationId в параметрах запроса.</p>
        <p>
          <Link href="/corrections">← Список corrections</Link>
        </p>
      </main>
    );
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const canWrite =
    membership?.status === "active" &&
    (membership.role === "owner" || membership.role === "specialist");

  if (!canWrite) {
    return (
      <main className="shell">
        <h1>Новая Correction</h1>
        <p>Только owner или specialist может создавать corrections.</p>
        <p>
          <Link href="/corrections">← Список corrections</Link>
        </p>
      </main>
    );
  }

  const { data: recommendation, error } = await supabase
    .from("recommendations")
    .select("id, organization_id, client_id, proposed_correction, rationale, status")
    .eq("id", recommendationId)
    .maybeSingle();

  if (error || !recommendation) notFound();
  if (recommendation.status !== "approved") {
    return (
      <main className="shell">
        <h1>Новая Correction</h1>
        <p>Correction можно создать только из одобренной (approved) рекомендации.</p>
        <p>
          <Link href="/corrections">← Список corrections</Link>
        </p>
      </main>
    );
  }

  const { data: recommendationTargets } = await supabase
    .from("recommendation_targets")
    .select("target_type, target_id, role, expected_effect")
    .eq("recommendation_id", recommendationId);

  return (
    <main className="shell">
      <h1>Новая Correction</h1>
      <p>
        <Link href="/corrections">← Список corrections</Link>
      </p>
      <CreateCorrectionForm
        organizationId={recommendation.organization_id}
        clientId={recommendation.client_id}
        recommendationId={recommendation.id}
        defaultTitle={recommendation.proposed_correction}
        defaultRationale={recommendation.rationale}
        defaultExpectedEffect={recommendation.rationale}
        recommendationTargets={(recommendationTargets ?? []).map((t) => ({
          target_type: t.target_type ?? "core_node",
          target_id: t.target_id,
          role: t.role,
          expected_effect: t.expected_effect,
        }))}
      />
    </main>
  );
}
