-- Additive extension of existing tables. Abort on pre-existing duplicates;
-- never merge/delete a restaurant's historical activity automatically.
alter table restaurant_tables add column is_active boolean not null default true;
alter table table_sessions add column bill_requested_at timestamptz,
  add column payment_started_at timestamptz, add column paid_at timestamptz,
  add column closed_reason text;
create unique index one_active_dining_session on table_sessions(table_id) where status <> 'closed';
create unique index one_bill_per_dining_session on bills(table_session_id);

-- Device identity only; unsubmitted cart contents stay in that browser.
create table customer_sessions (
  id uuid primary key default gen_random_uuid(),
  table_session_id uuid not null references table_sessions(id),
  device_key uuid not null,
  created_at timestamptz not null default now(),
  unique(table_session_id, device_key)
);
alter table customer_sessions enable row level security;
revoke all on customer_sessions from public, anon, authenticated;
grant select, insert, update on customer_sessions to service_role;
alter table orders add column customer_session_id uuid references customer_sessions(id),
  add column submission_key uuid, add column submission_payload jsonb;
create unique index orders_submission_once on orders(restaurant_id, submission_key) where submission_key is not null;
alter table payments add column attempt_key uuid,
  add column confirmed_at timestamptz, add column failed_at timestamptz,
  add column failure_reason text;
create unique index payment_attempt_once on payments(restaurant_id, attempt_key) where attempt_key is not null;
create unique index one_pending_payment on payments(bill_id) where status='pending' and bill_id is not null;
create unique index one_settlement_per_bill on payments(bill_id) where status='paid' and bill_id is not null;

-- Direct client writes to financial/session history are not a transition API.
-- Existing owner reads and staff server operations remain available.
revoke insert, update, delete on table_sessions, orders, order_items, order_status_history, bills, payments from anon, authenticated;
revoke update on restaurant_tables from anon, authenticated;
grant update(label, is_active) on restaurant_tables to authenticated;
-- Anonymous diners resolve an enabled QR table. Authenticated restaurant
-- accounts use the existing member policy and cannot read other tenants' tables.
drop policy restaurant_tables_public_read on restaurant_tables;
create policy restaurant_tables_public_read on restaurant_tables for select to anon
  using(is_active and exists(select 1 from branches b join restaurants r on r.id=b.restaurant_id
    where b.id=branch_id and b.is_active and r.status='active'));

create function dining_lock_table(p_restaurant uuid, p_branch uuid, p_table uuid)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from restaurant_tables t join branches b on b.id=t.branch_id
    join restaurants r on r.id=b.restaurant_id
    where t.id=p_table and b.id=p_branch and r.id=p_restaurant
      and t.is_active and b.is_active and r.status='active' for update of t;
  if not found then raise exception 'Table is unavailable or does not belong to this restaurant.'; end if;
end $$;

