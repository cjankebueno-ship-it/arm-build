-- Trainer Floor durable saves, revision history, source notes and Asana receipts.
begin;
alter table public.tf_clients add column if not exists revision bigint not null default 1;
alter table public.tf_clients add column if not exists last_mutation_id uuid;
alter table public.tf_clients add column if not exists pinned_on date;
alter table public.tf_sessions add column if not exists revision bigint not null default 1;
alter table public.tf_sessions add column if not exists last_mutation_id uuid;

create table if not exists public.tf_session_revisions (
  id uuid primary key default gen_random_uuid(), trainer_id uuid not null references auth.users(id),
  session_id uuid not null references public.tf_sessions(id), revision bigint not null,
  snapshot jsonb not null, saved_at timestamptz not null default now(), unique(session_id,revision)
);
create table if not exists public.tf_recovered_notes (
  id uuid primary key, trainer_id uuid not null references auth.users(id),
  client_id uuid not null references public.tf_clients(id), source_name text not null,
  source_ref text not null, raw_text text not null, reconciliation jsonb not null default '[]',
  created_at timestamptz not null default now(), unique(trainer_id,client_id,source_ref)
);
create table if not exists public.tf_integrations (
  trainer_id uuid primary key references auth.users(id), asana_project_gid text not null,
  enabled boolean not null default true, cadence text not null default 'hourly',
  last_checked_at timestamptz
);
create table if not exists public.tf_asana_sync (
  session_id uuid primary key references public.tf_sessions(id), trainer_id uuid not null references auth.users(id),
  requested_revision bigint not null, synced_revision bigint, asana_task_gid text, asana_url text,
  status text not null default 'pending' check(status in ('pending','synced','error')),
  last_error text, synced_at timestamptz
);
create index if not exists tf_revisions_trainer_idx on public.tf_session_revisions(trainer_id,session_id,saved_at desc);
create index if not exists tf_recovered_trainer_idx on public.tf_recovered_notes(trainer_id,client_id);
create index if not exists tf_asana_pending_idx on public.tf_asana_sync(trainer_id,status);
alter table public.tf_session_revisions enable row level security;
alter table public.tf_recovered_notes enable row level security;
alter table public.tf_integrations enable row level security;
alter table public.tf_asana_sync enable row level security;
revoke all on public.tf_session_revisions,public.tf_recovered_notes,public.tf_integrations,public.tf_asana_sync from anon;
grant select,insert on public.tf_session_revisions to authenticated;
grant select on public.tf_recovered_notes,public.tf_integrations to authenticated;
grant select,insert,update on public.tf_asana_sync to authenticated;
grant all on public.tf_session_revisions,public.tf_recovered_notes,public.tf_integrations,public.tf_asana_sync to service_role;
create policy tf_revisions_read on public.tf_session_revisions for select to authenticated using ((select auth.uid())=trainer_id);
create policy tf_revisions_write on public.tf_session_revisions for insert to authenticated with check ((select auth.uid())=trainer_id and exists(select 1 from public.tf_sessions s where s.id=session_id and s.trainer_id=(select auth.uid())));
create policy tf_recovered_read on public.tf_recovered_notes for select to authenticated using ((select auth.uid())=trainer_id);
create policy tf_integrations_read on public.tf_integrations for select to authenticated using ((select auth.uid())=trainer_id);
create policy tf_asana_read on public.tf_asana_sync for select to authenticated using ((select auth.uid())=trainer_id);
create policy tf_asana_insert on public.tf_asana_sync for insert to authenticated with check ((select auth.uid())=trainer_id and exists(select 1 from public.tf_sessions s where s.id=session_id and s.trainer_id=(select auth.uid())));
create policy tf_asana_update on public.tf_asana_sync for update to authenticated using ((select auth.uid())=trainer_id) with check ((select auth.uid())=trainer_id);

create or replace function public.tf_record_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.trainer_id is distinct from new.trainer_id then raise exception 'Trainer cannot be changed'; end if;
  new.revision:=old.revision+1; new.updated_at:=now();
  if tg_table_name='tf_sessions' then
    insert into public.tf_session_revisions(trainer_id,session_id,revision,snapshot)
      values(old.trainer_id,old.id,old.revision,to_jsonb(old)) on conflict(session_id,revision) do nothing;
  end if;
  return new;
