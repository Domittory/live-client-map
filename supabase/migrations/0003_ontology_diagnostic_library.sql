-- 0003: OntologyVersion + Diagnostic library (ticket 16).
-- Versioned ontology catalog: system DiagnosticDomain / BeliefTemplate records
-- plus organization-scoped extensions. System records stay distinguishable
-- (is_system, organization_id is null) and immutable for tenants.

-- OntologyVersion (SPEC §49): snapshots reference it as ontology_version.
create table public.ontology_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  life_areas text[] not null default '{}',
  relation_types text[] not null default '{}',
  domain_types text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

-- DiagnosticDomain (SPEC §8.34): library of diagnostic themes.
create table public.diagnostic_domains (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  ontology_version_id uuid not null references public.ontology_versions (id),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  domain_group text,
  life_areas text[] not null default '{}',
  default_priority integer check (default_priority is null or (default_priority between 0 and 100)),
  version integer not null default 1 check (version >= 1),
  language text not null default 'ru' check (language ~ '^[a-z]{2}$'),
  applicable_contexts text[] not null default '{}',
  contraindicated_contexts text[] not null default '{}',
  is_system boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- System records are global (organization_id null); org records never are.
  check ((organization_id is null) = is_system)
);

-- System slugs are unique globally; org slugs are unique within the org.
create unique index diagnostic_domains_system_slug_key
  on public.diagnostic_domains (slug)
  where organization_id is null;
create unique index diagnostic_domains_org_slug_key
  on public.diagnostic_domains (organization_id, slug)
  where organization_id is not null;
create index diagnostic_domains_organization_idx
  on public.diagnostic_domains (organization_id)
  where organization_id is not null;

-- BeliefTemplate (SPEC §8.35).
-- NOT evidence (SPEC §8.35, §3.5): the table intentionally has no
-- evidence_count / confidence / score columns and no link to signals.
-- Evidence appears only after real testing creates a Signal (later tickets).
create table public.belief_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  diagnostic_domain_id uuid not null references public.diagnostic_domains (id),
  ontology_version_id uuid not null references public.ontology_versions (id),
  code text,
  statement text not null,
  statement_polarity text not null default 'unknown'
    check (statement_polarity in ('positive', 'negative', 'neutral', 'mixed', 'unknown')),
  default_life_areas text[] not null default '{}',
  default_tags text[] not null default '{}',
  interpretation_hint text,
  root_hypothesis_hint text,
  version integer not null default 1 check (version >= 1),
  language text not null default 'ru' check (language ~ '^[a-z]{2}$'),
  is_system boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check ((organization_id is null) = is_system)
);

create unique index belief_templates_system_code_key
  on public.belief_templates (code)
  where organization_id is null and code is not null;
create index belief_templates_domain_idx
  on public.belief_templates (diagnostic_domain_id);
create index belief_templates_organization_idx
  on public.belief_templates (organization_id)
  where organization_id is not null;

-- Row level security.
-- System records: readable by every authenticated user, writable only by the
-- service role (no authenticated write policies => tenants cannot change them).
-- Org records: readable/writable only by active members of that organization.
alter table public.ontology_versions enable row level security;
alter table public.diagnostic_domains enable row level security;
alter table public.belief_templates enable row level security;

-- Table privileges; RLS above still constrains which rows each role touches.
grant select on public.ontology_versions to authenticated;
grant select, insert, update on public.diagnostic_domains to authenticated;
grant select, insert, update on public.belief_templates to authenticated;
grant all on public.ontology_versions to service_role;
grant all on public.diagnostic_domains to service_role;
grant all on public.belief_templates to service_role;

-- The 0002 platform tables predate explicit API-role grants; library flows and
-- the app shell read membership through them, so grant access here.
grant select on public.profiles to authenticated;
grant select on public.organizations to authenticated;
grant select on public.organization_members to authenticated;
grant all on public.profiles to service_role;
grant all on public.organizations to service_role;
grant all on public.organization_members to service_role;

create policy "authenticated read ontology versions" on public.ontology_versions
  for select to authenticated using (true);

create policy "read system or own-org domains" on public.diagnostic_domains
  for select to authenticated
  using (is_system or public.is_org_member(organization_id));

create policy "org members create org domains" on public.diagnostic_domains
  for insert to authenticated
  with check (not is_system and public.is_org_member(organization_id));

create policy "org members update org domains" on public.diagnostic_domains
  for update to authenticated
  using (not is_system and public.is_org_member(organization_id))
  with check (not is_system and public.is_org_member(organization_id));

create policy "read system or own-org belief templates" on public.belief_templates
  for select to authenticated
  using (is_system or public.is_org_member(organization_id));

create policy "org members create org belief templates" on public.belief_templates
  for insert to authenticated
  with check (
    not is_system
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.diagnostic_domains d
      where d.id = diagnostic_domain_id
        and (d.is_system or d.organization_id = belief_templates.organization_id)
    )
  );

create policy "org members update org belief templates" on public.belief_templates
  for update to authenticated
  using (not is_system and public.is_org_member(organization_id))
  with check (not is_system and public.is_org_member(organization_id));

-- System seed: ontology version metadata + SPEC §50 diagnostic domains.
-- System data ships inside the migration so a clean rebuild always has it.
insert into public.ontology_versions (version, life_areas, relation_types, domain_types)
values (
  '1.0.0',
  -- SPEC fixes no canonical life-area vocabulary; free-form slugs are used.
  '{}',
  -- SPEC §8.16 relation types (causes_confirmed only via manual specialist confirmation).
  array[
    'may_contribute_to', 'reinforces', 'protects_from', 'compensates_for',
    'triggers', 'depends_on', 'contradicts', 'unlocks', 'is_variant_of',
    'associated_with', 'supports_hypothesis_of', 'causes_confirmed'
  ],
  array[
    'separation', 'father', 'mother', 'inner-support', 'authority', 'leadership',
    'responsibility', 'boundaries', 'money', 'success', 'visibility',
    'personal-power', 'work-and-suffering', 'parenthood', 'relationships',
    'freedom', 'perfectionism', 'control', 'shame', 'guilt', 'belonging',
    'safety', 'body-symptom', 'resources'
  ]
);

insert into public.diagnostic_domains (ontology_version_id, slug, name, is_system)
select v.id, s.slug, s.name, true
from public.ontology_versions v
cross join (
  values
    ('separation', 'Сепарация'),
    ('father', 'Отец'),
    ('mother', 'Мать'),
    ('inner-support', 'Внутренняя опора'),
    ('authority', 'Авторитет'),
    ('leadership', 'Лидерство'),
    ('responsibility', 'Ответственность'),
    ('boundaries', 'Границы'),
    ('money', 'Деньги'),
    ('success', 'Успех'),
    ('visibility', 'Проявленность'),
    ('personal-power', 'Личная сила'),
    ('work-and-suffering', 'Работа и страдание'),
    ('parenthood', 'Родительство'),
    ('relationships', 'Отношения'),
    ('freedom', 'Свобода'),
    ('perfectionism', 'Перфекционизм'),
    ('control', 'Контроль'),
    ('shame', 'Стыд'),
    ('guilt', 'Вина'),
    ('belonging', 'Принадлежность'),
    ('safety', 'Безопасность'),
    ('body-symptom', 'Тело / симптом'),
    ('resources', 'Ресурсы')
) as s (slug, name)
where v.version = '1.0.0';