create function dining_join(p_restaurant uuid, p_branch uuid, p_table uuid, p_device uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare s table_sessions; d uuid;
begin
  if p_device is null then raise exception 'A browser identity is required.'; end if;
  perform dining_lock_table(p_restaurant,p_branch,p_table);
  select * into s from table_sessions where table_id=p_table and status<>'closed';
  if s.id is null then
    insert into table_sessions(table_id) values(p_table) returning * into s;
    update restaurant_tables set status='occupied' where id=p_table;
  end if;
  insert into customer_sessions(table_session_id,device_key) values(s.id,p_device)
    on conflict(table_session_id,device_key) do update set device_key=excluded.device_key returning id into d;
  return jsonb_build_object('sessionId',s.id,'customerSessionId',d,'status',s.status);
end $$;

-- Internal helper; callers already hold the table lock.
create function dining_bill(p_restaurant uuid, p_branch uuid, p_session uuid)
returns bills language plpgsql security invoker set search_path = public as $$
declare b bills; amount numeric;
begin
  select coalesce(sum(total_amount),0) into amount from orders
    where table_session_id=p_session and restaurant_id=p_restaurant and branch_id=p_branch and status<>'cancelled';
  insert into bills(restaurant_id,branch_id,table_session_id,status,total_amount)
    values(p_restaurant,p_branch,p_session,'requested',amount)
    on conflict(table_session_id) do update set total_amount=excluded.total_amount,status='requested'
      where bills.status<>'paid' returning * into b;
  if b.id is null then raise exception 'This bill is already paid.'; end if;
  return b;
end $$;

create function dining_request_bill(p_restaurant uuid,p_branch uuid,p_table uuid,p_session uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare s table_sessions; b bills;
begin
  perform dining_lock_table(p_restaurant,p_branch,p_table);
  select * into s from table_sessions where id=p_session and table_id=p_table;
  if s.id is null or s.status not in ('open','bill_requested') then raise exception 'This table is not accepting bill requests.'; end if;
  b := dining_bill(p_restaurant,p_branch,s.id);
  if s.status='open' then
    insert into waiter_requests(branch_id,table_id,type) values(p_branch,p_table,'bill');
  end if;
  update table_sessions set status='bill_requested',bill_requested_at=coalesce(bill_requested_at,now()) where id=s.id;
  update restaurant_tables set status='bill_requested' where id=p_table;
  return jsonb_build_object('billId',b.id,'total',b.total_amount);
end $$;

-- A single transaction validates prices and saves the order, items, history,
-- coupon usage, customer, and updated requested bill. Retry returns the same order.
create function dining_submit(p_restaurant uuid,p_branch uuid,p_table uuid,p_session uuid,
  p_customer_session uuid,p_submission uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare r restaurants; s table_sessions; o orders; m menu_items; v menu_variants;
  a menu_addons; c coupons; offer offers; line jsonb; aid text; resolved jsonb='[]';
  addons jsonb; price numeric; sub numeric=0; discount numeric=0; tax numeric; service numeric;
  qty integer; cid uuid; coupon uuid; variant uuid; variant_name text; addtotal numeric;
begin
  if p_submission is null then raise exception 'Submission reference is required.'; end if;
  -- Also serializes retries for general (non-table) orders.
  perform pg_advisory_xact_lock(hashtextextended(p_restaurant::text||p_submission::text,0));
  select * into o from orders where restaurant_id=p_restaurant and submission_key=p_submission;
  if o.id is not null then
    if o.branch_id<>p_branch or o.table_session_id is distinct from p_session
      or o.customer_session_id is distinct from p_customer_session or o.submission_payload<>p_payload then
      raise exception 'This submission reference was already used for a different order.';
    end if;
    return jsonb_build_object('orderId',o.id,'orderNumber',o.order_number);
  end if;
  select * into r from restaurants where id=p_restaurant and status='active';
  if r.id is null or not exists(select 1 from branches where id=p_branch and restaurant_id=r.id and is_active) then
    raise exception 'Restaurant or branch is unavailable.';
  end if;
  if p_table is not null then
    perform dining_lock_table(p_restaurant,p_branch,p_table);
    select * into s from table_sessions where id=p_session and table_id=p_table;
    if s.id is null or s.status not in ('open','bill_requested') then raise exception 'Ordering has ended or payment is in progress.'; end if;
    if not exists(select 1 from customer_sessions where id=p_customer_session and table_session_id=s.id) then
      raise exception 'This browser does not belong to this table visit.';
    end if;
  elsif p_session is not null or p_customer_session is not null then raise exception 'A table is required.';
  end if;
  if jsonb_typeof(p_payload->'lines') is distinct from 'array' or jsonb_array_length(p_payload->'lines') not between 1 and 100 then
    raise exception 'Your cart is empty or too large.';
  end if;
  for line in select value from jsonb_array_elements(p_payload->'lines') loop
    qty := (line->>'quantity')::integer;
    if qty is null or qty not between 1 and 50 or (line->>'quantity')::numeric<>qty then raise exception 'Invalid quantity.'; end if;
    select * into m from menu_items where id=(line->>'itemId')::uuid and restaurant_id=r.id and is_available for share;
    if m.id is null then raise exception 'An item is no longer available.'; end if;
    price:=m.base_price; variant:=nullif(line->>'variantId','')::uuid; variant_name:=null;
    if variant is not null then
      select * into v from menu_variants where id=variant and item_id=m.id for share;
      if v.id is null then raise exception 'Invalid variant.'; end if;
      price:=v.price; variant_name:=v.name;
    end if;
    addons:='[]'; addtotal:=0;
    for aid in select distinct value from jsonb_array_elements_text(coalesce(line->'addonIds','[]')) loop
      select * into a from menu_addons where id=aid::uuid and item_id=m.id for share;
      if a.id is null then raise exception 'Invalid add-on.'; end if;
      addons:=addons||jsonb_build_object('id',a.id,'name',a.name,'price',a.price); addtotal:=addtotal+a.price;
    end loop;
    sub:=sub+(price+addtotal)*qty;
    resolved:=resolved||jsonb_build_object('item_id',m.id,'variant_id',variant,'item_name',m.name,
      'variant_name',variant_name,'unit_price',price,'quantity',qty,'addon_selection',addons,
      'special_instructions',left(line->>'specialInstructions',300));
  end loop;
  if nullif(trim(p_payload->>'couponCode'),'') is not null then
    select * into c from coupons where restaurant_id=r.id and code=upper(trim(p_payload->>'couponCode')) for update;
    if c.id is null or not c.is_active or (c.usage_limit is not null and c.times_used>=c.usage_limit) then raise exception 'Coupon is invalid or exhausted.'; end if;
    select * into offer from offers where id=c.offer_id and restaurant_id=r.id and is_active for share;
    if offer.id is null or sub<coalesce(offer.min_order_value,0) then raise exception 'Coupon requirements are not met.'; end if;
    discount:=case when offer.type='percentage' then sub*coalesce(offer.percentage_value,0)/100
      when offer.type='flat' then coalesce(offer.flat_value,0) else 0 end;
    discount:=least(sub,discount,coalesce(offer.max_discount_value,discount)); coupon:=c.id;
    update coupons set times_used=times_used+1 where id=c.id;
  end if;
  tax:=round((sub-discount)*r.tax_percent/100,2); service:=round((sub-discount)*r.service_charge_percent/100,2);
  if nullif(trim(p_payload->>'customerPhone'),'') is not null then
    insert into customers(restaurant_id,phone,name) values(r.id,left(p_payload->>'customerPhone',100),nullif(left(p_payload->>'customerName',200),''))
      on conflict(restaurant_id,phone) do update set name=excluded.name returning id into cid;
  end if;
  insert into orders(restaurant_id,branch_id,table_session_id,customer_session_id,submission_key,submission_payload,
    customer_id,coupon_id,subtotal,discount_amount,tax_amount,service_charge_amount,total_amount)
    values(r.id,p_branch,p_session,p_customer_session,p_submission,p_payload,cid,coupon,round(sub,2),round(discount,2),tax,service,round(sub-discount+tax+service,2)) returning * into o;
  insert into order_items(order_id,item_id,variant_id,item_name,variant_name,unit_price,quantity,addon_selection,special_instructions)
    select o.id,x.item_id,x.variant_id,x.item_name,x.variant_name,x.unit_price,x.quantity,x.addon_selection,x.special_instructions
    from jsonb_to_recordset(resolved) as x(item_id uuid,variant_id uuid,item_name text,variant_name text,unit_price numeric,quantity integer,addon_selection jsonb,special_instructions text);
  insert into order_status_history(order_id,status) values(o.id,'pending');
  if p_table is not null then
    if s.status='bill_requested' then perform dining_bill(r.id,p_branch,s.id);
    else update restaurant_tables set status='order_pending' where id=p_table; end if;
  end if;
  return jsonb_build_object('orderId',o.id,'orderNumber',o.order_number);
end $$;

create function dining_authorize(p_restaurant uuid,p_branch uuid,p_staff uuid,p_user uuid,p_payment boolean)
returns void language plpgsql security invoker set search_path = public as $$
begin
  if p_staff is not null then
    if exists(select 1 from staff where id=p_staff and restaurant_id=p_restaurant and is_active
      and (branch_id is null or branch_id=p_branch) and (not p_payment or role='cashier')) then return; end if;
  elsif p_user is not null then
    if exists(select 1 from restaurant_members where user_id=p_user and restaurant_id=p_restaurant and role in ('owner','manager')) then return; end if;
  end if;
  raise exception 'You are not authorized for this table action.';
end $$;

create function dining_transition(p_restaurant uuid,p_branch uuid,p_table uuid,p_session uuid,
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
    update table_sessions set status='closed',closed_at=now(),closed_reason=case when p_action='reset_empty' then 'abandoned_empty' else 'settled' end where id=s.id;
    update restaurant_tables set status='available' where id=p_table;
  else raise exception 'Unsupported table action.';
  end if;
  return jsonb_build_object('status',(select status from table_sessions where id=s.id),'paymentId',pay.id);
end $$;

-- Enforce lifecycle and tenant consistency even on direct service/database writes.
create function dining_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare rid uuid; bid uuid; st table_session_status;
begin
  if tg_table_name='restaurant_tables' then
    if new.branch_id<>old.branch_id and exists(select 1 from table_sessions where table_id=old.id) then raise exception 'A table with dining history cannot move between branches.'; end if;
    if new.status in ('available','cleaning') and exists(select 1 from table_sessions where table_id=new.id and status<>'closed') then raise exception 'Close the active visit before making the table available.'; end if;
    if new.status<>old.status and new.status not in ('available','cleaning') then
      select status into st from table_sessions where table_id=new.id and status<>'closed';
      if st is null or (new.status in ('occupied','order_pending','preparing','ready') and st<>'open') or
        (new.status in ('bill_requested','payment_pending','paid') and new.status::text<>st::text) then raise exception 'Table status must match its active visit.'; end if;
    end if;
  elsif tg_table_name='table_sessions' then
    if tg_op='INSERT' then
      perform 1 from restaurant_tables where id=new.table_id and is_active for update;
      if not found or new.status<>'open' then raise exception 'A new visit must open on an enabled table.'; end if;
    end if;
    if tg_op='UPDATE' and (new.id<>old.id or new.table_id<>old.table_id) then raise exception 'A visit cannot be moved to another table.'; end if;
    if tg_op='UPDATE' and new.status<>old.status then
      if not ((old.status='open' and new.status in ('bill_requested','closed')) or
        (old.status='bill_requested' and new.status='payment_pending') or
        (old.status='payment_pending' and new.status in ('paid','bill_requested')) or
        (old.status='paid' and new.status='closed')) then raise exception 'Invalid dining lifecycle transition.'; end if;
      if new.status='closed' and old.status<>'paid' and (exists(select 1 from orders where table_session_id=new.id) or exists(select 1 from bills where table_session_id=new.id)) then raise exception 'Cannot close an unsettled visit.'; end if;
      if new.status='payment_pending' and not exists(select 1 from bills b join payments p on p.bill_id=b.id where b.table_session_id=new.id and b.status='requested' and p.status='pending' and p.amount=b.total_amount) then raise exception 'A pending payment attempt is required.'; end if;
      if new.status='bill_requested' and not exists(select 1 from bills b where b.table_session_id=new.id and b.status='requested') then raise exception 'A requested bill is required.'; end if;
      if new.status='bill_requested' and exists(select 1 from bills b join payments p on p.bill_id=b.id where b.table_session_id=new.id and p.status='pending') then raise exception 'Resolve the pending payment first.'; end if;
      if new.status='paid' and not exists(select 1 from bills b join payments p on p.bill_id=b.id where b.table_session_id=new.id and b.status='paid' and p.status='paid' and p.amount=b.total_amount) then raise exception 'Confirmed payment is required.'; end if;
    end if;
    return new;
  elsif tg_table_name='orders' then
    if tg_op='UPDATE' and (new.table_session_id is distinct from old.table_session_id or new.restaurant_id<>old.restaurant_id or new.branch_id<>old.branch_id or new.customer_session_id is distinct from old.customer_session_id) then raise exception 'An order cannot move between visits.'; end if;
    if new.customer_session_id is not null and not exists(select 1 from customer_sessions where id=new.customer_session_id and table_session_id=new.table_session_id) then raise exception 'Order browser mismatch.'; end if;
    if not exists(select 1 from branches where id=new.branch_id and restaurant_id=new.restaurant_id) then raise exception 'Order tenant mismatch.'; end if;
    if new.table_session_id is not null then
      select s.status,t.branch_id into st,bid from table_sessions s join restaurant_tables t on t.id=s.table_id where s.id=new.table_session_id;
      if bid is distinct from new.branch_id then raise exception 'Order table mismatch.'; end if;
      if tg_op='INSERT' and st not in ('open','bill_requested') then raise exception 'Ordering is closed.'; end if;
    end if;
  elsif tg_table_name='bills' then
    select br.restaurant_id,t.branch_id into rid,bid from table_sessions s join restaurant_tables t on t.id=s.table_id join branches br on br.id=t.branch_id where s.id=new.table_session_id;
    if rid is distinct from new.restaurant_id or bid is distinct from new.branch_id then raise exception 'Bill tenant mismatch.'; end if;
    if new.status='paid' and not exists(select 1 from payments where bill_id=new.id and status='paid' and amount=new.total_amount) then raise exception 'Confirm payment before marking the bill paid.'; end if;
  elsif tg_table_name='payments' then
    if new.bill_id is not null and not exists(select 1 from bills where id=new.bill_id and restaurant_id=new.restaurant_id) then raise exception 'Payment tenant mismatch.'; end if;
    if new.order_id is not null and not exists(select 1 from orders where id=new.order_id and restaurant_id=new.restaurant_id) then raise exception 'Payment order tenant mismatch.'; end if;
    if tg_op='INSERT' and new.bill_id is not null and (new.status<>'pending' or new.attempt_key is null) then raise exception 'Begin with an identified pending payment attempt.'; end if;
    if tg_op='UPDATE' and new.status='paid' and old.status='pending' and
      (new.confirmed_at is null or (new.recorded_by is null and new.recorded_by_staff_id is null)) then raise exception 'A recorded payment confirmation is required.'; end if;
    if tg_op='UPDATE' and old.status<>'pending' and new is distinct from old then raise exception 'Final payment records are immutable.'; end if;
  elsif tg_table_name='order_items' then
    if not exists(select 1 from orders o join menu_items m on m.restaurant_id=o.restaurant_id where o.id=new.order_id and m.id=new.item_id) then raise exception 'Order item tenant mismatch.'; end if;
  end if;
  return new;
end $$;
create trigger dining_table_guard before update on restaurant_tables for each row execute function dining_guard();
create trigger dining_session_guard before insert or update on table_sessions for each row execute function dining_guard();
create trigger dining_order_guard before insert or update on orders for each row execute function dining_guard();
create trigger dining_bill_guard before insert or update on bills for each row execute function dining_guard();
create trigger dining_payment_guard before insert or update on payments for each row execute function dining_guard();
create trigger dining_item_guard before insert or update on order_items for each row execute function dining_guard();

-- Status actions commit before this call, so table and order lock order cannot deadlock.
create function dining_refresh_table(p_session uuid) returns void language plpgsql security invoker set search_path=public as $$
declare tid uuid;
begin
  select table_id into tid from table_sessions where id=p_session;
  perform 1 from restaurant_tables where id=tid for update;
  if exists(select 1 from table_sessions where id=p_session and status='open') then
    update restaurant_tables set status=case when exists(select 1 from orders where table_session_id=p_session and status in ('pending','accepted','preparing','ready')) then 'order_pending'::table_status else 'occupied'::table_status end where id=tid;
  end if;
end $$;

-- RPCs are private server operations, not anonymous endpoints. No security definer.
do $$ declare f regprocedure; begin
  for f in select oid::regprocedure from pg_proc where pronamespace='public'::regnamespace and proname like 'dining_%' loop
    execute format('revoke all on function %s from public, anon, authenticated',f);
    execute format('grant execute on function %s to service_role',f);
  end loop;
end $$;
