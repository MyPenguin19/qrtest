/* eslint-disable @typescript-eslint/no-require-imports -- Node test runner. */
const {test,before,after,beforeEach,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID:uuid}=require('node:crypto');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
let db, nativePool;
const q=(sql,args=[])=>db.query(sql,args);
const one=async(sql,args)=>(await q(sql,args)).rows[0];
before(async()=>{
  if(process.env.REPORT_TEST_DATABASE_URL) {
    const pg=require(process.env.PG_TEST_DRIVER||'pg');
    pg.types.setTypeParser(20,Number);
    nativePool=new pg.Pool({connectionString:process.env.REPORT_TEST_DATABASE_URL,max:10});
    const client=await nativePool.connect();
    db={query:(...args)=>client.query(...args),exec:sql=>client.query(sql),close:async()=>{client.release();await nativePool.end();}};
  } else db=new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb,phone text,email text,email_confirmed_at timestamptz); do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if; end $$; create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`);
  await db.exec(`alter table auth.users add column is_anonymous boolean default false, add column banned_until timestamptz;
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),aal text,not_after timestamptz);
    create table auth.mfa_amr_claims(session_id uuid,authentication_method text,created_at timestamptz default now(),updated_at timestamptz default now());
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),status text);
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  for(const name of ['20260814000001_extensions_and_enums.sql','20260814000002_core_schema.sql','20260814000003_rls_policies.sql','20261007213147_dining_lifecycle_states.sql','20261007213159_atomic_dining_lifecycle.sql','20261007213210_optional_customer_payment.sql','20261008010236_close_confirmed_external_payment.sql','20261008012009_unified_staff_role.sql','20261008012015_secure_staff_console.sql','20261008111047_platform_admin_foundation.sql','20261008212741_platform_intelligence.sql','20261009022449_platform_controls.sql']) {
    await db.exec(fs.readFileSync(`supabase/${name.startsWith("202608")?"baseline":"migrations"}/${name}`,'utf8').replace(/create extension[^;]+;/g,''));
    if(name==='20260814000003_rls_policies.sql') await db.exec('grant usage on schema public,auth to authenticated,anon,service_role; grant select on all tables in schema public to authenticated;');
  }
});
after(async()=>{await db.close();});

