-- Account controls are deliberately separate from owner-editable restaurant settings.
create table platform_private.restaurant_controls (
 restaurant_id uuid primary key references public.restaurants(id),
 suspended boolean not null default false,
 version integer not null default 0,
 changed_at timestamptz not null default clock_timestamp(),
 changed_by uuid not null,
 reason text not null
);
alter table platform_private.restaurant_controls enable row level security;
revoke all on platform_private.restaurant_controls from public,anon,authenticated,service_role;

alter table public.platform_audit_logs drop constraint platform_audit_logs_action_check;
alter table public.platform_audit_logs add constraint platform_audit_logs_action_check check(action in
 ('platform_admin.provisioned','platform_admin.revoked','platform_admin.authorization_changed','platform.access_denied',
 'restaurant.suspended','restaurant.reactivated','restaurant.control_denied','restaurant.control_failed'));
alter table public.platform_audit_logs drop constraint platform_audit_logs_target_type_check;
alter table public.platform_audit_logs add constraint platform_audit_logs_target_type_check check(target_type in ('platform_admin','platform','restaurant'));
alter table public.platform_audit_logs drop constraint platform_audit_logs_result_check;
alter table public.platform_audit_logs add constraint platform_audit_logs_result_check check(result in ('success','denied','failed'));
alter table public.platform_audit_logs add column request_id uuid not null default gen_random_uuid(),
 add column previous_state jsonb, add column new_state jsonb, add column reason text;
create index platform_audit_time_idx on public.platform_audit_logs(created_at desc,id);
create index platform_audit_target_time_idx on public.platform_audit_logs(target_id,created_at desc);
create index platform_audit_action_time_idx on public.platform_audit_logs(action,created_at desc);
create unique index platform_control_request_once on public.platform_audit_logs(actor_user_id,request_id)
 where action in ('restaurant.suspended','restaurant.reactivated','restaurant.control_denied','restaurant.control_failed');

create function platform_private.recent_mfa() returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from auth.mfa_amr_claims m join auth.sessions s on s.id=m.session_id
 where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id' and m.authentication_method='totp'
 and m.updated_at between now()-interval '10 minutes' and now());
$$;

