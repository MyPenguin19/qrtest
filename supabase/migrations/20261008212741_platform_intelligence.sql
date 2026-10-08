-- Read-only platform reporting. No restaurant policies or business data changes.
create index if not exists orders_created_at_idx on public.orders(created_at);
create index if not exists orders_restaurant_created_at_idx on public.orders(restaurant_id,created_at);
create index if not exists restaurants_created_at_id_idx on public.restaurants(created_at,id);

create function platform_private.reporting_window(p_days integer)
returns table(start_at timestamptz,end_at timestamptz) language plpgsql stable set search_path='' as $$
begin
  if p_days is null or p_days not in (1,7,30,90) then raise exception 'Invalid reporting period'; end if;
  return query select (date_trunc('day',now() at time zone 'UTC')-make_interval(days=>p_days-1)) at time zone 'UTC',now();
end $$;
create function platform_private.inactivity_days() returns integer language sql immutable set search_path='' as $$ select 14 $$;
create function platform_private.require_reporting_admin() returns void language plpgsql set search_path='' as $$
begin
  if public.platform_admin_status() is distinct from 'allowed' then
    raise exception 'Platform access denied' using errcode='42501';
  end if;
end $$;

create function platform_private.restaurant_facts(p_start timestamptz,p_end timestamptz,p_id uuid default null)
returns table(id uuid,name text,slug text,owner_email text,created_at timestamptz,status text,
 branches bigint,active_branches bigint,tables bigint,dine_in_tables bigint,categories bigint,menu_items bigint,available_items bigint,staff_accounts bigint,
 orders bigint,cancelled_orders bigint,qualifying_orders bigint,previous_orders bigint,first_order timestamptz,last_order timestamptz,
 order_value numeric,ready boolean,readiness text)
language sql stable set search_path='' as $$
with b as (select restaurant_id,count(*) n,count(*) filter(where is_active) active from public.branches where p_id is null or restaurant_id=p_id group by restaurant_id),
t as (select br.restaurant_id,count(*) n,count(*) filter(where tb.is_active and br.is_active) usable from public.restaurant_tables tb join public.branches br on br.id=tb.branch_id where p_id is null or br.restaurant_id=p_id group by br.restaurant_id),
c as (select restaurant_id,count(*) n from public.menu_categories where p_id is null or restaurant_id=p_id group by restaurant_id),
m as (select mi.restaurant_id,count(*) n,count(*) filter(where mi.is_available and mc.restaurant_id=mi.restaurant_id) available from public.menu_items mi join public.menu_categories mc on mc.id=mi.category_id where p_id is null or mi.restaurant_id=p_id group by mi.restaurant_id),
s as (select restaurant_id,count(*) n from public.staff where role in ('staff','waiter','kitchen','cashier') and (p_id is null or restaurant_id=p_id) group by restaurant_id),
o as (select restaurant_id,
 count(*) filter(where created_at>=p_start and created_at<p_end) n,
 count(*) filter(where created_at>=p_start and created_at<p_end and status='cancelled') cancelled,
 count(*) filter(where created_at>=p_start and created_at<p_end and status<>'cancelled') qualifying,
 count(*) filter(where created_at<p_start and created_at>=p_start-make_interval(days=>((p_end at time zone 'UTC')::date-(p_start at time zone 'UTC')::date+1)) and status<>'cancelled') previous,
 min(created_at) filter(where status<>'cancelled') first_at,max(created_at) filter(where status<>'cancelled') last_at,
 coalesce(sum(total_amount) filter(where created_at>=p_start and created_at<p_end and status<>'cancelled'),0) value
 from public.orders where created_at<p_end and (p_id is null or restaurant_id=p_id) group by restaurant_id),
