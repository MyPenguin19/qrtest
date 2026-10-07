// Run: node --test tests/staff-orders.test.cjs
// Executes the real TS server actions with in-memory Supabase/Next adapters.
// This does not replace a browser/Postgres integration test.
/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable -- CommonJS test adapter loads isolated transpiled modules. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { createRequire } = require('node:module');

function harness() {
  const db = {
    restaurants: [{ id: 'A', slug: 'a', name: 'A', status: 'active', tax_percent: 0, service_charge_percent: 0 }, { id: 'B', slug: 'b', status: 'active' }],
    branches: [{ id: 'branch-a', restaurant_id: 'A', slug: 'main', is_active: true }],
    restaurant_tables: [{ id: 'table-1', branch_id: 'branch-a', label: '1', status: 'available' }],
    menu_items: [{ id: 'item-1', restaurant_id: 'A', name: 'Tea', base_price: 10, is_available: true, menu_variants: [], menu_addons: [] }],
    restaurant_members: [{ user_id: 'owner-a', role: 'owner', restaurants: {id: 'A', name: 'A', slug: 'a'} }],
    platform_admins: [{user_id: 'admin'}],
    restaurant_themes: [], menu_categories: [], staff: [], table_sessions: [], orders: [], order_items: [], order_status_history: [], customers: [], bills: [], payments: [], waiter_requests: [],
  };
  const jar = new Map();
  const state = { user: {id: 'owner-a'}, writes: [], revalidated: [], failUpdate: false, id: 0 };
  function from(table) {
    const filters = []; let op = 'select', values, single = false, selection;
    const query = {
      select(columns) { selection = columns; return this; },
      eq(k,v) { filters.push(r => r[k] === v); return this; },
      is(k,v) { filters.push(r => r[k] === v); return this; },
      neq(k,v) { filters.push(r => r[k] !== v); return this; },
      in(k,v) { filters.push(r => v.includes(r[k])); return this; },
      not(k,kind,v) { assert.equal(kind, 'in'); filters.push(r => !v.slice(1,-1).split(',').includes(r[k])); return this; },
      order() { return this; }, limit() { return this; },
      insert(v) { op = 'insert'; values = v; return this; },
      upsert(v) { op = 'upsert'; values = v; return this; },
      update(v) { op = 'update'; values = v; return this; },
      single() { single = true; return this; }, maybeSingle() { single = true; return this; },
      then(resolve,reject) {
        try {
          let rows = db[table].filter(r => filters.every(f => f(r)));
          if (op === 'update' && state.failUpdate && table === 'orders') return Promise.resolve({data:null,error:{message:'failed'}}).then(resolve,reject);
          if (op === 'insert' || op === 'upsert') {
            rows = (Array.isArray(values) ? values : [values]).map(v => {
              const row = {id: `id-${++state.id}`, ...v};
              if(table==='staff') row.is_active = true;
              if(table==='orders') { row.status ??= 'pending'; row.order_number = state.id; row.created_at = '2026-10-06T12:00:00Z'; }
              if(table==='table_sessions') { row.status ??= 'open'; row.closed_at ??= null; }
              db[table].push(row); return row;
            });
          } else if(op==='update') rows.forEach(r=>Object.assign(r,values));
          if(op!=='select') state.writes.push({table,op,values:structuredClone(values)});
          if(single && rows.length > 1) return Promise.resolve({data:null,error:{message:'Multiple rows'}}).then(resolve,reject);
          let data = structuredClone(rows);
          if(table==='restaurant_tables' && selection?.includes('branches(')) data=data.map(r=>({...r,branches:db.branches.find(b=>b.id===r.branch_id)}));
          if (table === 'orders' && selection?.includes('order_items(')) data = data.map(r => ({...r, order_items: db.order_items.filter(i=>i.order_id===r.id), table_sessions:{restaurant_tables:{label:'1'}}}));
          return Promise.resolve({data:single?(data[0]??null):data,error:null}).then(resolve,reject);
        } catch(e) { return Promise.reject(e).then(resolve,reject); }
      }
    }; return query;
  }
  const client = {from, rpc:async(name,args)=>{assert.equal(name,'dining_refresh_table');const session=db.table_sessions.find(s=>s.id===args.p_session);if(session?.status==='open')db.restaurant_tables.find(t=>t.id===session.table_id).status='occupied';return {error:null};}, auth:{getUser:async()=>({data:{user:state.user}})}};
  const cache = new Map();
  function load(relative) {
    const filename = path.resolve(__dirname,'..',relative);
    if(cache.has(filename)) return cache.get(filename).exports;
    const module = {exports:{}}; cache.set(filename,module);
    const native = createRequire(filename);
    function customRequire(id) {
      if(id==='next/headers') return {cookies:async()=>({get:n=>jar.has(n)?{value:jar.get(n)}:undefined,set:(n,v)=>jar.set(n,v),delete:n=>jar.delete(n)})};
      if(id==='next/navigation') return {redirect:p=>{throw new Error('REDIRECT '+p);},notFound:()=>{throw new Error('NOT_FOUND');}};
      if(id==='next/cache') return {revalidatePath:p=>state.revalidated.push(p)};
      if(id==='@/lib/dining-tables') return {getDiningTables:async()=>[]};
      if(id==='@/lib/supabase/admin') return {createAdminClient:()=>client};
      if(id==='@/lib/supabase/server') return {createClient:async()=>client};
      if(id==='next/link'||id.startsWith('@/components/')) return new Proxy({default:'Link'}, {get:(o,k)=>o[k]??String(k)});
      if(id.startsWith('@/')) {
        const file = 'src/'+id.slice(2);
        return load(file+(fs.existsSync(path.resolve(__dirname,'..',file+'.ts'))?'.ts':'.tsx'));
      }
      return native(id);
    }
    const source=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    new Function('require','module','exports','process',source)(customRequire,module,module.exports,{env:{STAFF_SESSION_SECRET:'test-only-session-secret'}});
    return module.exports;
  }
  async function login(role, restaurant='A', branch='branch-a') {
    const id='staff-'+role+'-'+restaurant;
    db.staff.push({id,name:id,role,restaurant_id:restaurant,branch_id:branch,is_active:true,pin_hash:load('src/lib/staff-pin.ts').hashPin('1234')});
    const form=new FormData();form.set('restaurantSlug',restaurant.toLowerCase());form.set('role',role);form.set('pin','1234');
    await assert.rejects(load('src/app/actions/staff-auth.ts').staffLogin({error:null},form),/REDIRECT \/staff\/orders/);
    return id;
  }
  return {db,state,jar,load,login};
}