create function platform_private.suspension_blockers(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object(
 'open_visits',(select count(*) from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id join public.branches b on b.id=t.branch_id where b.restaurant_id=p_id and s.status<>'closed'),
 'unfinished_orders',(select count(*) from public.orders o where o.restaurant_id=p_id and o.status in ('pending','accepted','preparing','ready')),
 'pending_payments',(select count(*) from public.payments p where p.restaurant_id=p_id and p.status='pending'),
 'unsettled_bills',(select count(*) from public.bills b where b.restaurant_id=p_id and b.total_amount>0 and
   (b.status<>'paid' or not exists(select 1 from public.payments p where p.bill_id=b.id and p.restaurant_id=p_id and p.status='paid' and p.amount>=b.total_amount))),
 'unsettled_orders',(select count(*) from public.orders o where o.restaurant_id=p_id and o.status<>'cancelled' and o.total_amount>0
   and not exists(select 1 from public.payments p where p.order_id=o.id and p.restaurant_id=p_id and p.status='paid' and p.amount>=o.total_amount)
   and not exists(select 1 from public.bills b join public.payments p on p.bill_id=b.id and p.restaurant_id=p_id and p.status='paid' and p.amount>=b.total_amount
     where b.table_session_id=o.table_session_id and b.restaurant_id=p_id and b.status='paid')));
$$;

-- Publicly safe boolean only: no internal reason/administrator information.
create function public.restaurant_account_available(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.restaurants r where r.id=p_id)
 and not exists(select 1 from platform_private.restaurant_controls c where c.restaurant_id=p_id and c.suspended);
$$;
revoke all on function public.restaurant_account_available(uuid) from public;
grant execute on function public.restaurant_account_available(uuid) to anon,authenticated,service_role;

-- New work and account state changes share the same restaurant lock. This also
-- covers service-role and direct inserts, not just the web UI.
create function platform_private.enforce_account() returns trigger
language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if TG_TABLE_NAME='table_sessions' then
   if TG_OP='UPDATE' and not (old.status='closed' and new.status<>'closed') then return new; end if;
   select b.restaurant_id into rid from public.restaurant_tables t join public.branches b on b.id=t.branch_id where t.id=new.table_id;
 elsif TG_TABLE_NAME='waiter_requests' then
   select b.restaurant_id into rid from public.branches b where b.id=new.branch_id;
 else rid:=new.restaurant_id;
 end if;
 perform 1 from public.restaurants where id=rid for share;
 if not public.restaurant_account_available(rid) then
   raise exception 'Ordering is temporarily unavailable. Please contact restaurant staff.' using errcode='42501';
 end if;
 return new;
end $$;
create trigger account_order_guard before insert on public.orders for each row execute function platform_private.enforce_account();
create trigger account_visit_guard before insert or update on public.table_sessions for each row execute function platform_private.enforce_account();
create trigger account_request_guard before insert on public.waiter_requests for each row execute function platform_private.enforce_account();
create trigger account_payment_guard before insert on public.payments for each row execute function platform_private.enforce_account();

create function public.platform_restaurant_control(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform platform_private.require_reporting_admin();
 select jsonb_build_object('suspended',coalesce(c.suspended,false),'version',coalesce(c.version,0),
 'changed_at',c.changed_at,'changed_by',c.changed_by,'reason',c.reason,
 'recent_mfa',platform_private.recent_mfa(),'blockers',platform_private.suspension_blockers(r.id),
 'historical_orders',(select count(*) from public.orders o where o.restaurant_id=r.id),
 'setup_ready',exists(select 1 from public.branches b where b.restaurant_id=r.id and b.is_active)
   and exists(select 1 from public.menu_items i join public.menu_categories k on k.id=i.category_id and k.restaurant_id=r.id where i.restaurant_id=r.id and i.is_available))
 into result from public.restaurants r left join platform_private.restaurant_controls c on c.restaurant_id=r.id where r.id=p_id;
 return result;
end $$;

create function public.platform_set_restaurant_account(p_id uuid,p_suspend boolean,p_reason text,p_confirm boolean,p_expected_version integer,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); c platform_private.restaurant_controls; prior public.platform_audit_logs;
 code text; outcome text:='denied'; event text:='restaurant.control_denied'; prev jsonb; next_state jsonb;
 safe_reason text; desired text:=case when p_suspend then 'suspended' else 'active' end;
begin
 -- Locks prevent concurrent revocation from racing a permitted mutation.
 perform 1 from public.platform_admins where user_id=actor for share;
 perform 1 from auth.sessions where user_id=actor and id::text=auth.jwt()->>'session_id' for share;
 if public.platform_admin_status()<>'allowed' then code:='denied';
 elsif not platform_private.recent_mfa() then code:='recent_mfa_required';
 end if;
 safe_reason:=case when p_reason in ('security_review','operational_request','review_resolved') then p_reason else null end;
 if p_request is null then p_request:=gen_random_uuid(); code:=coalesce(code,'invalid_request'); end if;
 -- Correlation IDs are never actor/authorization claims. Serialize reused IDs.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(coalesce(actor::text,'anonymous')||p_request::text,353));
 if code is null then
   select * into prior from public.platform_audit_logs where actor_user_id=actor and request_id=p_request
     and action in ('restaurant.suspended','restaurant.reactivated','restaurant.control_denied','restaurant.control_failed');
   if prior.id is not null then
     if prior.target_id is distinct from p_id or prior.metadata->>'desired' is distinct from desired
       or prior.reason is distinct from safe_reason then return jsonb_build_object('code','request_conflict'); end if;
     return jsonb_build_object('code',prior.metadata->>'code','replayed',true);
   end if;
   if p_id is null or p_suspend is null or p_confirm is distinct from true or safe_reason is null
     or p_expected_version is null or p_expected_version<0 then code:='invalid_request';
   else
     perform 1 from public.restaurants where id=p_id for update;
     if not found then code:='not_found';
     else
       select * into c from platform_private.restaurant_controls where restaurant_id=p_id;
       prev:=jsonb_build_object('suspended',coalesce(c.suspended,false),'version',coalesce(c.version,0));
       if coalesce(c.version,0)<>p_expected_version then code:='stale_state';
       elsif coalesce(c.suspended,false)=p_suspend then return jsonb_build_object('code','unchanged');
       elsif p_suspend and exists(select 1 from jsonb_each_text(platform_private.suspension_blockers(p_id)) v where v.value::bigint>0) then code:='unresolved_activity';
       else
         -- Exception subtransaction rolls back BOTH state and success event.
         begin
           insert into platform_private.restaurant_controls(restaurant_id,suspended,version,changed_by,reason)
             values(p_id,p_suspend,1,actor,safe_reason)
             on conflict(restaurant_id) do update set suspended=p_suspend,version=restaurant_controls.version+1,
               changed_at=clock_timestamp(),changed_by=actor,reason=safe_reason returning * into c;
           next_state:=jsonb_build_object('suspended',c.suspended,'version',c.version);
           insert into public.platform_audit_logs(actor_user_id,action,target_type,target_id,result,request_id,previous_state,new_state,reason,metadata)
             values(actor,case when p_suspend then 'restaurant.suspended' else 'restaurant.reactivated' end,'restaurant',p_id,'success',p_request,prev,next_state,safe_reason,
               jsonb_build_object('desired',desired,'code','changed'));
           return jsonb_build_object('code','changed');
         exception when others then code:='operation_failed';outcome:='failed';event:='restaurant.control_failed'; end;
       end if;
     end if;
   end if;
 end if;
 -- Return denial normally: an exception here would roll back security telemetry.
 -- Never log arbitrary submitted strings, claims, request bodies or raw errors.
 insert into public.platform_audit_logs(actor_user_id,action,target_type,target_id,result,request_id,reason,metadata)
 values(actor,event,'restaurant',p_id,outcome,p_request,safe_reason,jsonb_build_object('desired',desired,'code',code))
 on conflict(actor_user_id,request_id) where action in ('restaurant.suspended','restaurant.reactivated','restaurant.control_denied','restaurant.control_failed') do nothing;
 return jsonb_build_object('code',code);
end $$;

create function public.platform_audit(p_page integer default 1,p_size integer default 25,p_from timestamptz default null,p_to timestamptz default null,p_action text default '',p_restaurant uuid default null,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare audit_result jsonb;
begin
 perform platform_private.require_reporting_admin();
 if p_page is null or p_page not between 1 and 1000000 or p_size is null or p_size not in (25,50) or length(p_action)>80
 or (p_from is not null and p_to is not null and p_from>=p_to) then raise exception 'Invalid audit options'; end if;
 with matches as materialized(select id,created_at,actor_user_id,action,target_type,target_id,result,request_id,previous_state,new_state,reason,
   metadata->>'code' as code from public.platform_audit_logs
   where (p_from is null or created_at>=p_from) and (p_to is null or created_at<p_to)
   and (p_action='' or action=p_action) and (p_restaurant is null or (target_type='restaurant' and target_id=p_restaurant))
   and (p_actor is null or actor_user_id=p_actor)),
 page as(select * from matches order by created_at desc,id limit p_size offset (p_page-1)*p_size)
 select jsonb_build_object('total',(select count(*) from matches),'page',p_page,'size',p_size,
 'rows',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb)) into audit_result;
 return audit_result;
end $$;
create function public.platform_controls_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform platform_private.require_reporting_admin();
 return jsonb_build_object('active_admins',(select count(*) from public.platform_admins where is_active and revoked_at is null),
 'suspended_accounts',(select count(*) from platform_private.restaurant_controls where suspended),'recent_mfa',platform_private.recent_mfa());
end $$;
revoke all on function public.platform_restaurant_control(uuid),public.platform_set_restaurant_account(uuid,boolean,text,boolean,integer,uuid),
 public.platform_audit(integer,integer,timestamptz,timestamptz,text,uuid,uuid),public.platform_controls_summary() from public,anon,service_role;
grant execute on function public.platform_restaurant_control(uuid),public.platform_set_restaurant_account(uuid,boolean,text,boolean,integer,uuid),
 public.platform_audit(integer,integer,timestamptz,timestamptz,text,uuid,uuid),public.platform_controls_summary() to authenticated;

-- Preserve RLS policy callers, restrict data returned, and pin search paths.
create or replace function public.is_restaurant_member(target_restaurant_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.restaurant_members where restaurant_id=target_restaurant_id and user_id=auth.uid());
$$;
create or replace function public.is_restaurant_manager(target_restaurant_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.restaurant_members where restaurant_id=target_restaurant_id and user_id=auth.uid() and role in ('owner','manager'));
$$;
create or replace function public.branch_restaurant_id(target_branch_id uuid) returns uuid language sql stable security definer set search_path='' as $$
 select restaurant_id from public.branches where id=target_branch_id and public.is_restaurant_member(restaurant_id);
$$;
create or replace function public.table_restaurant_id(target_table_id uuid) returns uuid language sql stable security definer set search_path='' as $$
 select b.restaurant_id from public.restaurant_tables t join public.branches b on b.id=t.branch_id where t.id=target_table_id and public.is_restaurant_member(b.restaurant_id);
$$;
create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.profiles(id,full_name,phone) values(new.id,new.raw_user_meta_data->>'full_name',new.phone) on conflict(id) do nothing;
 return new;
end $$;
revoke all on function public.handle_new_auth_user() from public,anon,authenticated,service_role;
-- This function is present in the hosted storage baseline; local core-only tests
-- also receive it without needing the unrelated storage schema.
create or replace function public.owns_storage_object_restaurant(object_name text) returns boolean language plpgsql stable security definer set search_path='' as $$
declare segment text:=split_part(object_name,'/',1);
begin
 if segment !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then return false; end if;
 return public.is_restaurant_manager(segment::uuid);
end $$;
revoke all on all functions in schema platform_private from public,anon,authenticated,service_role;

-- Directory reports platform account state separately from owner settings.
create or replace function public.platform_restaurants(p_days integer default 30,p_page integer default 1,p_size integer default 25,p_search text default '',p_filter text default 'all',p_sort text default 'newest') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare w record; result jsonb;
begin
 perform platform_private.require_reporting_admin();
 if p_page is null or p_page<1 or p_page>1000000 or p_size is null or p_size not in (25,50)
 or p_search is null or length(p_search)>100 or p_filter is null or p_filter not in ('all','recent','active','inactive','setup','ready')
 or p_sort is null or p_sort not in ('newest','oldest','activity','orders','name') then raise exception 'Invalid directory options'; end if;
 select * into w from platform_private.reporting_window(p_days);
 with f as materialized (select facts.*,case when coalesce(c.suspended,false) then 'Suspended' else 'Active' end as account_status from platform_private.restaurant_facts(w.start_at,w.end_at) facts left join platform_private.restaurant_controls c on c.restaurant_id=facts.id),
 filtered as materialized (select * from f where
 (p_search='' or position(lower(p_search) in lower(name))>0 or position(lower(p_search) in lower(slug))>0 or position(lower(p_search) in lower(coalesce(owner_email,'')))>0)
 and case p_filter when 'recent' then created_at>=w.start_at when 'active' then qualifying_orders>0
 when 'inactive' then qualifying_orders=0 when 'setup' then not ready when 'ready' then ready and qualifying_orders=0 else true end),
 page as (select * from filtered order by
 case when p_sort='newest' then created_at end desc,
 case when p_sort='oldest' then created_at end asc,
 case when p_sort='activity' then last_order end desc nulls last,
 case when p_sort='orders' then orders end desc,
 case when p_sort='name' then lower(name) end asc,id asc limit p_size offset (p_page-1)*p_size)
 select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce(jsonb_agg(to_jsonb(page) order by case when p_sort='newest' then created_at end desc,case when p_sort='oldest' then created_at end asc,case when p_sort='activity' then last_order end desc nulls last,case when p_sort='orders' then orders end desc,case when p_sort='name' then lower(name) end asc,id asc),'[]'::jsonb)) into result from page;
 return result||jsonb_build_object('page',p_page,'size',p_size,'start',w.start_at,'end',w.end_at,'inactivity_days',platform_private.inactivity_days());