f as (select r.id,r.name,r.slug,case when u.email_confirmed_at is not null then u.email::text end owner_email,r.created_at,r.status::text status,
 coalesce(b.n,0) branches,coalesce(b.active,0) active_branches,coalesce(t.n,0) tables,coalesce(t.usable,0) dine_in_tables,
 coalesce(c.n,0) categories,coalesce(m.n,0) menu_items,coalesce(m.available,0) available_items,coalesce(s.n,0) staff_accounts,
 coalesce(o.n,0) orders,coalesce(o.cancelled,0) cancelled_orders,coalesce(o.qualifying,0) qualifying_orders,coalesce(o.previous,0) previous_orders,
 o.first_at first_order,o.last_at last_order,coalesce(o.value,0) order_value,
 (r.status='active' and coalesce(b.active,0)>0 and coalesce(m.available,0)>0) ready
 from public.restaurants r left join auth.users u on u.id=r.owner_id
 left join b on b.restaurant_id=r.id left join t on t.restaurant_id=r.id left join c on c.restaurant_id=r.id
 left join m on m.restaurant_id=r.id left join s on s.restaurant_id=r.id left join o on o.restaurant_id=r.id
 where (p_id is null or r.id=p_id) and r.created_at<p_end)
select f.*,case when not ready then 'Setup incomplete' when qualifying_orders>0 then 'Receiving orders'
 when last_order<p_end-make_interval(days=>platform_private.inactivity_days()) then 'Inactive after prior activity'
 else 'Ready for orders' end from f;
$$;

create function platform_private.activity_trend(p_start timestamptz,p_end timestamptz,p_id uuid default null)
returns jsonb language sql stable set search_path='' as $$
with days as (select generate_series((p_start at time zone 'UTC')::date,(p_end at time zone 'UTC')::date,interval '1 day')::date as day),
r as (select (created_at at time zone 'UTC')::date as day,count(*) n from public.restaurants where created_at>=p_start and created_at<p_end and (p_id is null or id=p_id) group by 1),
o as (select (created_at at time zone 'UTC')::date as day,count(*) n,count(distinct restaurant_id) filter(where status<>'cancelled') active from public.orders where created_at>=p_start and created_at<p_end and (p_id is null or restaurant_id=p_id) group by 1),
f as (select d.day,coalesce(r.n,0) signups,coalesce(o.n,0) orders,coalesce(o.active,0) active_restaurants,
 (select count(*) from public.restaurants where created_at<p_start and (p_id is null or id=p_id))+sum(coalesce(r.n,0)) over(order by d.day) total_restaurants
 from days d left join r using(day) left join o using(day))
select coalesce(jsonb_agg(to_jsonb(f) order by day),'[]'::jsonb) from f;
$$;

create function public.platform_overview(p_days integer default 30) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare w record; result jsonb;
begin
 perform platform_private.require_reporting_admin();
 select * into w from platform_private.reporting_window(p_days);
 with f as materialized (select * from platform_private.restaurant_facts(w.start_at,w.end_at))
 select jsonb_build_object('total_restaurants',count(*),'active_restaurants',count(*) filter(where qualifying_orders>0),
 'new_restaurants',count(*) filter(where created_at>=w.start_at),'orders',coalesce(sum(orders),0),
 'cancelled_orders',coalesce(sum(cancelled_orders),0),'needs_setup',count(*) filter(where not ready),
 'inactive_restaurants',count(*) filter(where qualifying_orders=0),'repeat_active',count(*) filter(where qualifying_orders>0 and previous_orders>0),
 'activated_restaurants',count(*) filter(where first_order is not null),
 'first_activations',count(*) filter(where first_order>=w.start_at),
 'new_cohort_activated',count(*) filter(where created_at>=w.start_at and first_order is not null),
 'activation_rate',case when count(*)=0 then null else round(100.0*count(*) filter(where first_order is not null)/count(*),2) end,
 'average_activation_hours',round(avg(extract(epoch from first_order-created_at)/3600) filter(where first_order>=created_at),2),
 'invalid_activation_timestamps',count(*) filter(where first_order<created_at),
 'tables',coalesce(sum(tables),0),'menu_items',coalesce(sum(menu_items),0),'staff_accounts',coalesce(sum(staff_accounts),0),
 'average_orders_per_active',case when count(*) filter(where qualifying_orders>0)=0 then null else round(sum(qualifying_orders)::numeric/count(*) filter(where qualifying_orders>0),2) end,
 'recent_restaurants',(select coalesce(jsonb_agg(x),'[]'::jsonb) from (select id,name,slug,created_at,readiness from f order by created_at desc,id limit 5) x)) into result from f;
 return result||jsonb_build_object('start',w.start_at,'end',w.end_at,'timezone','UTC','inactivity_days',platform_private.inactivity_days(),
 'active_visits',(select count(*) from public.table_sessions where status<>'closed'),
 'trend',platform_private.activity_trend(w.start_at,w.end_at));