for(const role of ['waiter','kitchen','cashier']) test(`${role}: owner creates staff, one login, seeded order -> Preparing -> Ready -> Served, session stays open`,async()=>{
  const h=harness(), form=new FormData();
  for(const [k,v] of Object.entries({name:'Pat',branchId:'branch-a',role,pin:'1234'})) form.set(k,v);
  assert.equal((await h.load('src/app/actions/staff.ts').addStaff({error:null},form)).error,null);
  const staff=h.db.staff[0];
  const login=new FormData();for(const [k,v] of Object.entries({restaurantSlug:'a',role,pin:'1234'}))login.set(k,v);
  await assert.rejects(h.load('src/app/actions/staff-auth.ts').staffLogin({error:null},login),/REDIRECT \/staff\/orders/);
  const cookie=h.jar.get('thaliq_staff_session');
  // Order creation now runs in PostgreSQL; see dining-lifecycle.test.cjs.
  h.db.table_sessions.push({id:'session',table_id:'table-1',status:'open',closed_at:null});
  h.db.orders.push({id:'order',restaurant_id:'A',branch_id:'branch-a',table_session_id:'session',status:'pending',total_amount:20});
  h.db.order_items.push({id:'line',order_id:'order',item_name:'Tea',quantity:2});
  h.db.order_status_history.push({order_id:'order',status:'pending'});
  h.db.customers.push({name:'Guest'});
  const order=h.db.orders[0], original=structuredClone(order);
  h.db.bills.push({id:'bill',restaurant_id:'A',table_session_id:order.table_session_id,status:'open',total_amount:20});
  const board=await h.load('src/app/staff/orders/page.tsx').default();
  assert.match(JSON.stringify(board),new RegExp(order.id));
  const ops=h.load('src/app/actions/staff-ops.ts');
  await ops.advanceOrderStatus(order.id,'pending');assert.equal(order.status,'preparing');
  await ops.advanceOrderStatus(order.id,'preparing');assert.equal(order.status,'ready');
  await ops.markOrderServed(order.id);assert.equal(order.status,'served');
  assert.deepEqual({...order,status:original.status},original);
  assert.equal(h.db.table_sessions[0].status,'open');assert.equal(h.db.table_sessions[0].closed_at,null);
  assert.equal(h.db.restaurant_tables[0].status,'occupied');assert.equal(h.db.order_items[0].quantity,2);
  assert.equal(h.db.customers[0].name,'Guest');assert.equal(h.db.bills[0].status,'open');assert.equal(h.db.payments.length,0);
  assert.deepEqual(h.db.order_status_history.map(r=>r.status),['pending','preparing','ready','served']);
  assert.ok(h.db.order_status_history.slice(1).every(r=>r.changed_by_staff_id===staff.id));
  assert.equal(h.jar.get('thaliq_staff_session'),cookie);
});

