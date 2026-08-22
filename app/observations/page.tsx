import Link from "next/link";
import { redirect } from "next/navigation";
import { listMarkers, listObservations } from "@/lib/service/observations";
import { createClient } from "@/lib/supabase/server";
import { CreateMarkerForm, CreateObservationForm, RecordMarkerValueForm } from "./forms";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ObservationsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
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

  if (!membership) {
    return (
      <main className="shell">
        <h1>Observations</h1>
        <p>У вас нет активного членства в организации.</p>
        <p>
          <Link href="/">← На главную</Link>
        </p>
      </main>
    );
  }

  const clientId = first(params.clientId);

  const observations = await listObservations(supabase, {
    organizationId: membership.organization_id,
    ...(clientId ? { clientId } : {}),
  });
  const markers = await listMarkers(supabase, {
    organizationId: membership.organization_id,
    ...(clientId ? { clientId } : {}),
  });

  return (
    <main className="shell">
      <h1>Observations и Behavioral markers</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <form method="get">
        <label>
          Клиент (ID)
          <input type="text" name="clientId" defaultValue={clientId ?? ""} />
        </label>
        <button type="submit">Найти</button>
      </form>

      {clientId ? (
        <>
          <section>
            <h2>Новое наблюдение</h2>
            <CreateObservationForm
              organizationId={membership.organization_id}
              clientId={clientId}
            />
          </section>
          <section>
            <h2>Новый маркер</h2>
            <CreateMarkerForm organizationId={membership.organization_id} clientId={clientId} />
          </section>
        </>
      ) : (
        <p>Укажите клиента, чтобы добавлять наблюдения и маркеры.</p>
      )}

      <section>
        <h2>Observations</h2>
        {observations.items.length === 0 ? (
          <p>Observations не найдены.</p>
        ) : (
          <ul>
            {observations.items.map((observation) => (
              <li key={observation.id}>
                <strong>{observation.description}</strong>{" "}
                <small>
                  ({observation.source_type}, {observation.valence}, интенсивность{" "}
                  {observation.intensity}, уверенность {observation.confidence},{" "}
                  {observation.visibility === "client_visible" ? "видно клиенту" : "приватно"}
                  {observation.supports_improvement ? ", поддерживает улучшение" : ""}
                  {observation.correction_id ? `, correction: ${observation.correction_id}` : ""})
                </small>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Behavioral markers</h2>
        {markers.items.length === 0 ? (
          <p>Маркеры не найдены.</p>
        ) : (
          <ul>
            {markers.items.map((marker) => (
              <li key={marker.id}>
                <strong>{marker.name}</strong>{" "}
                <small>
                  ({marker.marker_type}, шкала {marker.scale_min}–{marker.scale_max}, baseline:{" "}
                  {marker.baseline_value ?? "—"}, текущее: {marker.current_value ?? "—"}, trend:{" "}
                  {marker.trend})
                </small>
                <RecordMarkerValueForm
                  markerId={marker.id}
                  scaleMin={marker.scale_min}
                  scaleMax={marker.scale_max}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