end $$;

create function public.platform_restaurants(p_days integer default 30,p_page integer default 1,p_size integer default 25,p_search text default '',p_filter text default 'all',p_sort text default 'newest') returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare w record; result jsonb;
begin
 perform platform_private.require_reporting_admin();
 if p_page is null or p_page<1 or p_page>1000000 or p_size is null or p_size not in (25,50)
 or p_search is null or length(p_search)>100 or p_filter is null or p_filter not in ('all','recent','active','inactive','setup','ready')
 or p_sort is null or p_sort not in ('newest','oldest','activity','orders','name') then raise exception 'Invalid directory options'; end if;
 select * into w from platform_private.reporting_window(p_days);
 with f as materialized (select * from platform_private.restaurant_facts(w.start_at,w.end_at)),
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

create function public.platform_restaurant_detail(p_id uuid,p_days integer default 30) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='10s' as $$
declare w record; result jsonb; receipts jsonb;
begin
 perform platform_private.require_reporting_admin();
 select * into w from platform_private.reporting_window(p_days);
 if p_id is null then return null; end if;
 select to_jsonb(f) into result from platform_private.restaurant_facts(w.start_at,w.end_at,p_id) f;
 if p_id is null or result is null then return null; end if;
 select jsonb_build_object(
 'staff_recorded_amount',coalesce(sum(amount) filter(where status='paid' and confirmation_source='staff_reported' and coalesce(confirmed_at,created_at)>=w.start_at and coalesce(confirmed_at,created_at)<w.end_at),0),
 'staff_recorded_count',count(*) filter(where status='paid' and confirmation_source='staff_reported' and coalesce(confirmed_at,created_at)>=w.start_at and coalesce(confirmed_at,created_at)<w.end_at),
 'legacy_paid_count',count(*) filter(where status='paid' and confirmation_source is null and coalesce(confirmed_at,created_at)>=w.start_at and coalesce(confirmed_at,created_at)<w.end_at),
 'fallback_timestamp_count',count(*) filter(where status='paid' and confirmed_at is null and created_at>=w.start_at and created_at<w.end_at),
 'last_recorded_payment',max(coalesce(confirmed_at,created_at)) filter(where status='paid' and confirmation_source='staff_reported' and coalesce(confirmed_at,created_at)<w.end_at)) into receipts from public.payments where restaurant_id=p_id;
 return result||receipts||jsonb_build_object('start',w.start_at,'end',w.end_at,'timezone',null,'currency',null,
 'active_visits',(select count(*) from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id join public.branches b on b.id=t.branch_id where b.restaurant_id=p_id and s.status<>'closed'),
 'last_visit',(select max(s.opened_at) from public.table_sessions s join public.restaurant_tables t on t.id=s.table_id join public.branches b on b.id=t.branch_id where b.restaurant_id=p_id and s.opened_at<w.end_at),
 'last_completed_order',(select max(h.created_at) from public.order_status_history h join public.orders o on o.id=h.order_id where o.restaurant_id=p_id and h.status='completed' and h.created_at<w.end_at),
 'last_menu_update',(select max(updated_at) from public.menu_items where restaurant_id=p_id and updated_at<w.end_at),
 'trend',platform_private.activity_trend(w.start_at,w.end_at,p_id),'inactivity_days',platform_private.inactivity_days());
end $$;
revoke all on all functions in schema platform_private from public,anon,authenticated,service_role;
revoke all on function public.platform_overview(integer),public.platform_restaurants(integer,integer,integer,text,text,text),public.platform_restaurant_detail(uuid,integer) from public,anon,service_role;
grant execute on function public.platform_overview(integer),public.platform_restaurants(integer,integer,integer,text,text,text),public.platform_restaurant_detail(uuid,integer) to authenticated;
