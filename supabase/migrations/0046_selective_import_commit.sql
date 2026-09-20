-- 0046: Selective import commit (ticket 11).
--
-- Before this migration the import service parsed and committed in one call:
-- every valid candidate became a pending Signal the moment its container
-- validated, so a specialist could not look at the staged records and pick the
-- subset worth keeping. The two-phase flow is now:
--
--   Phase 1 (preview, no Signals): begin_import() + finalize_import() (0041)
--     create the immutable source, its DiagnosticSession and the imports row
--     with the full validation report. The report carries one `records` entry
--     per parsed row plus a `candidates` array holding the validated Signal
--     payload of every committable record.
--
--   Phase 2 (this migration): commit_import_selection() inserts ONLY the
--     selected candidates as pending Signals attached to the import session,
--     records the generated Signal ids in the stored report, updates the
--     authoritative counts and appends the audit row — all in one transaction.
--
-- Template: 0039_atomic_business_mutation.sql. Shared guards from 0041
-- (assert_client_write, insert_signal_row) are reused unchanged and stay
-- internal: they are called by this SECURITY DEFINER RPC with the migration
-- owner's privileges and are granted to no client role.
--
-- Semantics
--   * The import row is locked FOR UPDATE, so two concurrent commits serialize
--     and a replay can never insert a second Signal set.
--   * The selection is a set of record `external_id`s. Candidate payloads are
--     read from the stored report only, so a caller can never inject a Signal
--     the parser did not validate.
--   * Commit is one-shot and idempotent: a completed import returns its stored
--     report when the selection matches and raises a conflict (SQLSTATE 55000)
--     when it does not, instead of silently applying a second selection.
--   * Every inserted Signal is `review_status = pending`: a commit stages
--     evidence, it never confirms it. Human review stays the only way to
--     confirm.
--   * A failure at any step (Signal insert, report update or audit append)
--     rolls the whole transaction back, so a partial Signal set can never
--     survive a failed commit.

