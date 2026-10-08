-- Additive staff authentication; no changes to customer/table/order architecture.
alter table staff add column auth_version integer not null default 1,
  add column manager_user_id uuid references auth.users(id);
create unique index staff_manager_account on staff(restaurant_id,manager_user_id) where manager_user_id is not null;

create table staff_login_limits (
  scope text primary key,
  attempts integer not null default 0,
  window_start timestamptz not null default now()
);
create table staff_sessions (
  token_hash text primary key,
  staff_id uuid not null references staff(id),
  auth_version integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '12 hours',
  last_active_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index staff_sessions_staff on staff_sessions(staff_id);
alter table staff_login_limits enable row level security;
alter table staff_sessions enable row level security;
revoke all on staff_login_limits,staff_sessions from public,anon,authenticated;
grant all on staff_login_limits,staff_sessions to service_role;

create function staff_revoke_changed() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  if (new.pin_hash,new.role,new.branch_id,new.is_active,new.manager_user_id) is distinct from
     (old.pin_hash,old.role,old.branch_id,old.is_active,old.manager_user_id) then
    new.auth_version:=old.auth_version+1;
  end if;
  return new;
end $$;
create trigger staff_revoke_changed before update on staff for each row execute function staff_revoke_changed();

-- Reserve attempts before expensive PIN verification. Row locks serialize workers/devices.
-- Invalid identities use only the restaurant bucket, keeping storage bounded.
create function staff_login_begin(p_slug text,p_staff uuid) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare r restaurants; s staff; bucket text; lim staff_login_limits; cap integer;
begin
  select * into r from restaurants where slug=p_slug and status='active';
  if r.id is null then return null; end if;
  select * into s from staff where id=p_staff and restaurant_id=r.id and is_active
    and role in ('staff','waiter','kitchen','cashier');
  foreach bucket in array case when s.id is null then array['restaurant:'||r.id]
    else array['restaurant:'||r.id,'staff:'||s.id] end loop
    cap:=case when bucket like 'restaurant:%' then 200 else 5 end;
    insert into staff_login_limits(scope) values(bucket) on conflict do nothing;
    select * into lim from staff_login_limits where scope=bucket for update;
    if lim.window_start<=now()-interval '15 minutes' then
      update staff_login_limits set attempts=0,window_start=now() where scope=bucket;
      lim.attempts:=0;
    end if;
    if lim.attempts>=cap then return jsonb_build_object('locked',true); end if;
    update staff_login_limits set attempts=attempts+1 where scope=bucket;
  end loop;
  if s.id is null then return null; end if;
  return jsonb_build_object('id',s.id,'pin_hash',s.pin_hash,'auth_version',s.auth_version);
end $$;

-- Called only by the server after scrypt verification. Recheck the exact credential
-- version so a reset/deactivation racing verification cannot create a usable session.
create function staff_login_finish(p_slug text,p_staff uuid,p_version integer,p_pin_hash text,p_token_hash text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare s staff;
begin
  select st.* into s from staff st join restaurants r on r.id=st.restaurant_id
    where st.id=p_staff and r.slug=p_slug and r.status='active' for update of st;
  if s.id is null or not s.is_active or s.role not in ('staff','waiter','kitchen','cashier')
    or s.auth_version<>p_version or s.pin_hash<>p_pin_hash then return false; end if;
  if p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid session token.'; end if;
  insert into staff_sessions(token_hash,staff_id,auth_version) values(p_token_hash,s.id,s.auth_version);
  return true;
end $$;

-- Reads never extend idle expiry: only deliberate user activity or a mutation does.
create function staff_session_check(p_token_hash text,p_touch boolean default false) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare ss staff_sessions; s staff; r restaurants;
begin
  select st.* into s from staff st join staff_sessions x on x.staff_id=st.id
    where x.token_hash=p_token_hash for share of st;
  if s.id is null or not s.is_active or s.role not in ('staff','waiter','kitchen','cashier') then return null; end if;
  select * into ss from staff_sessions where token_hash=p_token_hash for update;
  if ss.revoked_at is not null or ss.auth_version<>s.auth_version or ss.expires_at<=now()
    or ss.last_active_at<=now()-interval '30 minutes' then return null; end if;
  select * into r from restaurants where id=s.restaurant_id and status='active';
  if r.id is null then return null; end if;
  if s.branch_id is not null and not exists(select 1 from branches where id=s.branch_id and restaurant_id=s.restaurant_id and is_active) then return null; end if;
  if p_touch then update staff_sessions set last_active_at=now() where token_hash=p_token_hash; end if;
  return jsonb_build_object('staffId',s.id,'restaurantId',s.restaurant_id,'branchId',s.branch_id,
    'role','staff','name',s.name,'restaurantName',r.name,'restaurantSlug',r.slug);
end $$;

create or replace function dining_authorize(p_restaurant uuid,p_branch uuid,p_staff uuid,p_user uuid,p_payment boolean)
returns void language plpgsql security invoker set search_path=public as $$
begin
  if p_staff is not null then
    if exists(select 1 from staff where id=p_staff and restaurant_id=p_restaurant and is_active
      and (branch_id is null or branch_id=p_branch) and role in ('staff','waiter','kitchen','cashier')) then return; end if;
  elsif p_user is not null then
    if exists(select 1 from restaurant_members where user_id=p_user and restaurant_id=p_restaurant and role in ('owner','manager')) then return; end if;
  end if;
  raise exception 'You are not authorized for this table action.';
end $$;

-- Session validation and mutation share a transaction and staff lock; reset and
-- deactivation cannot slip between authorization and a committed sensitive action.
create function staff_table_action(p_token_hash text,p_table uuid,p_session uuid,p_action text,p_attempt uuid default null,p_method text default 'cash')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare actor jsonb; b uuid;
begin
  actor:=staff_session_check(p_token_hash,true);
  if actor is null then raise exception 'Staff session expired. Sign in again.'; end if;
  select t.branch_id into b from restaurant_tables t join branches br on br.id=t.branch_id
    where t.id=p_table and br.restaurant_id=(actor->>'restaurantId')::uuid
    and (actor->>'branchId' is null or t.branch_id=(actor->>'branchId')::uuid);
  if b is null then raise exception 'Table not found.'; end if;
  if p_action not in ('start_payment','confirm_payment','fail_payment','close','reset_empty','request_bill') then raise exception 'Unsupported staff action.'; end if;
  if p_action='start_payment' and exists(select 1 from table_sessions where id=p_session and table_id=p_table and status='open') then
    perform dining_transition((actor->>'restaurantId')::uuid,b,p_table,p_session,'request_bill',(actor->>'staffId')::uuid);
  end if;
  return dining_transition((actor->>'restaurantId')::uuid,b,p_table,p_session,p_action,(actor->>'staffId')::uuid,null,p_attempt,p_method);
end $$;

create function staff_order_action(p_token_hash text,p_order uuid,p_expected text,p_next text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare actor jsonb; o orders; t uuid;
begin
  actor:=staff_session_check(p_token_hash,true);
  if actor is null then raise exception 'Staff session expired. Sign in again.'; end if;
  if not ((p_expected in ('pending','accepted','preparing') and p_next='ready') or (p_expected='ready' and p_next='served')) then raise exception 'Invalid order transition.'; end if;
  select * into o from orders where id=p_order and restaurant_id=(actor->>'restaurantId')::uuid
    and (actor->>'branchId' is null or branch_id=(actor->>'branchId')::uuid);
  if o.id is null then raise exception 'Order not found.'; end if;
  -- Same table-before-order lock order used by payment/closure.
  if o.table_session_id is not null then
    select table_id into t from table_sessions where id=o.table_session_id;
    perform 1 from restaurant_tables where id=t for update;
    if not exists(select 1 from table_sessions where id=o.table_session_id and status<>'closed') then return false; end if;
  end if;
  update orders set status=p_next::order_status where id=o.id and status::text=p_expected;
  if not found then return false; end if;
  insert into order_status_history(order_id,status,changed_by_staff_id) values(o.id,p_next::order_status,(actor->>'staffId')::uuid);
  if o.table_session_id is not null then perform dining_refresh_table(o.table_session_id); end if;
  return true;
end $$;

create function staff_resolve_request(p_token_hash text,p_request uuid) returns void
language plpgsql security invoker set search_path=public as $$
declare actor jsonb;
begin
  actor:=staff_session_check(p_token_hash,true);
  if actor is null then raise exception 'Staff session expired. Sign in again.'; end if;
  update waiter_requests w set resolved_at=now(),resolved_by_staff_id=(actor->>'staffId')::uuid
    from branches b where w.id=p_request and w.branch_id=b.id and b.restaurant_id=(actor->>'restaurantId')::uuid
    and (actor->>'branchId' is null or b.id=(actor->>'branchId')::uuid) and w.resolved_at is null;
end $$;

-- Management is full Supabase Auth only. Manager account assignment is owner-only.
create function manage_staff(p_actor uuid,p_restaurant uuid,p_action text,p_staff uuid default null,
  p_name text default null,p_branch uuid default null,p_pin_hash text default null,p_access text default 'staff',p_email text default null)
returns void language plpgsql security invoker set search_path=public as $$
declare actor_role restaurant_role; s staff; account uuid;
begin
  select role into actor_role from restaurant_members where user_id=p_actor and restaurant_id=p_restaurant and role in ('owner','manager');
  if actor_role is null then raise exception 'Management access required.'; end if;
  if p_action not in ('add','edit','reset_pin','activate','deactivate','revoke') then raise exception 'Unsupported staff change.'; end if;
  if p_action<>'add' then
    select * into s from staff where id=p_staff and restaurant_id=p_restaurant for update;
    if s.id is null then raise exception 'Staff not found.'; end if;
    if s.role in ('owner','manager') and actor_role<>'owner' then raise exception 'Only the owner can manage manager accounts.'; end if;
    if s.role='owner' then raise exception 'Owner accounts cannot be edited here.'; end if;
  end if;
  if p_action in ('add','edit') then
    if p_name is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Enter a name up to 80 characters.'; end if;
    if p_access not in ('staff','manager') then raise exception 'Choose Staff or Manager.'; end if;
    if p_branch is not null and not exists(select 1 from branches where id=p_branch and restaurant_id=p_restaurant and is_active) then raise exception 'Branch not found.'; end if;
    if p_access='manager' then
      if actor_role<>'owner' then raise exception 'Only the owner can assign Manager access.'; end if;
      select id into account from auth.users where lower(email)=lower(trim(p_email)) and email_confirmed_at is not null;
      if account is null then raise exception 'Manager needs an existing verified email account. They must sign in with email and password.'; end if;
      if exists(select 1 from restaurant_members where user_id=account and restaurant_id=p_restaurant and role='owner') then raise exception 'Do not change the owner account.'; end if;
    end if;
    if s.manager_user_id is not null and s.manager_user_id is distinct from account then
      delete from restaurant_members where restaurant_id=p_restaurant and user_id=s.manager_user_id and role='manager';
    end if;
    if account is not null and (p_action='add' or s.is_active) then
      insert into restaurant_members(restaurant_id,user_id,role) values(p_restaurant,account,'manager')
        on conflict(restaurant_id,user_id) do update set role='manager';
    end if;
    if p_action='add' then
      if p_access='staff' and p_pin_hash is null then raise exception 'PIN required.'; end if;
      insert into staff(restaurant_id,branch_id,name,role,pin_hash,manager_user_id)
        values(p_restaurant,p_branch,trim(p_name),p_access::restaurant_role,coalesce(p_pin_hash,'disabled'),account);
    else
      if p_access='staff' and s.role='manager' and p_pin_hash is null then raise exception 'Set a new staff PIN when removing Manager access.'; end if;
      update staff set name=trim(p_name),branch_id=p_branch,
        role=case when p_access='staff' and s.role in ('waiter','kitchen','cashier') then s.role else p_access::restaurant_role end,
        manager_user_id=account,pin_hash=coalesce(p_pin_hash,pin_hash) where id=s.id;
    end if;
  elsif p_action='reset_pin' then
    if s.role='manager' or p_pin_hash is null then raise exception 'Managers use their full account. Staff PIN required.'; end if;
    update staff set pin_hash=p_pin_hash where id=s.id;
  elsif p_action in ('activate','deactivate') then
    update staff set is_active=(p_action='activate') where id=s.id;
    if s.manager_user_id is not null then
      if p_action='deactivate' then delete from restaurant_members where restaurant_id=p_restaurant and user_id=s.manager_user_id and role='manager';
      else insert into restaurant_members(restaurant_id,user_id,role) values(p_restaurant,s.manager_user_id,'manager') on conflict do nothing;
      end if;
    end if;
  else update staff set auth_version=auth_version+1 where id=s.id;
  end if;
end $$;

-- All privileged entry points are server-only, including helpers returning hashes.
do $$ declare f record; begin
  for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('staff_revoke_changed','staff_login_begin','staff_login_finish','staff_session_check','staff_table_action','staff_order_action','staff_resolve_request','manage_staff') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;

-- Retain the tested payment/closure operation, adding its existing actor fields.
-- Confirmed external payment ends the visit atomically. Pending/failed paths are unchanged.
create or replace function dining_transition(p_restaurant uuid,p_branch uuid,p_table uuid,p_session uuid,
  p_action text,p_staff uuid default null,p_user uuid default null,p_attempt uuid default null,p_method text default 'cash')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare s table_sessions; b bills; pay payments;
begin
  perform dining_authorize(p_restaurant,p_branch,p_staff,p_user,p_action in ('start_payment','confirm_payment','fail_payment','close'));
  -- Staff must also be able to recover an existing visit on a disabled table.
  perform 1 from restaurant_tables t join branches br on br.id=t.branch_id
    where t.id=p_table and br.id=p_branch and br.restaurant_id=p_restaurant for update of t;
  if not found then raise exception 'Table not found.'; end if;
  select * into s from table_sessions where id=p_session and table_id=p_table;
  if s.id is null then raise exception 'Table visit not found.'; end if;
  select * into b from bills where table_session_id=s.id;
  if p_action='request_bill' then return dining_request_bill(p_restaurant,p_branch,p_table,p_session);
  elsif p_action='start_payment' then
    if p_attempt is null or p_method not in ('cash','upi','card') then raise exception 'Choose a counter payment method.'; end if;
    select * into pay from payments where restaurant_id=p_restaurant and attempt_key=p_attempt;
    if pay.id is not null then
      if pay.bill_id is distinct from b.id or pay.method::text<>p_method then raise exception 'Payment reference already used.'; end if;
      return jsonb_build_object('paymentId',pay.id,'status',pay.status);
    end if;
    if s.status<>'bill_requested' then raise exception 'Request the bill before starting payment.'; end if;
    b:=dining_bill(p_restaurant,p_branch,s.id);
    insert into payments(restaurant_id,bill_id,method,status,amount,attempt_key,recorded_by_staff_id,recorded_by)
      values(p_restaurant,b.id,p_method::payment_method,'pending',b.total_amount,p_attempt,p_staff,p_user) returning * into pay;
    update table_sessions set status='payment_pending',payment_started_at=coalesce(payment_started_at,now()) where id=s.id;
    update restaurant_tables set status='payment_pending' where id=p_table;
  elsif p_action in ('confirm_payment','fail_payment') then
    select * into pay from payments where restaurant_id=p_restaurant and bill_id=b.id and attempt_key=p_attempt;
    if pay.id is null then raise exception 'Payment attempt not found.'; end if;
    if pay.status='paid' and p_action='confirm_payment' then return jsonb_build_object('paymentId',pay.id,'status',pay.status); end if;
    if pay.status='failed' and p_action='fail_payment' then return jsonb_build_object('paymentId',pay.id,'status',pay.status); end if;
    if pay.status<>'pending' or s.status<>'payment_pending' then raise exception 'This payment attempt is no longer pending.'; end if;
    if p_action='fail_payment' then
      update payments set status='failed',failed_at=now(),failure_reason='Not received; recorded by staff' where id=pay.id;
      update table_sessions set status='bill_requested' where id=s.id;
      update restaurant_tables set status='bill_requested' where id=p_table;
    else
      if pay.amount<>b.total_amount or pay.amount<>(select coalesce(sum(total_amount),0) from orders where table_session_id=s.id and status<>'cancelled') then raise exception 'Bill total changed. Cancel payment and retry.'; end if;
      update payments set status='paid',confirmed_at=now(),recorded_by_staff_id=p_staff,recorded_by=p_user where id=pay.id;
      update bills set status='paid',closed_at=now() where id=b.id;
      update table_sessions set status='paid',paid_at=now() where id=s.id;
      update restaurant_tables set status='paid' where id=p_table;
      -- Reuse the existing closure operation in this transaction: all changes
      -- roll back together if closure fails. Paid retries above remain no-ops.
      perform dining_transition(p_restaurant,p_branch,p_table,p_session,'close',p_staff,p_user);
    end if;
  elsif p_action in ('close','reset_empty') then
    if s.status='closed' then return jsonb_build_object('status','closed'); end if;
    if p_action='reset_empty' then
      if s.status<>'open' or exists(select 1 from orders where table_session_id=s.id)
        or b.id is not null then raise exception 'Only an empty, unpaid visit can be reset. Settle submitted orders first.'; end if;
    elsif s.status<>'paid' then raise exception 'Confirm payment before closing this table.';
    end if;
    insert into order_status_history(order_id,status,changed_by_staff_id,changed_by)
      select id,'completed',p_staff,p_user from orders where table_session_id=s.id and status not in ('completed','cancelled');
    update orders set status='completed' where table_session_id=s.id and status not in ('completed','cancelled');
    update table_sessions set status='closed',closed_at=now(),closed_by_staff_id=p_staff,closed_by=p_user,closed_reason=case when p_action='reset_empty' then 'abandoned_empty' else 'settled' end where id=s.id;
    update restaurant_tables set status='available' where id=p_table;
  else raise exception 'Unsupported table action.';
  end if;
  return jsonb_build_object('status',(select status from table_sessions where id=s.id),'paymentId',pay.id);
end $$;