end $$;


-- Existing operator mutations also gain explicit safe before/after state fields.
create or replace function platform_private.audit_admin_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare event text;
begin
 if TG_OP='UPDATE' and new is not distinct from old then return new; end if;
 event:=case when TG_OP='INSERT' then 'platform_admin.provisioned'
   when TG_OP='DELETE' or not new.is_active or new.revoked_at is not null then 'platform_admin.revoked'
   else 'platform_admin.authorization_changed' end;
 insert into public.platform_audit_logs(actor_user_id,action,target_type,target_id,result,metadata,previous_state,new_state,reason)
 values(auth.uid(),event,'platform_admin',case when TG_OP='DELETE' then old.user_id else new.user_id end,'success',
   jsonb_build_object('operator_role',session_user,'source','trusted_database_operator'),
   case when TG_OP='INSERT' then null else jsonb_build_object('active',old.is_active,'revoked_at',old.revoked_at) end,
   case when TG_OP='DELETE' then null else jsonb_build_object('active',new.is_active,'revoked_at',new.revoked_at) end,'trusted_operator_change');
 if TG_OP='DELETE' then return old; end if;
 return new;
end $$;
revoke all on function public.is_restaurant_member(uuid),public.is_restaurant_manager(uuid),public.branch_restaurant_id(uuid),public.table_restaurant_id(uuid),public.owns_storage_object_restaurant(text) from public;
grant execute on function public.is_restaurant_member(uuid),public.is_restaurant_manager(uuid),public.branch_restaurant_id(uuid),public.table_restaurant_id(uuid),public.owns_storage_object_restaurant(text) to anon,authenticated,service_role;
revoke all on all functions in schema platform_private from public,anon,authenticated,service_role;