test('other restaurant and other branch cannot view or mutate orders',async()=>{
  const h=harness();await h.login('kitchen','B','branch-b');
  h.db.orders.push({id:'a-order',restaurant_id:'A',branch_id:'branch-a',status:'pending'});
  h.db.orders.push({id:'b-other-branch',restaurant_id:'B',branch_id:'branch-other',status:'ready'});
  const ops=h.load('src/app/actions/staff-ops.ts');
  await ops.advanceOrderStatus('a-order','pending');await ops.markOrderServed('b-other-branch');
  assert.deepEqual(h.state.writes,[]);
  const board=JSON.stringify(await h.load('src/app/staff/orders/page.tsx').default());
  assert.ok(!board.includes('a-order')&&!board.includes('b-other-branch'));
});

test('stale/repeated actions cannot skip stages or duplicate history; legacy accepted still works',async()=>{
  const h=harness();await h.login('cashier');
  const order={id:'order',restaurant_id:'A',branch_id:'branch-a',status:'accepted'};h.db.orders.push(order);
  const ops=h.load('src/app/actions/staff-ops.ts');
  await ops.markOrderServed('order');assert.equal(order.status,'accepted');
  await Promise.all([ops.advanceOrderStatus('order','accepted'),ops.advanceOrderStatus('order','accepted')]);
  assert.equal(order.status,'preparing');assert.equal(h.db.order_status_history.length,1);
  await ops.advanceOrderStatus('order','accepted');assert.equal(order.status,'preparing');
  await ops.advanceOrderStatus('order','preparing');await ops.markOrderServed('order');await ops.markOrderServed('order');
  assert.deepEqual(h.db.order_status_history.map(r=>r.status),['preparing','ready','served']);
});

test('missing, tampered, disabled, or reassigned staff sessions are rejected',async()=>{
  const h=harness(), guard=h.load('src/lib/staff-session.ts');
  await assert.rejects(guard.requireStaffSession(),/REDIRECT \/staff/);
  await h.login('waiter');const token=h.jar.get('thaliq_staff_session');
  h.jar.set('thaliq_staff_session',token+'x');await assert.rejects(guard.requireStaffSession(),/REDIRECT \/staff/);
  h.jar.set('thaliq_staff_session',token);h.db.staff[0].is_active=false;
  await assert.rejects(guard.requireStaffSession(),/REDIRECT \/staff/);
  h.db.staff[0].is_active=true;h.db.staff[0].branch_id='other';await assert.rejects(guard.requireStaffSession(),/REDIRECT \/staff/);
});

test('non-cashier staff cannot confirm payments',async()=>{
  const h=harness();await h.login('kitchen');
  await assert.rejects(h.load('src/app/actions/staff-ops.ts').markBillPaid('bill','cash'),/REDIRECT \/staff/);
  assert.equal(h.db.payments.length,0);
});

