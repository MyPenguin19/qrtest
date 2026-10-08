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
    update table_sessions set status='closed',closed_at=now(),closed_reason=case when p_action='reset_empty' then 'abandoned_empty' else 'settled' end where id=s.id;
    update restaurant_tables set status='available' where id=p_table;
  else raise exception 'Unsupported table action.';
  end if;
  return jsonb_build_object('status',(select status from table_sessions where id=s.id),'paymentId',pay.id);
end $$;

