import Link from "next/link";
import { redirect } from "next/navigation";
import { listBeliefTemplates, listDomains } from "@/lib/service/ontology";
import { createClient } from "@/lib/supabase/server";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const q = first(params.q);
  const scope = first(params.scope);
  const selectedDomainId = first(params.domain);

  const domains = await listDomains(supabase, {
    ...(q ? { q } : {}),
    ...(scope ? { scope } : {}),
  });

  const selectedDomain = selectedDomainId
    ? domains.items.find((domain) => domain.id === selectedDomainId)
    : undefined;
  const templates = selectedDomainId
    ? await listBeliefTemplates(supabase, { domainId: selectedDomainId })
    : null;

  return (
    <main className="shell">
      <h1>Диагностическая библиотека</h1>
      <p>
        <Link href="/">← На главную</Link>
      </p>

      <form method="get">
        <label>
          Поиск
          <input type="search" name="q" defaultValue={q ?? ""} />
        </label>
        <label>
          Источник
          <select name="scope" defaultValue={scope ?? "all"}>
            <option value="all">Все</option>
            <option value="system">Системные</option>
            <option value="organization">Организации</option>
          </select>
        </label>
        <button type="submit">Найти</button>
      </form>

      {domains.items.length === 0 ? (
        <p>Данных недостаточно: домены не найдены.</p>
      ) : (
        <ul>
          {domains.items.map((domain) => (
            <li key={domain.id}>
              <Link href={`/library?domain=${domain.id}`}>{domain.name}</Link>{" "}
              <small>({domain.is_system ? "системный" : "организации"})</small>
              {domain.description ? <p>{domain.description}</p> : null}
            </li>
          ))}
        </ul>
      )}

      {selectedDomain && templates ? (
        <section>
          <h2>{selectedDomain.name}: шаблоны установок</h2>
          <p>
            <small>
              Шаблон установки не является evidence. Evidence появляется только после реального
              тестирования.
            </small>
          </p>
          {templates.items.length === 0 ? (
            <p>Шаблонов пока нет.</p>
          ) : (
            <ul>
              {templates.items.map((template) => (
                <li key={template.id}>
                  {template.statement} <small>({template.statement_polarity})</small>
                  {template.interpretation_hint ? (
                    <p>
                      <small>{template.interpretation_hint}</small>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </main>
  );
}