beforeEach(async()=>{await q('begin');});
afterEach(async()=>{await q('rollback');});
async function adminFixture(){
 const id=uuid(),session=uuid();await q("insert into auth.users(id,email,email_confirmed_at) values($1,'operator@example.invalid',now())",[id]);
 await q("insert into auth.sessions(id,user_id,aal) values($1,$2,'aal2')",[session,id]);
 await q("insert into auth.mfa_factors(user_id,status) values($1,'verified')",[id]);
 await q('select platform_set_admin($1,true)',[id]);return {id,session};
}
async function asActor(actor,fn,aal='aal2',role='authenticated'){
 await q("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[actor?.id??'',JSON.stringify({sub:actor?.id,session_id:actor?.session,aal,exp:Math.floor(Date.now()/1000)+600})]);
 await q(`set local role ${role}`);await q('savepoint request');
 try {const value=await fn();await q('release savepoint request');return value;}
 catch(e){await q('rollback to savepoint request');throw e;}
 finally {await q('reset role');await q("select set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{}',true)");}
}
const overview=days=>one('select platform_overview($1) data',[days??30]).then(r=>r.data);
const directory=(days=30,page=1,size=25,search='',filter='all',sort='newest')=>one('select platform_restaurants($1,$2,$3,$4,$5,$6) data',[days,page,size,search,filter,sort]).then(r=>r.data);
const detail=(id,days=30)=>one('select platform_restaurant_detail($1,$2) data',[id,days]).then(r=>r.data);
async function tenant(name,ready=true,verified=true){
 const r=uuid(),b=uuid(),u=uuid(),c=uuid();await q('insert into auth.users(id,email,email_confirmed_at) values($1,$2,$3)',[u,name+'@example.invalid',verified?'2020-01-01':null]);
 await q("insert into restaurants(id,owner_id,name,slug,created_at) values($1::uuid,$2,$3,$1::uuid::text,now()-interval '100 days')",[r,u,name]);
 await q("insert into branches(id,restaurant_id,slug,name) values($1,$2,'main','Main')",[b,r]);
 if(ready){await q("insert into menu_categories(id,restaurant_id,name) values($1,$2,'Drinks')",[c,r]);await q("insert into menu_items(restaurant_id,category_id,name,base_price) values($1,$2,'Latte',5)",[r,c]);}
 return {r,b,u};
}
async function order(t,status='pending',when="now()-interval '1 second'",value=5){
 return (await one(`insert into orders(restaurant_id,branch_id,status,created_at,total_amount) values($1,$2,$3,${when},$4) returning id`,[t.r,t.b,status,value])).id;
}
test('3.5.2 zero tenants: honest zero buckets, no false rates',async()=>{
 const a=await adminFixture(),x=await asActor(a,()=>overview(7));assert.equal(x.total_restaurants,0);assert.equal(x.orders,0);assert.equal(x.activation_rate,null);assert.equal(x.trend.length,7);assert.ok(x.trend.every(d=>d.orders===0&&d.signups===0&&d.active_restaurants===0));
 const dir=await asActor(a,()=>directory());assert.equal(dir.total,0);assert.deepEqual(dir.rows,[]);
});
test('3.5.2 multibranch distinct tenants, readiness without tables, cancellations and legacy orders',async()=>{
 const a=await adminFixture(),oneT=await tenant('Alpha'),two=await tenant('Beta',false,false),three=await tenant('Gamma');
 await q("insert into branches(restaurant_id,slug,name) values($1,'second','Second')",[oneT.r]);
 await order(oneT);await order(oneT,'served');await order(oneT,'cancelled');await order(two,'cancelled');
 const x=await asActor(a,()=>overview());assert.equal(x.total_restaurants,3);assert.equal(x.active_restaurants,1);assert.equal(x.orders,4);assert.equal(x.cancelled_orders,2);assert.equal(x.needs_setup,1);assert.equal(x.activation_rate,33.33);assert.equal(x.average_orders_per_active,2);
 const d=await asActor(a,()=>detail(oneT.r));assert.equal(d.branches,2);assert.equal(d.ready,true);assert.equal(d.tables,0);assert.equal(d.menu_items,1);assert.equal(d.orders,3);assert.equal(d.order_value,10);assert.equal(d.currency,null);
 assert.equal((await asActor(a,()=>detail(two.r))).owner_email,null);
 assert.equal((await asActor(a,()=>detail(three.r))).readiness,'Ready for orders');
});
test('3.5.2 UTC start included/end excluded; historical activity and activation denominators',async()=>{
 const a=await adminFixture(),t=await tenant('Boundary'),fresh=await tenant('Fresh');
 await q("update restaurants set created_at=now()-interval '2 seconds' where id=$1",[fresh.r]);
 await order(t,'served',"date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'");
 await order(t,'served',"(date_trunc('day',now() at time zone 'UTC') at time zone 'UTC')-interval '1 microsecond'");
 await order(t,'pending','now()'); // reporting end is transaction now(), exclusive
 await order(fresh);const x=await asActor(a,()=>overview(1));
 assert.equal(x.orders,2);assert.equal(x.active_restaurants,2);assert.equal(x.repeat_active,1);assert.equal(x.activated_restaurants,2);assert.equal(x.activation_rate,100);assert.equal(x.new_restaurants,1);assert.equal(x.new_cohort_activated,1);
 assert.equal(x.trend.reduce((s,d)=>s+d.orders,0),2);
});
test('3.5.2 history readiness and centralized filters: inactive and ready are not disabled status',async()=>{
 const a=await adminFixture(),old=await tenant('Old'),fresh=await tenant('New'),incomplete=await tenant('Incomplete',false);
 await order(old,'completed',"now()-interval '60 days'");
 assert.equal((await asActor(a,()=>detail(old.r))).readiness,'Inactive after prior activity');
 assert.equal((await asActor(a,()=>directory(30,1,25,'','inactive'))).total,3);
 assert.equal((await asActor(a,()=>directory(30,1,25,'','ready'))).total,2);
 assert.equal((await asActor(a,()=>directory(30,1,25,'','setup'))).rows[0].id,incomplete.r);
 assert.equal((await asActor(a,()=>directory(30,1,25,'new@example.invalid'))).rows[0].id,fresh.r);
 assert.equal((await asActor(a,()=>directory(30,1,25,'%'))).total,0); // literal search, not wildcard
});
test('3.5.2 paid receipts distinct from order value, unknown-source legacy and visits remain accurate',async()=>{
 const a=await adminFixture(),t=await tenant('Payments');await order(t,'served');
 await q("insert into restaurant_tables(branch_id,label,status) values($1,'1','available'),($1,'2','available')",[t.b]);
 const rows=(await q('select id from restaurant_tables where branch_id=$1 order by label',[t.b])).rows;
 await q("insert into table_sessions(table_id) values($1)",[rows[0].id]);
 await q("insert into table_sessions(table_id) values($1)",[rows[1].id]);
 await q("update table_sessions set status='closed',closed_at=now(),closed_reason='abandoned_empty' where table_id=$1",[rows[1].id]);
 for(const [status,source,amount,confirmed] of [['paid','staff_reported',12.34,true],['pending','staff_reported',90,false],['failed','staff_reported',90,false],['paid',null,7,false]]) {
   await q("insert into payments(restaurant_id,method,status,amount,confirmation_source,created_at,confirmed_at) values($1,'cash',$2,$3,$4,now()-interval '1 second',case when $5 then now()-interval '1 second' end)",[t.r,status,amount,source,confirmed]);
 }
 const d=await asActor(a,()=>detail(t.r));assert.equal(d.staff_recorded_amount,12.34);assert.equal(d.staff_recorded_count,1);assert.equal(d.legacy_paid_count,1);assert.equal(d.fallback_timestamp_count,1);assert.equal(d.order_value,5);assert.equal(d.tables,2);assert.equal(d.active_visits,1);
 assert.equal((await asActor(a,()=>overview())).active_visits,1);
});
test('3.5.2 >1000 tenants: complete counts, page 21 and deterministic search/sort',async()=>{
 const a=await adminFixture();await q("insert into restaurants(owner_id,name,slug,created_at) select $1,'Tenant '||lpad(i::text,4,'0'),'tenant-'||i,now()-interval '1 second' from generate_series(1,1051) i",[a.id]);
 const dir=await asActor(a,()=>directory(30,21,50,'','all','name'));assert.equal(dir.total,1051);assert.equal(dir.rows.length,50);assert.equal(dir.rows[0].name,'Tenant 1001');
 assert.equal((await asActor(a,()=>directory(30,22,50))).rows.length,1);
 assert.equal((await asActor(a,()=>overview())).total_restaurants,1051);
 assert.equal((await asActor(a,()=>directory(30,1,25,'Tenant 1051'))).total,1);
 await assert.rejects(asActor(a,()=>directory(30,1,1000)),/Invalid directory/);
 await assert.rejects(asActor(a,()=>directory(365)),/Invalid reporting/);
});
test('3.5.2 every reporting RPC denies ordinary identities, missing MFA, revocation and forged target IDs',async()=>{
 const a=await adminFixture(),t=await tenant('Security');
 const calls=[()=>overview(),()=>directory(),()=>detail(t.r)];
 for(const call of calls){await assert.rejects(asActor(null,call,'aal1','anon'),/permission denied/);await assert.rejects(asActor({id:t.u,session:uuid()},call),/Platform access denied/);await assert.rejects(asActor(a,call,'aal1'),/Platform access denied/);}
 await q('select platform_set_admin($1,false)',[a.id]);for(const call of calls)await assert.rejects(asActor(a,call),/Platform access denied/);
 assert.equal((await one('select is_platform_admin() value')).value,false);
 await assert.rejects(asActor(a,()=>q('select * from platform_private.restaurant_facts(now(),now())')),/permission denied/);
});
test('3.5.2 directory sorts and recent/active filters use centralized period facts',async()=>{
 const a=await adminFixture(),z=await tenant('Zulu'),b=await tenant('Bravo'),c=await tenant('Alpha');
 await q("update restaurants set created_at=now()-interval '2 days' where id=$1",[z.r]);
 await q("update restaurants set created_at=now()-interval '50 days' where id=$1",[b.r]);
 await order(z,'pending',"now()-interval '1 day'");await order(z,'served',"now()-interval '2 days'");await order(b,'pending',"now()-interval '1 second'");
 const sorted=async sort=>(await asActor(a,()=>directory(30,1,25,'','all',sort))).rows.map(r=>r.id);
 assert.deepEqual(await sorted('newest'),[z.r,b.r,c.r]);assert.deepEqual(await sorted('oldest'),[c.r,b.r,z.r]);assert.deepEqual(await sorted('orders'),[z.r,b.r,c.r]);assert.deepEqual(await sorted('activity'),[b.r,z.r,c.r]);assert.deepEqual(await sorted('name'),[c.r,b.r,z.r]);
 assert.equal((await asActor(a,()=>directory(30,1,25,'','recent'))).total,1);assert.equal((await asActor(a,()=>directory(30,1,25,'','active'))).total,2);
});
async function freshAdmin(){const a=await adminFixture();await q("insert into auth.mfa_amr_claims(session_id,authentication_method) values($1,'totp')",[a.session]);return a;}
const change=(id,suspend=true,version=0,key=uuid(),reason='security_review',confirm=true)=>one('select platform_set_restaurant_account($1,$2,$3,$4,$5,$6) data',[id,suspend,reason,confirm,version,key]).then(r=>r.data);
test('3.5.3 safe suspension and reactivation: idempotent, separate settings, immutable history and stale action rejection',async()=>{
 const t=await tenant('Controlled'),a=await freshAdmin(),key=uuid();
 await asActor(a,async()=>{
  assert.equal((await change(t.r,true,0,key)).code,'changed');
  assert.equal((await change(t.r,true,0,key)).replayed,true);
  assert.equal((await change(t.r,true,1)).code,'unchanged');
  assert.equal((await change(t.r,false,0)).code,'stale_state');
  assert.equal((await change(t.r,false,1,key)).code,'request_conflict');
  assert.equal((await one('select restaurant_account_available($1) ok',[t.r])).ok,false);
  assert.equal((await directory()).rows.find(r=>r.id===t.r).account_status,'Suspended');
 });
 assert.equal((await one('select status from restaurants where id=$1',[t.r])).status,'active');
 assert.equal((await one("select count(*) n from platform_audit_logs where action='restaurant.suspended' and target_id=$1",[t.r])).n,1);
 await sqlReject(()=>order(t),/temporarily unavailable/);
 const table=uuid();await q("insert into restaurant_tables(id,branch_id,label) values($1,$2,'1')",[table,t.b]);
 await sqlReject(()=>q('select dining_join($1,$2,$3,$4)',[t.r,t.b,table,uuid()]),/temporarily unavailable/);
 await q("insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'owner')",[t.r,t.u]);
 await asActor({id:t.u,session:a.session},async()=>{await q("update restaurants set status='active' where id=$1",[t.r]);assert.equal((await one('select restaurant_account_available($1) ok',[t.r])).ok,false);});
 const other=await tenant('Unaffected');await order(other);
 await asActor(null,async()=>{assert.ok((await q('select id from menu_items')).rows.length>0);},'aal1','anon');
 await asActor(a,async()=>assert.equal((await change(t.r,false,1)).code,'changed'));
 await order(t);assert.equal((await one('select count(*) n from orders where restaurant_id=$1',[t.r])).n,1);
 assert.equal((await one('select version from platform_private.restaurant_controls where restaurant_id=$1',[t.r])).version,2);
});
async function sqlReject(fn,pattern){await q('savepoint denied_write');try{await assert.rejects(fn(),pattern);}finally{await q('rollback to savepoint denied_write');await q('release savepoint denied_write');}}
test('3.5.3 recent MFA, invalid input, non-admin, expired/revoked/forged identity all fail closed with safe denial telemetry',async()=>{
 const t=await tenant('Security'),a=await freshAdmin();
 await q("update auth.mfa_amr_claims set updated_at=now()-interval '11 minutes'");
 await asActor(a,async()=>assert.equal((await change(t.r)).code,'recent_mfa_required'));
 await q('update auth.mfa_amr_claims set updated_at=now()');
 await asActor(a,async()=>{
  assert.equal((await change(t.r,true,0,uuid(),'raw-secret-never-store')).code,'invalid_request');
  assert.equal((await change(t.r,true,0,uuid(),'security_review',false)).code,'invalid_request');
 });
 await asActor({id:t.u,session:a.session},async()=>assert.equal((await change(t.r)).code,'denied'));
 await asActor(a,async()=>assert.equal((await change(t.r)).code,'denied'),'aal1');
 await q("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[a.session]);
 await asActor(a,async()=>assert.equal((await change(t.r)).code,'denied'));
 await q('update auth.sessions set not_after=null where id=$1',[a.session]);await q('select platform_set_admin($1,false)',[a.id]);
 await asActor(a,async()=>assert.equal((await change(t.r)).code,'denied'));
 assert.equal((await one('select count(*) n from platform_private.restaurant_controls')).n,0);
 assert.equal((await one("select count(*) n from platform_audit_logs where to_jsonb(platform_audit_logs)::text like '%raw-secret-never-store%'")).n,0);
 assert.ok((await one("select count(*) n from platform_audit_logs where action='restaurant.control_denied' and result='denied'")).n>=6);
 await assert.rejects(asActor(null,()=>change(t.r),'aal1','anon'),/permission denied/);
});
test('3.5.3 open visits, unfinished work, ambiguous debt and pending receipts refuse suspension without touching lifecycle',async()=>{
 const a=await freshAdmin();
 for(const scenario of ['visit','unfinished','legacy_debt','pending']) {
  const t=await tenant(scenario);
  if(scenario==='visit'){const table=uuid();await q("insert into restaurant_tables(id,branch_id,label) values($1,$2,'1')",[table,t.b]);await q('select dining_join($1,$2,$3,$4)',[t.r,t.b,table,uuid()]);}
  if(scenario==='unfinished') await order(t,'pending');
  if(scenario==='legacy_debt') await order(t,'served');
  if(scenario==='pending')await q("insert into payments(restaurant_id,method,status,amount) values($1,'cash','pending',2)",[t.r]);
  await asActor(a,async()=>assert.equal((await change(t.r)).code,'unresolved_activity',scenario));
  assert.equal((await one('select restaurant_account_available($1) ok',[t.r])).ok,true);
 }
 assert.equal((await one('select count(*) n from platform_private.restaurant_controls')).n,0);
});
test('3.5.3 settled history and receipts preserved; failed success-audit insertion rolls back account change',async()=>{
 const t=await tenant('Paid'),a=await freshAdmin();const oid=await order(t,'served');
 await q("insert into payments(restaurant_id,order_id,method,status,amount,confirmation_source) values($1,$2,'cash','paid',5,'staff_reported')",[t.r,oid]);
 const before=await one('select to_jsonb(o) data from orders o where id=$1',[oid]);
 await db.exec(`create function platform_private.fail_success353() returns trigger language plpgsql as $$begin if new.action='restaurant.suspended' then raise exception 'audit offline';end if;return new;end$$;create trigger fail353 before insert on platform_audit_logs for each row execute function platform_private.fail_success353();`);
 await asActor(a,async()=>assert.equal((await change(t.r)).code,'operation_failed'));
 assert.equal((await one('select restaurant_account_available($1) ok',[t.r])).ok,true);
 assert.equal((await one("select count(*) n from platform_audit_logs where action='restaurant.control_failed' and result='failed'")).n,1);
 await q('drop trigger fail353 on platform_audit_logs');
 await asActor(a,async()=>assert.equal((await change(t.r)).code,'changed'));
 assert.deepEqual(await one('select to_jsonb(o) data from orders o where id=$1',[oid]),before);
 assert.equal((await one("select count(*) n from payments where restaurant_id=$1 and status='paid'",[t.r])).n,1);
 await sqlReject(()=>q("update platform_audit_logs set reason='tampered'"),/append-only/);
 await sqlReject(()=>q('delete from platform_audit_logs'),/append-only/);
 await sqlReject(()=>q('truncate platform_audit_logs'),/append-only/);
});
test('3.5.3 audit pagination/filtering, private ACLs and scoped legacy helpers preserve owner RLS',async()=>{
 const t=await tenant('Audit'),foreign=await tenant('Foreign'),a=await freshAdmin();
 await q("insert into restaurant_members(restaurant_id,user_id,role) values($1,$2,'owner')",[t.r,t.u]);
 await asActor(a,async()=>{
  for(let i=0;i<55;i++)await change(t.r,true,0,uuid(),'invalid');
  const p=await one('select platform_audit(2,50,null,null,$1,$2,$3) data',['restaurant.control_denied',t.r,a.id]);
  assert.equal(p.data.total,55);assert.equal(p.data.rows.length,5);assert.equal(new Set(p.data.rows.map(r=>r.request_id)).size,5);
  const empty=await one("select platform_audit(1,25,now()+interval '1 day',null,'',null,null) data");assert.equal(empty.data.total,0);
 });
 await asActor({id:t.u,session:a.session},async()=>{
  assert.equal((await one('select branch_restaurant_id($1) id',[t.b])).id,t.r);
  assert.equal((await one('select branch_restaurant_id($1) id',[foreign.b])).id,null);
  assert.equal((await one('select owns_storage_object_restaurant($1) ok',[t.r+'/image.png'])).ok,true);
  assert.equal((await one('select owns_storage_object_restaurant($1) ok',[foreign.r+'/image.png'])).ok,false);
  await sqlReject(()=>one('select platform_controls_summary()'),/not authorized|authorization required|Platform access denied/);
 });
 for(const sql of ['select * from platform_audit_logs','select * from platform_private.restaurant_controls','select platform_restaurant_control($1)','select platform_audit()']) {
  await assert.rejects(asActor({id:t.u,session:a.session},()=>q(sql,sql.includes('$1')?[t.r]:[])),/permission denied|not authorized|authorization required|Platform access denied/);
 }
 assert.equal((await one("select has_function_privilege('anon','handle_new_auth_user()','execute') ok")).ok,false);
 assert.equal((await one("select has_function_privilege('authenticated','handle_new_auth_user()','execute') ok")).ok,false);
 const owner=uuid();await q('insert into auth.users(id) values($1)',[owner]);assert.ok(await one('select id from profiles where id=$1',[owner]));
});
test('3.5.3 serialization: account retries, opposite actions and new-work boundary',async()=>{
 const a=await freshAdmin(),t=await tenant('Races'),key=uuid();
 if(!nativePool){
  await asActor(a,async()=>{assert.equal((await change(t.r,true,0,key)).code,'changed');assert.equal((await change(t.r,true,0,key)).replayed,true);assert.equal((await change(t.r,false,0)).code,'stale_state');});
  return;
 }
 // Commit isolated fixtures so genuinely independent connections can race.
 await q('commit');
 const connection=async()=>{const c=await nativePool.connect();await c.query('begin');await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[a.id,JSON.stringify({sub:a.id,session_id:a.session,aal:'aal2',exp:Math.floor(Date.now()/1000)+600})]);await c.query('set local role authenticated');return c;};
 const run=async(id,suspend,version,request=uuid())=>{const c=await connection();try{const r=await c.query("select platform_set_restaurant_account($1,$2,'security_review',true,$3,$4) data",[id,suspend,version,request]);await c.query('commit');return r.rows[0].data;}catch(e){await c.query('rollback');throw e;}finally{c.release();}};
 const results=await Promise.all([run(t.r,true,0,key),run(t.r,true,0,key)]);assert.ok(results.some(r=>r.replayed));
 assert.equal((await one("select count(*) n from platform_audit_logs where action='restaurant.suspended' and target_id=$1",[t.r])).n,1);
 const opposite=await Promise.all([run(t.r,false,1),run(t.r,true,1)]);assert.ok(opposite.some(r=>r.code==='changed'));
 assert.equal((await one('select suspended from platform_private.restaurant_controls where restaurant_id=$1',[t.r])).suspended,false);
 const first=await tenant('OrderFirst'),writer=await nativePool.connect();await writer.query('begin');await writer.query("insert into orders(restaurant_id,branch_id,status,total_amount) values($1,$2,'pending',5)",[first.r,first.b]);
 const suspension=run(first.r,true,0);await writer.query('commit');writer.release();assert.equal((await suspension).code,'unresolved_activity');
 const second=await tenant('SuspensionFirst'),admin=await connection();await admin.query("select platform_set_restaurant_account($1,true,'security_review',true,0,$2)",[second.r,uuid()]);
 const newOrder=nativePool.query("insert into orders(restaurant_id,branch_id,status,total_amount) values($1,$2,'pending',5)",[second.r,second.b]);
 const denied=assert.rejects(newOrder,/temporarily unavailable/);await admin.query('commit');admin.release();await denied;
 await q('begin');
});
