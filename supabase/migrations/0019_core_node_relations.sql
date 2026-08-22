-- 0019: CoreNodeRelation + TriggerActivation (ticket 27).

create table public.core_node_relations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  from_core_node_id uuid not null references public.core_nodes (id) on delete cascade,
  to_core_node_id uuid not null references public.core_nodes (id) on delete cascade,
  relation_type text not null check (relation_type in (
    'may_contribute_to', 'reinforces', 'protects_from', 'compensates_for', 'triggers',
    'depends_on', 'contradicts', 'unlocks', 'is_variant_of', 'associated_with',
    'supports_hypothesis_of', 'causes_confirmed'
  )),
  strength integer check (strength between 0 and 100),
  confidence integer check (confidence between 0 and 100),
  evidence_summary text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trigger_activations (
  id uuid primary key default gen_random_uuid(),
  trigger_id uuid not null references public.triggers (id) on delete cascade,
  theme_id uuid references public.themes (id) on delete cascade,
  core_node_id uuid references public.core_nodes (id) on delete cascade,
  activation_delta integer check (activation_delta between -100 and 100),
  confidence integer check (confidence between 0 and 100),
  rationale text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index core_node_relations_client_idx on public.core_node_relations (client_id);
create index trigger_activations_trigger_idx on public.trigger_activations (trigger_id);

alter table public.core_node_relations enable row level security;
alter table public.trigger_activations enable row level security;

create policy "assigned read relations" on public.core_node_relations
  for select using (public.is_client_accessible(organization_id, client_id, false));
create policy "assigned insert relations" on public.core_node_relations
  for insert with check (public.is_client_accessible(organization_id, client_id, true));
create policy "assigned update relations" on public.core_node_relations
  for update using (public.is_client_accessible(organization_id, client_id, true));

create policy "assigned read activations" on public.trigger_activations
  for select using (exists (
    select 1 from public.triggers t
    where t.id = trigger_id and public.is_client_accessible(t.organization_id, t.client_id, false)
  ));
create policy "assigned insert activations" on public.trigger_activations
  for insert with check (exists (
    select 1 from public.triggers t
    where t.id = trigger_id and public.is_client_accessible(t.organization_id, t.client_id, true)
  ));

grant select, insert, update on public.core_node_relations to authenticated;
grant select, insert, update, delete on public.core_node_relations to service_role;
grant select, insert on public.trigger_activations to authenticated;
grant select, insert, update, delete on public.trigger_activations to service_role;
