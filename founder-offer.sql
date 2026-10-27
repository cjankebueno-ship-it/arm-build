begin;
create schema if not exists tf_private;
revoke all on schema tf_private from public,anon;
grant usage on schema tf_private to authenticated;
create table public.tf_founder_offer (
 id integer primary key check(id=1), capacity integer not null default 25 check(capacity=25),
 reserved integer not null default 0 check(reserved between 0 and 25),
 monthly_cents integer not null default 1900 check(monthly_cents=1900),
 annual_cents integer not null default 19000 check(annual_cents=19000),
 currency text not null default 'USD', billing_live boolean not null default false
);
insert into public.tf_founder_offer(id) values(1);
alter table public.tf_founder_offer enable row level security;
revoke all on public.tf_founder_offer from public,anon,authenticated;
grant select on public.tf_founder_offer to anon,authenticated;
create policy tf_founder_offer_read on public.tf_founder_offer for select to anon,authenticated using (true);
create table tf_private.founder_reservations (
 trainer_id uuid primary key references auth.users(id), reservation_number integer unique not null,
 monthly_cents integer not null default 1900, annual_cents integer not null default 19000,
 terms_version text not null default '2026-10-27', reserved_at timestamptz not null default now()
);
alter table tf_private.founder_reservations enable row level security;
revoke all on tf_private.founder_reservations from public,anon,authenticated;
create or replace function tf_private.founder_reservation(claim boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); existing jsonb; offer public.tf_founder_offer; next_number integer;
begin
 if owner_id is null then raise exception 'Sign in to reserve founder pricing';end if;
 select to_jsonb(r) - 'trainer_id' into existing from tf_private.founder_reservations r where trainer_id=owner_id;
 if existing is not null or not claim then return existing;end if;
 select * into offer from public.tf_founder_offer where id=1 for update;
 -- Repeat inside the lock, so two tabs cannot reserve twice.
 select to_jsonb(r) - 'trainer_id' into existing from tf_private.founder_reservations r where trainer_id=owner_id;
 if existing is not null then return existing;end if;
 if offer.reserved>=offer.capacity then raise exception 'All 25 founder reservations have been claimed. You can still use the free plan.';end if;
 next_number:=offer.reserved+1;
 insert into tf_private.founder_reservations(trainer_id,reservation_number) values(owner_id,next_number) returning to_jsonb(founder_reservations.*)-'trainer_id' into existing;
 update public.tf_founder_offer set reserved=next_number where id=1;
 return existing;
end $$;
revoke all on function tf_private.founder_reservation(boolean) from public,anon;
grant execute on function tf_private.founder_reservation(boolean) to authenticated;
create function public.tf_founder_reservation(claim boolean default false) returns jsonb
language sql security invoker set search_path='' as $$ select tf_private.founder_reservation(claim); $$;
revoke all on function public.tf_founder_reservation(boolean) from public,anon;
grant execute on function public.tf_founder_reservation(boolean) to authenticated;
grant all on public.tf_founder_offer,tf_private.founder_reservations to service_role;
commit;
