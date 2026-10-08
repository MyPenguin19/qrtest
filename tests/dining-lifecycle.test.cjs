/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID:uuid}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
let db, nativePool;
const q=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args)=>(await q(sql,args)).rows[0];
before(async()=>{
  if(process.env.DINING_TEST_DATABASE_URL) {
    const pg=require(process.env.PG_TEST_DRIVER||'pg');
    pg.types.setTypeParser(20,Number);
    nativePool=new pg.Pool({connectionString:process.env.DINING_TEST_DATABASE_URL,max:10});
    const client=await nativePool.connect();
    db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql),close:async()=>{client.release();await nativePool.end();}};
  } else db=new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb,phone text,email text,email_confirmed_at timestamptz); do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(`alter table auth.users add column is_anonymous boolean default false, add column banned_until timestamptz;
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),aal text,not_after timestamptz);
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),status text);
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  for(const name of ['20260814000001_extensions_and_enums.sql','20260814000002_core_schema.sql','20260814000003_rls_policies.sql','20261007213147_dining_lifecycle_states.sql','20261007213159_atomic_dining_lifecycle.sql','20261007213210_optional_customer_payment.sql','20261008010236_close_confirmed_external_payment.sql','20261008012009_unified_staff_role.sql','20261008012015_secure_staff_console.sql','20261008111047_platform_admin_foundation.sql']) {
    await db.exec(fs.readFileSync(`supabase/${name.startsWith("202608")?"baseline":"migrations"}/${name}`,'utf8').replace(/create extension[^;]+;/g,''));
    if(name==='20260814000003_rls_policies.sql') await db.exec('grant usage on schema public,auth to authenticated,anon,service_role; grant select on all tables in schema public to authenticated;');
  }
});
after(async()=>{await db.close();});
async function fixture(){
  const f={r:uuid(),b:uuid(),t:uuid(),u:uuid(),staff:uuid(),item:uuid(),category:uuid(),device:uuid()};
  await q('insert into auth.users(id) values($1)',[f.u]);
  await q('insert into restaurants(id,owner_id,name,slug) values($1::uuid,$2,$3,$1::uuid::text)',[f.r,f.u,'Lifecycle Test']);
  await q("insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'owner')",[f.r,f.u]);
  await q("insert into branches(id,restaurant_id,slug,name) values($1,$2,'main','Main')",[f.b,f.r]);
  await q("insert into restaurant_tables(id,branch_id,label) values($1,$2,'1')",[f.t,f.b]);
  await q("insert into staff(id,restaurant_id,branch_id,name,role,pin_hash) values($1,$2,$3,'Cashier','cashier','test')",[f.staff,f.r,f.b]);
  await q("insert into menu_categories(id,restaurant_id,name) values($1,$2,'Drinks')",[f.category,f.r]);
  await q("insert into menu_items(id,restaurant_id,category_id,name,base_price) values($1,$2,$3,'Latte',5)",[f.item,f.r,f.category]);
  return f;
}
async function join(f,device=f.device){return (await one('select dining_join($1,$2,$3,$4) result',[f.r,f.b,f.t,device])).result;}
function payload(f,quantity=1){return {lines:[{itemId:f.item,variantId:null,addonIds:[],quantity,specialInstructions:''}],couponCode:'',customerPhone:'',customerName:''};}
async function submit(f,s,key=uuid(),body=payload(f)){return (await one('select dining_submit($1,$2,$3,$4,$5,$6,$7) result',[f.r,f.b,f.t,s.sessionId,s.customerSessionId,key,body])).result;}
async function bill(f,s){return (await one('select dining_request_bill($1,$2,$3,$4) result',[f.r,f.b,f.t,s.sessionId])).result;}
async function action(f,s,a,key=null,staff=f.staff,user=null){return(await one('select dining_transition($1,$2,$3,$4,$5,$6,$7,$8,$9) result',[f.r,f.b,f.t,s.sessionId,a,staff,user,key,'cash'])).result;}
const state=async(f,s)=>one('select s.status,s.closed_at,s.paid_at,s.bill_requested_at,s.payment_started_at,t.status table_status from table_sessions s join restaurant_tables t on t.id=s.table_id where s.id=$1',[s.sessionId]);

test('A normal meal: scan, two rounds, request, pending, confirmed, closed, available, history intact',async()=>{
  const f=await fixture(),s=await join(f);
  assert.equal((await state(f,s)).table_status,'occupied');
  await submit(f,s);await submit(f,s,uuid(),payload(f,2));
  await q("update orders set status='served' where table_session_id=$1",[s.sessionId]);
  const itemsBefore=(await q('select i.* from order_items i join orders o on o.id=i.order_id where o.table_session_id=$1 order by i.id',[s.sessionId])).rows;
  assert.equal((await bill(f,s)).total,15);
  const key=uuid();await action(f,s,'start_payment',key);assert.equal((await state(f,s)).status,'payment_pending');
  assert.equal((await one('select count(*) n from payments where restaurant_id=$1 and status=\'paid\'',[f.r])).n,0);
  await action(f,s,'confirm_payment',key);const end=await state(f,s);assert.equal(end.table_status,'available');assert.equal(end.status,'closed');
  for(const k of ['closed_at','paid_at','bill_requested_at','payment_started_at'])assert.ok(end[k]);
  assert.deepEqual((await q('select i.* from order_items i join orders o on o.id=i.order_id where o.table_session_id=$1 order by i.id',[s.sessionId])).rows,itemsBefore);
  assert.equal((await one("select count(*) n from order_status_history h join orders o on o.id=h.order_id where o.table_session_id=$1 and h.status='completed'",[s.sessionId])).n,2);
  assert.equal((await one('select count(*) n from orders where table_session_id=$1',[s.sessionId])).n,2);
  assert.equal((await one('select count(*) n from order_items i join orders o on o.id=i.order_id where o.table_session_id=$1',[s.sessionId])).n,2);
});
test('B devices have separate identities, no cart/order before submit, and share one dining visit',async()=>{
  const f=await fixture(),a=await join(f),b=await join(f,uuid());
  assert.equal(a.sessionId,b.sessionId);assert.notEqual(a.customerSessionId,b.customerSessionId);
  assert.equal((await one('select count(*) n from orders where restaurant_id=$1',[f.r])).n,0);
  await submit(f,a);await submit(f,b);assert.equal((await one('select count(*) n from orders where table_session_id=$1',[a.sessionId])).n,2);
});
test('C next party uses same QR, receives a new empty visit, preserving prior orders',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const k=uuid();await action(f,s,'start_payment',k);await action(f,s,'confirm_payment',k);await action(f,s,'close');
  const next=await join(f);assert.notEqual(next.sessionId,s.sessionId);assert.notEqual(next.customerSessionId,s.customerSessionId);
  assert.equal((await one('select count(*) n from orders where table_session_id=$1',[next.sessionId])).n,0);
});
test('D retries use one order and reject a changed payload for the same submission',async()=>{
  const f=await fixture(),s=await join(f),key=uuid();const first=await submit(f,s,key);
  assert.deepEqual(await submit(f,s,key),first);assert.deepEqual(await submit(f,s,key),first);
  await assert.rejects(submit(f,s,key,payload(f,2)),/different order/);
  assert.equal((await one('select count(*) n from orders where table_session_id=$1',[s.sessionId])).n,1);
});
test('E one-active-session constraint rejects duplicate inserts; repeated joins reuse it',async()=>{
  const f=await fixture(),s=await join(f);assert.equal((await join(f)).sessionId,s.sessionId);
  await assert.rejects(q('insert into table_sessions(table_id) values($1)',[f.t]),/one_active_dining_session/);
});
test('F closed stale visit rejects a new order even after the next party joins',async()=>{
  const f=await fixture(),s=await join(f);await action(f,s,'reset_empty');await join(f,uuid());
  await assert.rejects(submit(f,s),/Ordering has ended/);
});
test('G mismatched restaurant/table/device and unauthorized staff are rejected',async()=>{
  const a=await fixture(),b=await fixture(),s=await join(a),other=await join(b);
  await assert.rejects(join({...a,t:b.t}),/does not belong/);
  await assert.rejects(submit(a,{...s,customerSessionId:other.customerSessionId}),/browser does not belong/);
  await assert.rejects(action(a,s,'request_bill',null,b.staff),/not authorized/);
  await assert.rejects(action(a,s,'request_bill',null,null,b.u),/not authorized/);
});
test('H failed payment remains unpaid; retry has a new attempt and only confirmation pays',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const k=uuid();await action(f,s,'start_payment',k);await action(f,s,'fail_payment',k);
  assert.equal((await state(f,s)).status,'bill_requested');assert.equal((await state(f,s)).paid_at,null);
  await assert.rejects(action(f,s,'confirm_payment',k),/no longer pending/);
  const next=uuid();await action(f,s,'start_payment',next);await action(f,s,'confirm_payment',next);
  assert.equal((await one("select count(*) n from payments where restaurant_id=$1 and status='paid'",[f.r])).n,1);
});
test('I duplicate confirmation and closure are idempotent',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const k=uuid();await action(f,s,'start_payment',k);await action(f,s,'start_payment',k);await action(f,s,'confirm_payment',k);await action(f,s,'confirm_payment',k);await action(f,s,'close');const closed=(await state(f,s)).closed_at;await action(f,s,'confirm_payment',k);await action(f,s,'close');
  assert.deepEqual((await state(f,s)).closed_at,closed);assert.equal((await one('select count(*) n from payments where restaurant_id=$1',[f.r])).n,1);
});
test('request repeats and more rounds keep one bill; ordering pauses during payment',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);const b=await bill(f,s);await bill(f,s);await submit(f,s);
  assert.equal((await one('select total_amount from bills where id=$1',[b.billId])).total_amount,'10.00');
  assert.equal((await one('select count(*) n from bills where table_session_id=$1',[s.sessionId])).n,1);
  await action(f,s,'start_payment',uuid());await assert.rejects(submit(f,s),/payment is in progress/);
});
test('unsafe close/reset/direct state transitions fail, empty abandoned visit resets safely',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);
  await assert.rejects(action(f,s,'reset_empty'),/Only an empty/);await assert.rejects(action(f,s,'close'),/Confirm payment/);
  await assert.rejects(q("update table_sessions set status='paid' where id=$1",[s.sessionId]),/Invalid dining/);
  await assert.rejects(q("update table_sessions set status='closed' where id=$1",[s.sessionId]),/unsettled/);
  const f2=await fixture(),s2=await join(f2);await action(f2,s2,'reset_empty');assert.equal((await state(f2,s2)).table_status,'available');
});
test('disabled table/restaurant and unavailable items reject; prices are fetched at submission',async()=>{
  const f=await fixture(),s=await join(f);await q('update restaurant_tables set is_active=false where id=$1',[f.t]);await assert.rejects(join(f),/unavailable/);await assert.rejects(submit(f,s),/unavailable/);
  await q('update restaurant_tables set is_active=true where id=$1',[f.t]);await q('update menu_items set is_available=false where id=$1',[f.item]);await assert.rejects(submit(f,s),/no longer available/);
  await q('update menu_items set is_available=true,base_price=9 where id=$1',[f.item]);const order=await submit(f,s);assert.equal((await one('select total_amount from orders where id=$1',[order.orderId])).total_amount,'9.00');
});
test('invalid second line leaves no partial order',async()=>{
  const f=await fixture(),s=await join(f),p=payload(f);p.lines.push({...p.lines[0],itemId:uuid()});await assert.rejects(submit(f,s,uuid(),p),/no longer available/);
  assert.equal((await one('select count(*) n from orders where table_session_id=$1',[s.sessionId])).n,0);
});
test('authenticated tenants cannot read another visit/orders/payments or call server-only RPCs',async()=>{
  const a=await fixture(),b=await fixture(),s=await join(b);await submit(b,s);await bill(b,s);
  await q("select set_config('request.jwt.claim.sub',$1,false)",[a.u]);await db.exec('set role authenticated');
  try {
    assert.equal((await one('select count(*) n from restaurant_tables where id=$1',[b.t])).n,0);
    for(const table of ['table_sessions','orders','order_items','bills','payments'])assert.equal((await one(`select count(*) n from ${table}`)).n,0);
    await assert.rejects(q('select dining_join($1,$2,$3,$4)',[b.r,b.b,b.t,uuid()]),/permission denied/);
    await assert.rejects(q("update table_sessions set status='closed' where id=$1",[s.sessionId]),/permission denied/);
  }finally{await db.exec('reset role');}
});


if(process.env.DINING_TEST_DATABASE_URL) {
  test('native concurrency: simultaneous first scans create exactly one visit',async()=>{
    const f=await fixture();
    const results=await Promise.all(Array.from({length:5},()=>nativePool.query('select dining_join($1,$2,$3,$4) result',[f.r,f.b,f.t,uuid()])));
    const ids=results.map(r=>r.rows[0].result.sessionId);assert.equal(new Set(ids).size,1);
    assert.equal((await one("select count(*) n from table_sessions where table_id=$1 and status<>'closed'",[f.t])).n,1);
  });
  test('native concurrency: two legitimate orders succeed, repeated submission saves once',async()=>{
    const f=await fixture(),a=await join(f),b=await join(f,uuid()),key=uuid();
    const call=(s,k)=>nativePool.query('select dining_submit($1,$2,$3,$4,$5,$6,$7) result',[f.r,f.b,f.t,s.sessionId,s.customerSessionId,k,payload(f)]);
    const results=await Promise.all([call(a,key),call(a,key),call(b,uuid())]);
    assert.equal(results[0].rows[0].result.orderId,results[1].rows[0].result.orderId);
    assert.equal((await one('select count(*) n from orders where table_session_id=$1',[a.sessionId])).n,2);
  });
  test('native concurrency: request bill racing another round includes it exactly once',async()=>{
    const f=await fixture(),s=await join(f);await submit(f,s);
    await Promise.all([
      nativePool.query('select dining_request_bill($1,$2,$3,$4)',[f.r,f.b,f.t,s.sessionId]),
      nativePool.query('select dining_submit($1,$2,$3,$4,$5,$6,$7)',[f.r,f.b,f.t,s.sessionId,s.customerSessionId,uuid(),payload(f)]),
      nativePool.query('select dining_request_bill($1,$2,$3,$4)',[f.r,f.b,f.t,s.sessionId])
    ]);
    const bills=(await q('select total_amount from bills where table_session_id=$1',[s.sessionId])).rows;
    assert.equal(bills.length,1);assert.equal(bills[0].total_amount,'10.00');
  });
  test('native concurrency: two successful confirmations record one settlement',async()=>{
    const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const k=uuid();await action(f,s,'start_payment',k);
    const call=()=>nativePool.query("select dining_transition($1,$2,$3,$4,'confirm_payment',$5,null,$6,'cash')",[f.r,f.b,f.t,s.sessionId,f.staff,k]);
    await Promise.all([call(),call()]);
    assert.equal((await one("select count(*) n from payments where restaurant_id=$1 and status='paid'",[f.r])).n,1);
  });
}


test('server pricing preserves variants, add-ons, tax, service, coupon and retry-safe usage',async()=>{
  const f=await fixture(),s=await join(f),variant=uuid(),addon=uuid(),offer=uuid(),coupon=uuid();
  await q('update restaurants set tax_percent=10,service_charge_percent=5 where id=$1',[f.r]);
  await q("insert into menu_variants(id,item_id,name,price) values($1,$2,'Large',8)",[variant,f.item]);
  await q("insert into menu_addons(id,item_id,name,price) values($1,$2,'Milk',2)",[addon,f.item]);
  await q("insert into offers(id,restaurant_id,name,type,percentage_value) values($1,$2,'Ten off','percentage',10)",[offer,f.r]);
  await q("insert into coupons(id,restaurant_id,offer_id,code,usage_limit) values($1,$2,$3,'TEN',1)",[coupon,f.r,offer]);
  const body=payload(f);Object.assign(body.lines[0],{variantId:variant,addonIds:[addon]});body.couponCode='TEN';const k=uuid();
  const result=await submit(f,s,k,body);await submit(f,s,k,body);
  const order=await one('select subtotal,discount_amount,tax_amount,service_charge_amount,total_amount from orders where id=$1',[result.orderId]);
  assert.deepEqual(order,{subtotal:'10.00',discount_amount:'1.00',tax_amount:'0.90',service_charge_amount:'0.45',total_amount:'10.35'});
  assert.equal((await one('select times_used from coupons where id=$1',[coupon])).times_used,1);
  await assert.rejects(submit(f,s,uuid(),body),/exhausted/);
});
test('cancelled orders are excluded from the bill and payment amount',async()=>{
  const f=await fixture(),s=await join(f);const o=await submit(f,s);await submit(f,s);await q("update orders set status='cancelled' where id=$1",[o.orderId]);
  assert.equal((await bill(f,s)).total,5);const k=uuid();await action(f,s,'start_payment',k);
  assert.equal((await one('select amount from payments where attempt_key=$1',[k])).amount,'5.00');
});
test('disabled restaurant rejects joining; PIN manager records cannot initiate financial confirmation',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);
  await q("update staff set role='manager' where id=$1",[f.staff]);await assert.rejects(action(f,s,'start_payment',uuid()),/not authorized/);
  await q("update restaurants set status='suspended' where id=$1",[f.r]);await assert.rejects(join(f),/unavailable/);
});
test('new tables expose no direct customer/cart data and lifecycle RPCs are not public',async()=>{
  assert.equal((await one("select relrowsecurity enabled from pg_class where oid='customer_sessions'::regclass")).enabled,true);
  assert.equal((await one("select has_table_privilege('anon','customer_sessions','select') allowed")).allowed,false);
  assert.equal((await one("select has_table_privilege('authenticated','customer_sessions','select') allowed")).allowed,false);
  assert.equal((await one("select count(*) n from pg_proc where proname like 'dining_%' and (prosecdef or has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute'))")).n,0);
});

test('database rejects payment-pending without an attempt and paid bill without confirmation',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);const b=await bill(f,s);
  await assert.rejects(q("update table_sessions set status='payment_pending' where id=$1",[s.sessionId]),/pending payment attempt/);
  await assert.rejects(q("update bills set status='paid' where id=$1",[b.billId]),/Confirm payment/);
  await assert.rejects(q("update restaurant_tables set status='available' where id=$1",[f.t]),/Close the active visit/);
});

test('orders cannot be detached from their original dining history',async()=>{
  const f=await fixture(),s=await join(f),o=await submit(f,s);
  await assert.rejects(q('update orders set table_session_id=null where id=$1',[o.orderId]),/cannot move between visits/);
});

async function counter(f,s){return(await one('select dining_counter_intent($1,$2,$3,$4,$5) result',[f.r,f.b,f.t,s.sessionId,s.customerSessionId])).result;}
async function manual(f,s,reason='external_manual',staff=f.staff,user=null){return(await one('select dining_manual_close($1,$2,$3,$4,$5,$6,$7) result',[f.r,f.b,f.t,s.sessionId,staff,user,reason])).result;}

test('3.1 A: two devices submit distinct rounds and keep an authoritative shared total',async()=>{
  const f=await fixture(),a=await join(f),b=await join(f,uuid());
  const items=[];
  for(const [name,price] of [['Coke',4],['Burger',15],['Pizza',18]]){
    const id=uuid();await q('insert into menu_items(id,restaurant_id,category_id,name,base_price) values($1,$2,$3,$4,$5)',[id,f.r,f.category,name,price]);items.push(id);
  }
  const body=payload(f);body.lines=[items[0],items[1]].map(itemId=>({...body.lines[0],itemId}));
  const first=await submit(f,a,uuid(),body);const second=await submit(f,b);
  const thirdBody=payload(f);thirdBody.lines[0].itemId=items[2];const third=await submit(f,a,uuid(),thirdBody);
  assert.equal(new Set([first.orderId,second.orderId,third.orderId]).size,3);
  assert.equal((await one('select sum(total_amount) total from orders where table_session_id=$1',[a.sessionId])).total,'42.00');
  assert.equal((await one('select count(*) n from order_items where order_id in (select id from orders where table_session_id=$1)',[a.sessionId])).n,4);
});
test('3.1 B: counter intent is idempotent, stays open, creates no payment, allows more orders',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);assert.equal((await counter(f,s)).total,5);
  const at=(await one('select payment_intent_at from table_sessions where id=$1',[s.sessionId])).payment_intent_at;
  await counter(f,s);await submit(f,s);assert.equal((await counter(f,s)).total,10);
  assert.equal((await state(f,s)).status,'open');assert.equal((await state(f,s)).paid_at,null);
  assert.equal((await one('select payment_intent from table_sessions where id=$1',[s.sessionId])).payment_intent,'counter');
  assert.deepEqual((await one('select payment_intent_at from table_sessions where id=$1',[s.sessionId])).payment_intent_at,at);
  assert.equal((await one('select count(*) n from payments where restaurant_id=$1',[f.r])).n,0);
});
test('3.1 C: staff closes without any customer payment action; history remains, no verified payment',async()=>{
  const f=await fixture(),s=await join(f),o=await submit(f,s);await manual(f,s);
  const row=await one('select * from table_sessions where id=$1',[s.sessionId]);
  assert.equal(row.status,'closed');assert.equal(row.payment_intent,null);assert.equal(row.paid_at,null);assert.equal(row.closed_reason,'external_manual');assert.equal(row.closed_by_staff_id,f.staff);
  assert.equal((await state(f,s)).table_status,'available');
  const savedBill=await one('select * from bills where table_session_id=$1',[s.sessionId]);assert.notEqual(savedBill.status,'paid');assert.ok(savedBill.closed_at);assert.equal(savedBill.total_amount,'5.00');
  assert.equal((await one('select count(*) n from order_items where order_id=$1',[o.orderId])).n,1);
  assert.equal((await one('select count(*) n from payments where restaurant_id=$1',[f.r])).n,0);
  await manual(f,s);assert.deepEqual((await state(f,s)).closed_at,row.closed_at);
});
test('3.1 D: old device cannot order or set intent on next party; new party orders normally',async()=>{
  const f=await fixture(),a=await join(f);await submit(f,a);await manual(f,a);const b=await join(f,uuid());
  assert.notEqual(a.sessionId,b.sessionId);await assert.rejects(submit(f,a),/Ordering has ended/);await assert.rejects(counter(f,a),/ended/);
  await submit(f,b);assert.equal((await one('select count(*) n from orders where table_session_id=$1',[b.sessionId])).n,1);
});
test('3.1 manual closure rejects foreign/unauthorized actors and unresolved payments',async()=>{
  const a=await fixture(),b=await fixture(),s=await join(a);await submit(a,s);
  await assert.rejects(manual(a,s,'external_manual',b.staff),/not authorized/);
  await assert.rejects(manual(a,s,'external_manual',null,b.u),/not authorized/);
  await q("update staff set role='manager' where id=$1",[a.staff]);await assert.rejects(manual(a,s),/not authorized/);
  await q("update staff set role='cashier' where id=$1",[a.staff]);await bill(a,s);await action(a,s,'start_payment',uuid());await assert.rejects(manual(a,s),/Resolve the pending/);
});
test('3.1 manual clear preserves unpaid truth and allows owner closure after bill request',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);await manual(f,s,'manual_unsettled',null,f.u);
  const row=await one('select closed_reason,closed_by,paid_at from table_sessions where id=$1',[s.sessionId]);assert.deepEqual(row,{closed_reason:'manual_unsettled',closed_by:f.u,paid_at:null});
  await assert.rejects(q("update table_sessions set closed_at=now() where id=$1",[s.sessionId]),/immutable/);
});
test('3.1 counter intent rejects mismatched tenant, device and closed session',async()=>{
  const a=await fixture(),b=await fixture(),s=await join(a),other=await join(b);
  await assert.rejects(counter({...a,t:b.t},s),/does not belong/);
  await assert.rejects(counter(a,{...s,customerSessionId:other.customerSessionId}),/browser/);
  await manual(a,s);await assert.rejects(counter(a,s),/ended/);
});
if(process.env.DINING_TEST_DATABASE_URL) test('3.1 F: order racing manual closure is included before close or rejected, never orphaned',async()=>{
  for(let i=0;i<6;i++){
    const f=await fixture(),s=await join(f);await submit(f,s);
    const results=await Promise.allSettled([
      nativePool.query('select dining_manual_close($1,$2,$3,$4,$5,null,$6)',[f.r,f.b,f.t,s.sessionId,f.staff,'external_manual']),
      nativePool.query('select dining_submit($1,$2,$3,$4,$5,$6,$7)',[f.r,f.b,f.t,s.sessionId,s.customerSessionId,uuid(),payload(f)])
    ]);
    assert.equal(results[0].status,'fulfilled');
    if(results[1].status==='rejected') assert.match(results[1].reason.message,/Ordering has ended/);
    const total=await one('select sum(total_amount) total,count(*) n from orders where table_session_id=$1',[s.sessionId]);
    assert.equal(total.n,results[1].status==='fulfilled'?2:1);
    assert.equal((await one('select total_amount from bills where table_session_id=$1',[s.sessionId])).total_amount,total.total);
    assert.equal((await state(f,s)).status,'closed');const next=await join(f);assert.notEqual(next.sessionId,s.sessionId);await submit(f,next);
  }
});

test('3.1 legacy page can resume only its original active visit, including at QR upgrade',async()=>{
  const f=await fixture(),a=await join(f);
  const resume=()=>one('select dining_join($1,$2,$3,$4,$5) result',[f.r,f.b,f.t,f.device,a.sessionId]);
  assert.equal((await resume()).result.sessionId,a.sessionId);
  await manual(f,a);await assert.rejects(resume(),/session has ended/);
  const b=await join(f,uuid());await assert.rejects(resume(),/session has ended/);
  assert.notEqual(b.sessionId,a.sessionId);
  assert.equal((await one('select count(*) n from customer_sessions where table_session_id=$1',[b.sessionId])).n,1);
});

test('3.2 cleanup: abandoned, failed and retried pending attempts never close the visit',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);
  const first=uuid();await action(f,s,'start_payment',first);
  await action(f,s,'start_payment',first); // A repeated start is not a receipt.
  let row=await state(f,s);assert.equal(row.status,'payment_pending');assert.equal(row.closed_at,null);assert.equal(row.paid_at,null);assert.equal(row.table_status,'payment_pending');
  await action(f,s,'fail_payment',first);row=await state(f,s);assert.equal(row.status,'bill_requested');assert.equal(row.closed_at,null);
  await assert.rejects(action(f,s,'confirm_payment',first),/no longer pending/);
  const retry=uuid();await action(f,s,'start_payment',retry);row=await state(f,s);assert.equal(row.status,'payment_pending');assert.equal(row.closed_at,null);
  await action(f,s,'confirm_payment',retry);assert.equal((await state(f,s)).status,'closed');
  assert.equal((await one("select count(*) n from payments where restaurant_id=$1 and status='paid'",[f.r])).n,1);
});
test('3.2 cleanup: closure failure rolls back receipt, bill and session; retry closes once',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const key=uuid();await action(f,s,'start_payment',key);
  await db.exec(`create function test_block_closure() returns trigger language plpgsql as $$ begin if new.status='closed' then raise exception 'Injected closure failure'; end if; return new; end $$; create trigger test_block_closure before update on table_sessions for each row execute function test_block_closure();`);
  try {
    await assert.rejects(action(f,s,'confirm_payment',key),/Injected closure failure/);
    const row=await state(f,s);assert.equal(row.status,'payment_pending');assert.equal(row.paid_at,null);assert.equal(row.closed_at,null);
    assert.equal((await one('select status,confirmed_at from payments where attempt_key=$1',[key])).status,'pending');
    assert.equal((await one('select status from bills where table_session_id=$1',[s.sessionId])).status,'requested');
  } finally { await db.exec('drop trigger test_block_closure on table_sessions; drop function test_block_closure();'); }
  await action(f,s,'confirm_payment',key);assert.equal((await state(f,s)).status,'closed');
});
test('3.2 cleanup: stale receipt retries cannot close the next party or duplicate history',async()=>{
  const f=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const key=uuid();await action(f,s,'start_payment',key);await action(f,s,'confirm_payment',key);
  const old=await state(f,s),history=(await q('select * from order_status_history where order_id in (select id from orders where table_session_id=$1) order by id',[s.sessionId])).rows;
  const next=await join(f,uuid());await submit(f,next);
  await action(f,s,'confirm_payment',key);
  assert.equal((await state(f,next)).status,'open');assert.equal((await state(f,next)).table_status,'order_pending');
  assert.deepEqual((await state(f,s)).closed_at,old.closed_at);
  assert.deepEqual((await q('select * from order_status_history where order_id in (select id from orders where table_session_id=$1) order by id',[s.sessionId])).rows,history);
  assert.equal((await one('select count(*) n from payments where restaurant_id=$1',[f.r])).n,1);
});
test('3.2 cleanup: confirmation denies foreign tenant, branch, and PIN manager identities',async()=>{
  const f=await fixture(),foreign=await fixture(),s=await join(f);await submit(f,s);await bill(f,s);const key=uuid();await action(f,s,'start_payment',key);
  await assert.rejects(action(f,s,'confirm_payment',key,foreign.staff),/not authorized/);
  await assert.rejects(action(f,s,'confirm_payment',key,null,foreign.u),/not authorized/);
  const otherBranch=uuid();await q("insert into branches(id,restaurant_id,slug,name) values($1,$2,'other','Other')",[otherBranch,f.r]);
  await q('update staff set branch_id=$1 where id=$2',[otherBranch,f.staff]);
  await assert.rejects(action(f,s,'confirm_payment',key),/not authorized/);
  await q("update staff set branch_id=$1,role='manager' where id=$2",[f.b,f.staff]);
  await assert.rejects(action(f,s,'confirm_payment',key),/not authorized/);
  assert.equal((await state(f,s)).status,'payment_pending');
  await action(f,s,'confirm_payment',key,null,f.u);assert.equal((await state(f,s)).status,'closed');
});

// 3.3: real auth/session/operational RPCs, sharing the existing dining fixtures.
async function staffSession(f,staff=f.staff) {
  const token=require('node:crypto').randomBytes(32).toString('hex');
  const row=await one('select auth_version,pin_hash from staff where id=$1',[staff]);
  assert.equal((await one('select staff_login_finish($1,$2,$3,$4,$5) ok',[f.r,staff,row.auth_version,row.pin_hash,token])).ok,true);
  return token;
}
async function sessionCheck(token,touch=false){return (await one('select staff_session_check($1,$2) actor',[token,touch])).actor;}
async function opOrder(token,order,expected,next){return (await one('select staff_order_action($1,$2,$3,$4) ok',[token,order,expected,next])).ok;}
async function opTable(token,f,s,action,key=null){return (await one('select staff_table_action($1,$2,$3,$4,$5) result',[token,f.t,s.sessionId,action,key])).result;}
async function management(f,act,id=null,access='staff',pin='hash',actor=f.u,email=null){return q('select manage_staff($1,$2,$3,$4,$5,$6,$7,$8,$9)',[actor,f.r,act,id,'Nico',f.b,pin,access,email]);}

test('3.3 A/E: separate revocable devices, PIN reset, deactivate/reactivate and assignment changes invalidate sessions',async()=>{
 const f=await fixture(),a=await staffSession(f),b=await staffSession(f);
 assert.equal((await sessionCheck(a)).role,'staff');assert.equal((await sessionCheck(b)).staffId,f.staff);
 await q('update staff_sessions set revoked_at=now() where token_hash=$1',[a]);assert.equal(await sessionCheck(a),null);assert.ok(await sessionCheck(b));
 await management(f,'reset_pin',f.staff);assert.equal(await sessionCheck(b),null);
 const c=await staffSession(f);await management(f,'deactivate',f.staff);assert.equal(await sessionCheck(c),null);
 assert.equal((await one('select staff_login_begin($1,$2) result',[f.r,f.staff])).result,null);
 await management(f,'activate',f.staff);assert.equal(await sessionCheck(c),null);
 const d=await staffSession(f);await management(f,'revoke',f.staff);assert.equal(await sessionCheck(d),null);
 const e=await staffSession(f);await q('update staff set branch_id=null where id=$1',[f.staff]);assert.equal(await sessionCheck(e),null);
});
test('3.3 A: server expiry and inactivity cannot be prolonged by polling or revived by heartbeat',async()=>{
 const f=await fixture(),token=await staffSession(f);
 await q("update staff_sessions set last_active_at=now()-interval '20 minutes' where token_hash=$1",[token]);
 const before=(await one('select last_active_at from staff_sessions where token_hash=$1',[token])).last_active_at;
 assert.ok(await sessionCheck(token));assert.deepEqual((await one('select last_active_at from staff_sessions where token_hash=$1',[token])).last_active_at,before);
 assert.ok(await sessionCheck(token,true));
 await q("update staff_sessions set last_active_at=now()-interval '31 minutes' where token_hash=$1",[token]);assert.equal(await sessionCheck(token,true),null);
 const other=await staffSession(f);await q("update staff_sessions set expires_at=now()-interval '1 second' where token_hash=$1",[other]);assert.equal(await sessionCheck(other,true),null);
});
test('3.3 B/C/D: Nico and Maria operate three rounds and walk-up payment with one shared visit and full attribution',async()=>{
 const f=await fixture();await management(f,'add');
 const nico=(await one("select id from staff where restaurant_id=$1 and name='Nico'",[f.r])).id;
 const maria=uuid();await q("insert into staff(id,restaurant_id,branch_id,name,role,pin_hash) values($1,$2,$3,'Maria','staff','hash')",[maria,f.r,f.b]);
 const n=await staffSession(f,nico),m=await staffSession(f,maria),s=await join(f);const ids=[];
 for(const name of ['Coke','Coffee','Pizza']) {
  await q('update menu_items set name=$1 where id=$2',[name,f.item]);const o=await submit(f,s);ids.push(o.orderId);
  assert.equal(await opOrder(n,o.orderId,'pending','ready'),true);
  assert.equal(await opOrder(n,o.orderId,'pending','ready'),false);
  assert.equal(await opOrder(m,o.orderId,'ready','served'),true);
 }
 assert.equal((await state(f,s)).status,'open');
 assert.deepEqual((await q('select item_name from order_items where order_id=any($1) order by item_name',[ids])).rows.map(x=>x.item_name),['Coffee','Coke','Pizza']);
 const key=uuid();await opTable(n,f,s,'start_payment',key);assert.equal((await state(f,s)).status,'payment_pending');
 await assert.rejects(opTable(n,f,s,'close'),/Confirm payment/);await assert.rejects(opTable(n,f,s,'manual_close'),/Unsupported/);
 await opTable(n,f,s,'confirm_payment',key);await opTable(m,f,s,'confirm_payment',key);
 const row=await state(f,s);assert.equal(row.status,'closed');assert.equal(row.table_status,'available');
 assert.equal((await one('select closed_by_staff_id from table_sessions where id=$1',[s.sessionId])).closed_by_staff_id,nico);
 assert.equal((await one('select recorded_by_staff_id,amount from payments where attempt_key=$1',[key])).recorded_by_staff_id,nico);
 assert.equal((await one("select count(*) n from order_status_history where order_id=any($1) and status='ready' and changed_by_staff_id=$2",[ids,nico])).n,3);
 assert.equal((await one("select count(*) n from order_status_history where order_id=any($1) and status='served' and changed_by_staff_id=$2",[ids,maria])).n,3);
 await assert.rejects(submit(f,s),/Ordering has ended/);
});
test('3.3 F/I: token-derived identity rejects foreign orders, tables, branches and management attempts',async()=>{
 const f=await fixture(),g=await fixture(),token=await staffSession(f),s=await join(g),o=await submit(g,s);
 await assert.rejects(opOrder(token,o.orderId,'pending','ready'),/Order not found/);
 await assert.rejects(opTable(token,g,s,'start_payment',uuid()),/Table not found/);
 await assert.rejects(management(f,'add',null,'staff','hash',g.u),/Management access/);
 await assert.rejects(management(f,'add',null,'manager','hash',f.staff),/Management access/);
 await assert.rejects(management({...f,b:g.b},'add'),/Branch not found/);
 const local=await join(f),order=await submit(f,local);await q('update staff set is_active=false where id=$1',[f.staff]);
 await assert.rejects(opOrder(token,order.orderId,'pending','ready'),/session expired/);
 await assert.rejects(opTable(token,f,local,'start_payment',uuid()),/session expired/);
});
test('3.3 J: attempt reservations enforce persistent lockout and do not issue sessions after concurrent reset',async()=>{
 const f=await fixture();let candidate;
 for(let i=0;i<5;i++){candidate=(await one('select staff_login_begin($1,$2) r',[f.r,f.staff])).r;assert.equal(candidate.id,f.staff);}
 assert.equal((await one('select staff_login_begin($1,$2) r',[f.r,f.staff])).r.locked,true);
 await q("update staff_login_limits set window_start=now()-interval '16 minutes' where scope=$1",['staff:'+f.staff]);
 assert.equal((await one('select staff_login_begin($1,$2) r',[f.r,f.staff])).r.id,f.staff);
 await management(f,'reset_pin',f.staff,'staff','new-hash');
 assert.equal((await one('select staff_login_finish($1,$2,$3,$4,$5) ok',[f.r,f.staff,candidate.auth_version,candidate.pin_hash,'a'.repeat(64)])).ok,false);
 assert.equal((await one('select count(*) n from staff_sessions where staff_id=$1',[f.staff])).n,0);
});
test('3.3 I: only owner assigns verified Manager account, PIN cannot authenticate manager; demotion and deactivation remove membership',async()=>{
 const f=await fixture(),manager=uuid(),unverified=uuid(),email=uuid()+'@example.test';
 await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,null)',[manager,email,unverified,'unverified'+email]);
 await assert.rejects(management(f,'add',null,'manager',null,f.u,'unverified'+email),/verified email/);
 await management(f,'add',null,'manager',null,f.u,email);
 const member=await one('select * from staff where manager_user_id=$1',[manager]);
 assert.equal((await one('select role from restaurant_members where user_id=$1 and restaurant_id=$2',[manager,f.r])).role,'manager');
 assert.equal((await one('select staff_login_begin($1,$2) r',[f.r,member.id])).r,null);
 await assert.rejects(management(f,'add',null,'manager',null,manager,email),/Only the owner/);
 await management(f,'add',null,'staff','hash',manager);
 await management(f,'deactivate',member.id);assert.equal((await one('select count(*) n from restaurant_members where user_id=$1 and restaurant_id=$2',[manager,f.r])).n,0);
 await management(f,'activate',member.id);
 await management(f,'edit',member.id,'staff','new-pin-hash');
 assert.equal((await one('select count(*) n from restaurant_members where user_id=$1 and restaurant_id=$2',[manager,f.r])).n,0);
 assert.equal((await one('select id from staff where id=$1',[member.id])).id,member.id);
});
test('3.3 J: new credential/session tables and RPCs are not exposed to public or authenticated roles',async()=>{
 for(const role of ['anon','authenticated']) {
  for(const table of ['staff_sessions','staff_login_limits'])assert.equal((await one("select has_table_privilege($1,$2,'SELECT') ok",[role,table])).ok,false);
  const rows=(await q("select has_function_privilege($1,oid,'EXECUTE') ok from pg_proc where pronamespace='public'::regnamespace and proname in ('staff_login_begin','staff_login_finish','staff_session_check','staff_order_action','staff_table_action','manage_staff')",[role])).rows;
  assert.equal(rows.length,6);assert.ok(rows.every(r=>!r.ok));
 }
});
if(process.env.DINING_TEST_DATABASE_URL) test('3.3 G: parallel staff tokens update each round/receipt once, with one history entry and one closure',async()=>{
 const f=await fixture(),a=await staffSession(f),b=await staffSession(f),s=await join(f),o=await submit(f,s);
 const ready=t=>nativePool.query("select staff_order_action($1,$2,'pending','ready')",[t,o.orderId]);
 await Promise.all([ready(a),ready(b)]);
 assert.equal((await one("select count(*) n from order_status_history where order_id=$1 and status='ready'",[o.orderId])).n,1);
 await opOrder(a,o.orderId,'ready','served');const key=uuid();await opTable(a,f,s,'start_payment',key);
 const pay=t=>nativePool.query("select staff_table_action($1,$2,$3,'confirm_payment',$4)",[t,f.t,s.sessionId,key]);
 await Promise.all([pay(a),pay(b)]);
 assert.equal((await one("select count(*) n from payments where restaurant_id=$1 and status='paid'",[f.r])).n,1);
 assert.equal((await state(f,s)).status,'closed');
});

test('3.3 security: operational users cannot read credential hashes through authenticated RLS',async()=>{
 const f=await fixture();await q("select set_config('request.jwt.claim.sub',$1,false)",[f.staff]);await db.exec('set role authenticated');
 try {assert.equal((await one('select count(*) n from staff')).n,0);}finally{await db.exec('reset role');}
});
test('3.3 session refuses suspended restaurants and foreign or disabled assigned branches',async()=>{
 const f=await fixture(),t=await staffSession(f);
 await q("update restaurants set status='suspended' where id=$1",[f.r]);assert.equal(await sessionCheck(t),null);
 await q("update restaurants set status='active' where id=$1",[f.r]);await q('update branches set is_active=false where id=$1',[f.b]);assert.equal(await sessionCheck(t),null);
});
test('3.3 order/history failures roll back together',async()=>{
 const f=await fixture(),token=await staffSession(f),s=await join(f),o=await submit(f,s);
 await db.exec("create function test_block_history() returns trigger language plpgsql as $$ begin raise exception 'Injected history failure'; end $$; create trigger test_block_history before insert on order_status_history for each row execute function test_block_history();");
 try {await assert.rejects(opOrder(token,o.orderId,'pending','ready'),/Injected history failure/);assert.equal((await one('select status from orders where id=$1',[o.orderId])).status,'pending');}
 finally {await db.exec('drop trigger test_block_history on order_status_history; drop function test_block_history();');}
 assert.equal(await opOrder(token,o.orderId,'pending','ready'),true);
});

// 3.5.1 platform boundary: real SQL authorization; no mocked RLS.
async function platformFixture() {
  const id=uuid(),session=uuid();
  await q("insert into auth.users(id,email,email_confirmed_at) values($1,'fixture@example.invalid',now())",[id]);
  await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal2')",[session,id]);
  await q("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[id]);
  return {id,session};
}
async function platformAs(f,body,aal='aal2',extra={}) {
  await q("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[f?.id??'',JSON.stringify({sub:f?.id,session_id:f?.session,aal,exp:Math.floor(Date.now()/1000)+600,...extra})]);
  await q('set role authenticated');
  try{return await body();}finally{await q('reset role');await q("select set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims','{}',false)");}
}
const platformStatus=()=>one('select platform_admin_status() status');
test('3.5.1 platform: anonymous, owner/manager without authorization and forged metadata denied',async()=>{
  assert.equal((await platformAs(null,platformStatus)).status,'denied');
  const f=await platformFixture();
  assert.equal((await platformAs(f,platformStatus,'aal2',{user_metadata:{role:'super_admin'},app_metadata:{role:'super_admin'}})).status,'denied');
  await q('set role anon');try{await assert.rejects(platformStatus(),/permission denied/);}finally{await q('reset role');}
});
test('3.5.1 platform: controlled provision, AAL2, active session/factor and immediate revocation',async()=>{
  const f=await platformFixture();await q('select platform_set_admin($1,true)',[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'allowed');
  assert.equal((await platformAs(f,platformStatus,'aal1')).status,'mfa_required');
  assert.equal((await platformAs(f,platformStatus,'aal2',{exp:1})).status,'denied');
  assert.equal((await platformAs(f,platformStatus,'aal2',{session_id:uuid()})).status,'denied');
  await q("update auth.sessions set aal='aal1' where id=$1",[f.session]);
  assert.equal((await platformAs(f,platformStatus)).status,'mfa_required');
  await q("update auth.sessions set aal='aal2' where id=$1",[f.session]);
  await q('select platform_set_admin($1,false)',[f.id]);await q('select platform_set_admin($1,false)',[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'denied');
  assert.equal((await one("select count(*) n from platform_audit_logs where target_id=$1 and action='platform_admin.revoked'",[f.id])).n,1);
  await q('select platform_set_admin($1,true)',[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'allowed');
  await q("delete from auth.mfa_factors where user_id=$1",[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'mfa_required');
  await q('delete from auth.sessions where id=$1',[f.session]);
  assert.equal((await platformAs(f,platformStatus)).status,'denied');
});
test('3.5.1 platform: no browser/service-role self-promotion or audit access',async()=>{
  const f=await platformFixture();
  for(const role of ['anon','authenticated','service_role']) {
    await q(`set role ${role}`);
    try {
      for(const sql of ["select * from platform_admins","insert into platform_admins(user_id) values(gen_random_uuid())","update platform_admins set is_active=true","delete from platform_admins","select * from platform_audit_logs","insert into platform_audit_logs(action,target_type,result) values('platform_admin.provisioned','platform','success')",`select platform_set_admin('${f.id}',true)`])await assert.rejects(q(sql),/permission denied/);
    } finally {await q('reset role');}
  }
});
test('3.5.1 platform: verified identity and MFA required for provisioning; audit immutable and transactional',async()=>{
  const id=uuid();await q('insert into auth.users(id) values($1)',[id]);
  await assert.rejects(q('select platform_set_admin($1,true)',[id]),/verified/);
  const f=await platformFixture();
  await q('begin');await q('select platform_set_admin($1,true)',[f.id]);await q('rollback');
  assert.equal((await one('select count(*) n from platform_admins where user_id=$1',[f.id])).n,0);
  assert.equal((await one('select count(*) n from platform_audit_logs where target_id=$1',[f.id])).n,0);
  await q('select platform_set_admin($1,true)',[f.id]);
  await assert.rejects(q("update platform_audit_logs set result='denied' where target_id=$1",[f.id]),/append-only/);
  await assert.rejects(q('delete from platform_audit_logs where target_id=$1',[f.id]),/append-only/);
  await assert.rejects(q('truncate platform_audit_logs'),/append-only/);
});
test('3.5.1 platform: denied audit deduplicates and platform authority cannot bypass restaurant RLS',async()=>{
  const f=await platformFixture(),r=await fixture();
  const visit=await join(r);await submit(r,visit);
  await q('grant update on restaurant_tables to authenticated');
  await platformAs(f,platformStatus);await platformAs(f,platformStatus);
  assert.equal((await one("select count(*) n from platform_audit_logs where actor_user_id=$1 and action='platform.access_denied'",[f.id])).n,1);
  await q('select platform_set_admin($1,true)',[f.id]);
  await platformAs(f,async()=>{
    assert.equal((await one('select is_platform_admin() value')).value,false);
    assert.equal((await one('select count(*) n from orders where restaurant_id=$1',[r.r])).n,0);
    await q("update restaurant_tables set status='available' where id=$1",[r.t]);
  });
  assert.equal((await one('select status from restaurant_tables where id=$1',[r.t])).status,'order_pending');
});

test('3.5.1 platform: inactive/revoked rows, banned user and expired session independently deny',async()=>{
  const f=await platformFixture();await q('select platform_set_admin($1,true)',[f.id]);
  await q('update platform_admins set is_active=false where user_id=$1',[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'denied');
  await q('update platform_admins set is_active=true,revoked_at=now() where user_id=$1',[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'denied');
  await q('select platform_set_admin($1,true)',[f.id]);
  await q("update auth.users set banned_until=now()+interval '1 day' where id=$1",[f.id]);
  assert.equal((await platformAs(f,platformStatus)).status,'denied');
  await q('update auth.users set banned_until=null where id=$1',[f.id]);
  await q("update auth.sessions set not_after=now()-interval '1 minute' where id=$1",[f.session]);
  assert.equal((await platformAs(f,platformStatus)).status,'denied');
});

test('3.5.1 platform: repeated concurrent operator changes produce one provision and one revocation',async()=>{
  const f=await platformFixture();
  const run=active=>nativePool?Promise.all([1,2].map(()=>nativePool.query('select platform_set_admin($1,$2)',[f.id,active]))):q('select platform_set_admin($1,$2)',[f.id,active]);
  await run(true);await run(false);
  const rows=(await q("select action,count(*) n from platform_audit_logs where target_id=$1 group by action order by action",[f.id])).rows;
  assert.deepEqual(rows,[{action:'platform_admin.provisioned',n:1},{action:'platform_admin.revoked',n:1}]);
});
