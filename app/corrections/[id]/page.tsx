import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCorrection } from "@/lib/service/corrections";
import { createClient } from "@/lib/supabase/server";
import { ArchiveCorrectionButton, UpdateCorrectionForm } from "../forms";

export default async function CorrectionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role, status")
    .eq("user_id", user.id)
    .maybeSingle();

  const canWrite =
    membership?.status === "active" &&
    (membership.role === "owner" || membership.role === "specialist");

  let correction;
  try {
    correction = await getCorrection(supabase, id);
  } catch {
    notFound();
  }

  return (
    <main className="shell">
      <h1>{correction.title}</h1>
      <p>
        <Link href="/corrections">← Список corrections</Link>
      </p>

      <p>
        <strong>Статус:</strong> {correction.status}
      </p>
      <p>
        <strong>Дата:</strong> {correction.date}
      </p>
      {correction.priority_score_before !== null ? (
        <p>
          <strong>Priority score before:</strong> {correction.priority_score_before.toFixed(1)}
        </p>
      ) : null}
      {correction.rationale ? (
        <p>
          <strong>Обоснование:</strong> {correction.rationale}
        </p>
      ) : null}
      {correction.expected_effect ? (
        <p>
          <strong>Ожидаемый эффект:</strong> {correction.expected_effect}
        </p>
      ) : null}
      {correction.specialist_notes ? (
        <p>
          <strong>Заметки специалиста:</strong> {correction.specialist_notes}
        </p>
      ) : null}
      {correction.client_visible_summary ? (
        <p>
          <strong>Сводка для клиента:</strong> {correction.client_visible_summary}
        </p>
      ) : null}

      <section>
        <h2>Targets</h2>
        {correction.targets.length === 0 ? (
          <p>Нет targets.</p>
        ) : (
          <ul>
            {correction.targets.map((target) => (
              <li key={target.id}>
                {target.role}: {target.target_type} {target.target_id}
                {target.expected_effect ? <> — {target.expected_effect}</> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Expected markers</h2>
        {correction.expected_markers.length === 0 ? (
          <p>Нет ожидаемых маркеров.</p>
        ) : (
          <ul>
            {correction.expected_markers.map((marker) => (
              <li key={marker.id}>
                {marker.marker}
                {marker.life_area ? <> ({marker.life_area})</> : null}: {marker.expected_direction},{" "}
                {marker.measurement_type}
                {marker.baseline_value ? <> baseline {marker.baseline_value}</> : null}
                {marker.target_value ? <> → {marker.target_value}</> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canWrite ? (
        <section>
          <h2>Управление</h2>
          <UpdateCorrectionForm correction={correction} />
          <ArchiveCorrectionButton correctionId={correction.id} />
        </section>
      ) : null}
    </main>
  );
}