test('staff cookie does not grant owner/admin access; existing owner/admin guards still work',async()=>{
  const h=harness();await h.login('waiter');h.state.user=null;
  const owner=h.load('src/lib/restaurant.ts'),admin=h.load('src/lib/platform-admin.ts');
  await assert.rejects(owner.requireCurrentRestaurant(),/REDIRECT \/login/);
  await assert.rejects(admin.requirePlatformAdmin(),/REDIRECT \/login/);
  h.state.user={id:'owner-a'};assert.equal((await owner.requireCurrentRestaurant()).restaurantId,'A');
  await assert.rejects(admin.requirePlatformAdmin(),/REDIRECT \/dashboard/);
  h.state.user={id:'admin'};assert.equal((await admin.requirePlatformAdmin()).userId,'admin');
});

test('failed order update leaves history unchanged and reports failure',async()=>{
  const h=harness();await h.login('waiter');h.db.orders.push({id:'order',restaurant_id:'A',branch_id:'branch-a',status:'pending'});h.state.failUpdate=true;
  await assert.rejects(h.load('src/app/actions/staff-ops.ts').advanceOrderStatus('order','pending'),/Could not update/);
  assert.equal(h.db.orders[0].status,'pending');assert.equal(h.db.order_status_history.length,0);
});

test('serving preserves a requested bill/session and cannot advance completed or cancelled orders',async()=>{
  const h=harness();await h.login('kitchen');
  h.db.table_sessions.push({id:'session',table_id:'table-1',status:'bill_requested',closed_at:null});
  h.db.restaurant_tables[0].status='bill_requested';
  h.db.bills.push({id:'bill',table_session_id:'session',status:'requested',total_amount:30});
  h.db.orders.push({id:'order',restaurant_id:'A',branch_id:'branch-a',table_session_id:'session',status:'ready'});
  const before=structuredClone({sessions:h.db.table_sessions,bills:h.db.bills,tables:h.db.restaurant_tables});
  const ops=h.load('src/app/actions/staff-ops.ts');await ops.markOrderServed('order');
  assert.deepEqual({sessions:h.db.table_sessions,bills:h.db.bills,tables:h.db.restaurant_tables},before);
  for(const status of ['completed','cancelled']) {
    h.db.orders[0].status=status;await ops.advanceOrderStatus('order',status);await ops.markOrderServed('order');assert.equal(h.db.orders[0].status,status);
  }
  assert.equal(h.db.order_status_history.length,1);
});

test('restaurant-wide staff still cannot read or change another restaurant orders',async()=>{
  const h=harness();await h.login('waiter','A',null);
  h.db.orders.push({id:'foreign-ready',restaurant_id:'B',branch_id:'branch-b',status:'ready'});
  h.db.orders.push({id:'foreign-new',restaurant_id:'B',branch_id:'branch-b',status:'pending'});
  const ops=h.load('src/app/actions/staff-ops.ts');await ops.markOrderServed('foreign-ready');await ops.advanceOrderStatus('foreign-new','pending');
  assert.deepEqual(h.state.writes,[]);
  const board=JSON.stringify(await h.load('src/app/staff/orders/page.tsx').default());assert.ok(!board.includes('foreign-'));
  h.db.waiter_requests.push({id:'foreign-request',branch_id:'branch-b',resolved_at:null});
  h.db.waiter_requests.push({id:'own-request',branch_id:'branch-a',resolved_at:null});
  const waiter=JSON.stringify(await h.load('src/app/staff/waiter/page.tsx').default());
  assert.ok(!waiter.includes('foreign-request'));assert.ok(waiter.includes('own-request'));
});


test('signed customer references reject forgery and bind restaurant, branch, table and visit',()=>{
  const h=harness(),tabs=h.load('src/lib/customer-tab.ts');
  const identity={restaurantId:'A',branchId:'branch-a',tableId:'table-1',sessionId:'visit',customerSessionId:'browser'};
  const token=tabs.signCustomerTab(identity);assert.deepEqual(tabs.verifyCustomerTab(token),identity);
  assert.equal(tabs.verifyCustomerTab(token+'x'),null);assert.equal(tabs.verifyCustomerTab('bad'),null);
});
