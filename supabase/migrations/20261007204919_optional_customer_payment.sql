-- 3.1: payment intent is optional; manual closure is not provider verification.
alter table table_sessions
  add column payment_intent text check (payment_intent in ('counter')),
  add column payment_intent_at timestamptz,
  add column closed_by_staff_id uuid references staff(id),
  add column closed_by uuid references auth.users(id);
-- New confirmations use the existing manual flow. Do not relabel historical payments.
alter table payments add column confirmation_source text
  check (confirmation_source in ('staff_reported'));
alter table payments alter column confirmation_source set default 'staff_reported';

create function dining_counter_intent(p_restaurant uuid,p_branch uuid,p_table uuid,p_session uuid,p_customer_session uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s table_sessions; amount numeric;
begin
  perform dining_lock_table(p_restaurant,p_branch,p_table);
  select * into s from table_sessions where id=p_session and table_id=p_table;
  if s.id is null or s.status not in ('open','bill_requested') then raise exception 'Your table session has ended or payment is already in progress.'; end if;
  if not exists(select 1 from customer_sessions where id=p_customer_session and table_session_id=s.id) then raise exception 'This browser does not belong to this visit.'; end if;
  update table_sessions set payment_intent='counter',payment_intent_at=coalesce(payment_intent_at,now()) where id=s.id;
  select coalesce(sum(total_amount),0) into amount from orders where table_session_id=s.id and status<>'cancelled';
  return jsonb_build_object('total',amount,'intent','counter');
end $$;

create function dining_manual_close(p_restaurant uuid,p_branch uuid,p_table uuid,p_session uuid,
  p_staff uuid default null,p_user uuid default null,p_reason text default 'external_manual')
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s table_sessions; b bills;
begin
  perform dining_authorize(p_restaurant,p_branch,p_staff,p_user,true);
  if p_reason not in ('external_manual','manual_unsettled') or p_reason is null then raise exception 'Choose a manual closure reason.'; end if;
  perform 1 from restaurant_tables t join branches br on br.id=t.branch_id
    where t.id=p_table and br.id=p_branch and br.restaurant_id=p_restaurant for update of t;
  if not found then raise exception 'Table not found.'; end if;
  select * into s from table_sessions where id=p_session and table_id=p_table;
  if s.id is null then raise exception 'Table visit not found.'; end if;
  if s.status='closed' then return jsonb_build_object('status','closed'); end if;
  if s.status not in ('open','bill_requested') then raise exception 'Resolve the pending payment or close the paid table using its payment controls.'; end if;
  if exists(select 1 from bills bill_row join payments p on p.bill_id=bill_row.id where bill_row.table_session_id=s.id and p.status='pending') then raise exception 'Resolve the pending payment before manual closure.'; end if;
  b:=dining_bill(p_restaurant,p_branch,s.id);
  -- This snapshots the final bill without claiming QR.CR verified a payment.
  update bills set closed_at=now() where id=b.id;
  insert into order_status_history(order_id,status,changed_by_staff_id,changed_by)
    select id,'completed',p_staff,p_user from orders where table_session_id=s.id and status not in ('completed','cancelled');
  update orders set status='completed' where table_session_id=s.id and status not in ('completed','cancelled');
  update table_sessions set status='closed',closed_at=now(),closed_reason=p_reason,
    closed_by_staff_id=p_staff,closed_by=p_user where id=s.id;
  update restaurant_tables set status='available' where id=p_table;
  return jsonb_build_object('status','closed');
end $$;

create or replace function dining_guard() returns trigger language plpgsql security invoker set search_path=public as $$
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
    if tg_op='UPDATE' and old.status='closed' and new is distinct from old then raise exception 'Closed visits are immutable.'; end if;
    if tg_op='UPDATE' and new.status='closed' and old.status<>'closed' and new.closed_reason in ('external_manual','manual_unsettled') then
      select br.restaurant_id,t.branch_id into rid,bid from restaurant_tables t join branches br on br.id=t.branch_id where t.id=new.table_id;
      perform dining_authorize(rid,bid,new.closed_by_staff_id,new.closed_by,true);
      if exists(select 1 from bills b join payments p on p.bill_id=b.id where b.table_session_id=new.id and p.status='pending') then raise exception 'Resolve the pending payment before manual closure.'; end if;
    end if;
    if tg_op='UPDATE' and new.status<>old.status then
      if not ((old.status='open' and new.status in ('bill_requested','closed')) or
        (old.status='bill_requested' and new.status in ('payment_pending','closed')) or
        (old.status='payment_pending' and new.status in ('paid','bill_requested')) or
        (old.status='paid' and new.status='closed')) then raise exception 'Invalid dining lifecycle transition.'; end if;
      if new.status='closed' and old.status<>'paid' and (exists(select 1 from orders where table_session_id=new.id) or exists(select 1 from bills where table_session_id=new.id)) and not coalesce(new.closed_reason in ('external_manual','manual_unsettled') and new.closed_at is not null and (new.closed_by_staff_id is not null or new.closed_by is not null),false) then raise exception 'Cannot close an unsettled visit.'; end if;
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
      if tg_op='INSERT' then perform 1 from restaurant_tables where id=(select table_id from table_sessions where id=new.table_session_id) for update; end if;
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

revoke all on function dining_counter_intent(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function dining_counter_intent(uuid,uuid,uuid,uuid,uuid) to service_role;
revoke all on function dining_manual_close(uuid,uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function dining_manual_close(uuid,uuid,uuid,uuid,uuid,uuid,text) to service_role;

-- Legacy signed pages may resume only their original visit, never the next party.
drop function dining_join(uuid,uuid,uuid,uuid);
create function dining_join(p_restaurant uuid, p_branch uuid, p_table uuid, p_device uuid,p_expected_session uuid default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare s table_sessions; d uuid;
begin
  if p_device is null then raise exception 'A browser identity is required.'; end if;
  perform dining_lock_table(p_restaurant,p_branch,p_table);
  select * into s from table_sessions where table_id=p_table and status<>'closed';
  if p_expected_session is not null and s.id is distinct from p_expected_session then raise exception 'Your table session has ended.'; end if;
  if s.id is null then
    insert into table_sessions(table_id) values(p_table) returning * into s;
    update restaurant_tables set status='occupied' where id=p_table;
  end if;
  insert into customer_sessions(table_session_id,device_key) values(s.id,p_device)
    on conflict(table_session_id,device_key) do update set device_key=excluded.device_key returning id into d;
  return jsonb_build_object('sessionId',s.id,'customerSessionId',d,'status',s.status);
end $$;

revoke all on function dining_join(uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function dining_join(uuid,uuid,uuid,uuid,uuid) to service_role;
