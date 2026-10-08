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
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),status text);
    create function auth.jwt() returns jsonb language sql as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;`);
  for(const name of ['20260814000001_extensions_and_enums.sql','20260814000002_core_schema.sql','20260814000003_rls_policies.sql','20261007213147_dining_lifecycle_states.sql','20261007213159_atomic_dining_lifecycle.sql','20261007213210_optional_customer_payment.sql','20261008010236_close_confirmed_external_payment.sql','20261008012009_unified_staff_role.sql','20261008012015_secure_staff_console.sql','20261008111047_platform_admin_foundation.sql','20261008212741_platform_intelligence.sql']) {
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
