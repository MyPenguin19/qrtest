-- Reuse platform identities; never grant authority from restaurant membership.
create schema if not exists platform_private;
revoke all on schema platform_private from public, anon, authenticated, service_role;
alter table public.platform_admins add column if not exists created_by uuid;
alter table public.platform_admins add column if not exists is_active boolean not null default false;
alter table public.platform_admins add column if not exists revoked_at timestamptz;
alter table public.platform_admins enable row level security;
drop policy if exists platform_admins_select_self on public.platform_admins;
revoke all on public.platform_admins from public, anon, authenticated, service_role;

create table public.platform_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  action text not null check (action in ('platform_admin.provisioned','platform_admin.revoked','platform_admin.authorization_changed','platform.access_denied')),
  target_type text not null check (target_type in ('platform_admin','platform')),
  target_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  result text not null check (result in ('success','denied')),
  metadata jsonb not null default '{}'::jsonb
);
alter table public.platform_audit_logs enable row level security;
revoke all on public.platform_audit_logs from public, anon, authenticated, service_role;
create index platform_audit_actor_time_idx on public.platform_audit_logs(actor_user_id,created_at desc);

create function platform_private.audit_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin raise exception 'Platform audit records are append-only'; end $$;
create trigger platform_audit_immutable before update or delete on public.platform_audit_logs
for each row execute function platform_private.audit_immutable();
create trigger platform_audit_no_truncate before truncate on public.platform_audit_logs
for each statement execute function platform_private.audit_immutable();

-- Retire the old generic cross-tenant RLS bypass. Existing restaurant predicates
-- still work. Future platform data must use dedicated, guarded RPCs.
create or replace function public.is_platform_admin() returns boolean
language sql stable security invoker set search_path = '' as $$ select false $$;

create function platform_private.audit_admin_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare event text;
begin
  if TG_OP='UPDATE' and new is not distinct from old then return new; end if;
  event := case when TG_OP='INSERT' then 'platform_admin.provisioned'
    when TG_OP='DELETE' or not new.is_active or new.revoked_at is not null then 'platform_admin.revoked'
    else 'platform_admin.authorization_changed' end;
  insert into public.platform_audit_logs(actor_user_id,action,target_type,target_id,result,metadata)
    values (auth.uid(),event,'platform_admin',case when TG_OP='DELETE' then old.user_id else new.user_id end,'success',
      jsonb_build_object('operator_role',session_user,'source','trusted_database_operator'));
  if TG_OP='DELETE' then return old; end if;
  return new;
end $$;
create trigger platform_admin_change after insert or update or delete on public.platform_admins
for each row execute function platform_private.audit_admin_change();

-- No Data API role can execute this operation. Human bootstrap/recovery is a
-- trusted SQL operator action, not a browser endpoint or service-role RPC.
create function public.platform_set_admin(p_user_id uuid,p_active boolean) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_active is null then raise exception 'Active state required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,351));
  if p_active then
    if not exists(select 1 from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()))
      or not exists(select 1 from auth.mfa_factors f where f.user_id=p_user_id and f.status='verified') then
      raise exception 'Existing verified identity with verified MFA required';
    end if;
    insert into public.platform_admins(user_id,created_by,is_active) values(p_user_id,auth.uid(),true)
      on conflict(user_id) do update set is_active=true,revoked_at=null
      where not platform_admins.is_active or platform_admins.revoked_at is not null;
  else
    update public.platform_admins set is_active=false,revoked_at=clock_timestamp()
      where user_id=p_user_id and (is_active or revoked_at is null);
  end if;
end $$;
revoke all on function public.platform_set_admin(uuid,boolean) from public,anon,authenticated,service_role;

-- JWT claims are verified by the Data API. No actor/scope/role arguments.
create function public.platform_admin_status() returns text
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); claims jsonb := auth.jwt(); outcome text := 'denied';
begin
  if uid is null then return 'denied'; end if;
  if exists(select 1 from auth.users u where u.id=uid and u.email_confirmed_at is not null
      and not coalesce(u.is_anonymous,false) and (u.banned_until is null or u.banned_until<=now()))
    and exists(select 1 from auth.sessions s where s.user_id=uid and s.id::text=claims->>'session_id'
      and (s.not_after is null or s.not_after>now()))
    and coalesce((claims->>'exp')::numeric,0)>extract(epoch from now())
    and exists(select 1 from public.platform_admins a where a.user_id=uid and a.is_active and a.revoked_at is null) then
    outcome := 'mfa_required';
    if claims->>'aal'='aal2'
      and exists(select 1 from auth.sessions s where s.user_id=uid and s.id::text=claims->>'session_id' and s.aal='aal2')
      and exists(select 1 from auth.mfa_factors f where f.user_id=uid and f.status='verified') then
      return 'allowed';
    end if;
  end if;
  -- At most one denial per validated identity per minute. No request payload,
  -- email, factor secret, PIN, token or credential is recorded.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text,352));
  if not exists(select 1 from public.platform_audit_logs where actor_user_id=uid
      and action='platform.access_denied' and created_at>now()-interval '1 minute') then
    insert into public.platform_audit_logs(actor_user_id,action,target_type,result)
      values(uid,'platform.access_denied','platform','denied');
  end if;
  return outcome;
end $$;
revoke all on function public.platform_admin_status() from public,anon,service_role;
grant execute on function public.platform_admin_status() to authenticated;
revoke all on all functions in schema platform_private from public,anon,authenticated,service_role;