end $$;
create trigger tf_clients_revision before update on public.tf_clients for each row execute function public.tf_record_revision();
create trigger tf_sessions_revision before update on public.tf_sessions for each row execute function public.tf_record_revision();

create or replace function public.tf_queue_asana() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.tf_integrations where trainer_id=new.trainer_id and enabled)
     and (new.completed_at is not null or (tg_op='UPDATE' and old.completed_at is not null)) then
    insert into public.tf_asana_sync(session_id,trainer_id,requested_revision,status)
    values(new.id,new.trainer_id,new.revision,'pending')
    on conflict(session_id) do update set requested_revision=excluded.requested_revision,status='pending',last_error=null;
  end if;
  return new;
end $$;
create trigger tf_sessions_asana after insert or update on public.tf_sessions for each row execute function public.tf_queue_asana();

-- Per-record serialization, retry idempotence, and optimistic concurrency.
create or replace function public.tf_save_record(p_kind text,p_record jsonb,p_expected_revision bigint,p_mutation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  owner_id uuid:=auth.uid(); record_id uuid:=(p_record->>'id')::uuid;
  existing jsonb; result_row jsonb; table_name text;
begin
  if owner_id is null or p_mutation_id is null then raise exception 'Authentication required'; end if;
  if p_kind not in ('client','session') then raise exception 'Invalid record kind'; end if;
  table_name:=case when p_kind='client' then 'tf_clients' else 'tf_sessions' end;
  perform pg_advisory_xact_lock(hashtextextended(p_kind||record_id::text,0));
  execute format('select to_jsonb(t) from public.%I t where id=$1 and trainer_id=$2 for update',table_name) into existing using record_id,owner_id;
  if existing is not null and existing->>'last_mutation_id'=p_mutation_id::text then return existing; end if;
  if (existing is not null and (existing->>'revision')::bigint is distinct from p_expected_revision)
     or (existing is null and coalesce(p_expected_revision,0)<>0) then
    raise exception using message='TF_CONFLICT: This record changed on another device.',errcode='P0001';
  end if;
  if p_kind='client' then
    if length(trim(coalesce(p_record->>'name','')))=0 then raise exception 'Client name required'; end if;
    insert into public.tf_clients(id,trainer_id,name,note,archived,pinned_on,last_mutation_id)
    values(record_id,owner_id,trim(p_record->>'name'),coalesce(p_record->>'note',''),coalesce((p_record->>'archived')::boolean,false),nullif(p_record->>'pinned_on','')::date,p_mutation_id)
    on conflict(id) do update set name=excluded.name,note=excluded.note,archived=excluded.archived,pinned_on=excluded.pinned_on,last_mutation_id=excluded.last_mutation_id
    returning to_jsonb(tf_clients.*) into result_row;
  else
    if not exists(select 1 from public.tf_clients where id=(p_record->>'client_id')::uuid and trainer_id=owner_id) then raise exception 'Client not found'; end if;
    if jsonb_typeof(p_record->'workout') is distinct from 'array' then raise exception 'Workout must be an array'; end if;
    insert into public.tf_sessions(id,trainer_id,client_id,session_date,workout,session_note,completed_at,last_mutation_id)
    values(record_id,owner_id,(p_record->>'client_id')::uuid,(p_record->>'session_date')::date,p_record->'workout',coalesce(p_record->>'session_note',''),(p_record->>'completed_at')::timestamptz,p_mutation_id)
    on conflict(id) do update set client_id=excluded.client_id,session_date=excluded.session_date,workout=excluded.workout,session_note=excluded.session_note,completed_at=excluded.completed_at,last_mutation_id=excluded.last_mutation_id
    returning to_jsonb(tf_sessions.*) into result_row;
  end if;
  return result_row;
end $$;
revoke all on function public.tf_save_record(text,jsonb,bigint,uuid) from public,anon;
grant execute on function public.tf_save_record(text,jsonb,bigint,uuid) to authenticated;
revoke all on function public.tf_record_revision(), public.tf_queue_asana() from public,anon;
grant execute on function public.tf_record_revision(), public.tf_queue_asana() to authenticated;
commit;