create or replace function public.commit_import_selection(
  p_org_id uuid,
  p_client_id uuid,
  p_import_id uuid,
  p_selected jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.imports;
  v_actor uuid;
  v_selected text[];
  v_selected_count integer;
  v_matched integer;
  v_candidates jsonb;
  v_candidate jsonb;
  v_external_id text;
  v_created jsonb := '{}'::jsonb;
  v_signal_ids jsonb := '[]'::jsonb;
  v_signal_id uuid;
  v_report jsonb;
  v_records jsonb;
  v_counts jsonb;
  v_committed integer := 0;
begin
  v_actor := public.assert_client_write(p_org_id, p_client_id);

  select * into v_import
  from public.imports i
  where i.id = p_import_id and i.organization_id = p_org_id
  for update;

  if v_import.id is null then
    raise exception 'import not found' using errcode = '22023';
  end if;

  -- The import must belong to the client whose write access was just asserted:
  -- a mismatched pair is a validation error, never a cross-client commit.
  if v_import.client_id <> p_client_id then
    raise exception 'import does not belong to this client' using errcode = '22023';
  end if;

  if p_selected is null or jsonb_typeof(p_selected) <> 'array' then
    raise exception 'selection must be an array' using errcode = '22023';
  end if;

  -- Deduplicate and order the selection so a replay of the same set compares
  -- equal regardless of the order the UI sent the checkboxes in.
  select coalesce(array_agg(distinct value order by value), '{}'::text[])
  into v_selected
  from jsonb_array_elements_text(p_selected) as s(value);

  v_selected_count := coalesce(array_length(v_selected, 1), 0);
  if v_selected_count = 0 then
    raise exception 'selection is empty' using errcode = '22023';
  end if;

  -- Already committed: the same selection replays the stored result without
  -- writing anything; a different selection is a conflict, not a second commit.
  if v_import.status = 'completed' then
    if coalesce(v_import.report -> 'committed_selection', '[]'::jsonb) = to_jsonb(v_selected) then
      return jsonb_build_object(
        'import_id', v_import.id,
        'session_id', v_import.diagnostic_session_id,
        'status', v_import.status,
        'counts', v_import.counts,
        'report', v_import.report,
        'fatal_errors', v_import.fatal_errors,
        'content_sha256', v_import.content_sha256,
        'signal_ids', coalesce(v_import.report -> 'committed_signal_ids', '[]'::jsonb),
        'reused', true
      );
    end if;
    raise exception 'conflicting_commit_selection' using errcode = '55000';
  end if;

  if v_import.status <> 'awaiting_review' then
    raise exception 'import is not awaiting review' using errcode = '55000';
  end if;

  v_report := coalesce(v_import.report, '{}'::jsonb);
  v_candidates := coalesce(v_report -> 'candidates', '[]'::jsonb);

  -- Every selected id must name a stored candidate; an unknown id aborts the
  -- whole call before a single Signal is written.
  select count(*) into v_matched
  from jsonb_array_elements(v_candidates) c
  where c ->> 'external_id' = any(v_selected);

  if v_matched <> v_selected_count then
    raise exception 'selection names an unknown candidate' using errcode = '22023';
  end if;

  for v_candidate in
    select c
    from jsonb_array_elements(v_candidates) c
    where c ->> 'external_id' = any(v_selected)
    order by coalesce(nullif(c ->> 'record_index', '')::integer, 0)
  loop
    v_external_id := v_candidate ->> 'external_id';

    -- review_status is forced to pending AFTER the stored payload, so a stored
    -- candidate can never promote itself to confirmed evidence.
    v_signal_id := public.insert_signal_row(
      p_org_id,
      p_client_id,
      coalesce(v_candidate -> 'payload', '{}'::jsonb) || jsonb_build_object(
        'diagnostic_session_id', v_import.diagnostic_session_id,
        'review_status', 'pending'
      )
    );

    v_signal_ids := v_signal_ids || to_jsonb(v_signal_id);
    v_created := v_created || jsonb_build_object(v_external_id, to_jsonb(v_signal_id));
    v_committed := v_committed + 1;
  end loop;

  -- Record the lineage in the stored report: every committed record keeps the
  -- Signal id it produced and moves to the terminal record status.
  select coalesce(jsonb_agg(
    case
      when v_created ? (r ->> 'external_id')
        then r || jsonb_build_object(
          'signal_id', v_created -> (r ->> 'external_id'),
          'status', 'committed'
        )
      else r
    end
    order by coalesce(nullif(r ->> 'index', '')::integer, 0)
  ), '[]'::jsonb)
  into v_records
  from jsonb_array_elements(coalesce(v_report -> 'records', '[]'::jsonb)) r;

  v_report := v_report
    || jsonb_build_object('records', v_records)
    || jsonb_build_object('committed_selection', to_jsonb(v_selected))
    || jsonb_build_object('committed_signal_ids', v_signal_ids);

  v_counts := coalesce(v_import.counts, '{}'::jsonb)
    || jsonb_build_object('committed', v_committed);

  update public.imports
  set status = 'completed',
      counts = v_counts,
      report = v_report,
      updated_at = now()
  where id = p_import_id;

  perform public.append_audit(
    p_org_id,
    'import',
    p_import_id,
    'import.committed',
    null,
    jsonb_build_object(
      'input_format', v_import.input_format,
      'committed', v_committed,
      'selected', to_jsonb(v_selected)
    ),
    null, null, null
  );

  return jsonb_build_object(
    'import_id', p_import_id,
    'session_id', v_import.diagnostic_session_id,
    'status', 'completed',
    'counts', v_counts,
    'report', v_report,
    'fatal_errors', v_import.fatal_errors,
    'content_sha256', v_import.content_sha256,
    'signal_ids', v_signal_ids,
    'reused', false
  );
end;
$$;

revoke all on function public.commit_import_selection(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.commit_import_selection(uuid, uuid, uuid, jsonb)
  to authenticated, service_role;
