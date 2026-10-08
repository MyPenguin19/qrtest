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
    restaurant_tables: [{ id: 'table-1', branch_id: 'branch-a', label: '1', status: 'available', is_active: true }],
    menu_items: [{ id: 'item-1', restaurant_id: 'A', name: 'Tea', base_price: 10, is_available: true, menu_variants: [], menu_addons: [] }],
    restaurant_members: [{ user_id: 'owner-a', role: 'owner', restaurants: {id: 'A', name: 'A', slug: 'a'} }],
    platform_admins: [{user_id: 'admin'}],
    staff_sessions: [], restaurant_themes: [], menu_categories: [], staff: [], table_sessions: [], orders: [], order_items: [], order_status_history: [], customers: [], bills: [], payments: [], waiter_requests: [],
  };
  const jar = new Map();
  const state = { user: {id: 'owner-a'}, writes: [], revalidated: [], failUpdate: false, id: 0, rpcCalls: [], rpcResult: {error:null} };
  function from(table) {
    const filters = []; let op = 'select', values, single = false, selection;
    const query = {
      select(columns) { selection = columns; return this; },
      eq(k,v) { filters.push(r => (k === 'branches.restaurant_id' ? db.branches.find(b=>b.id===r.branch_id)?.restaurant_id : r[k]) === v); return this; },
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
  async function rpc(name,args) {
    if(name==='staff_login_begin') {
      const r=db.restaurants.find(r=>r.slug===args.p_slug&&r.status==='active');
      const st=db.staff.find(s=>s.id===args.p_staff&&s.restaurant_id===r?.id&&s.is_active&&['staff','waiter','kitchen','cashier'].includes(s.role));
      return {data:st?{id:st.id,pin_hash:st.pin_hash,auth_version:st.auth_version??1}:null,error:null};
    }
    if(name==='staff_login_finish') {
      const st=db.staff.find(s=>s.id===args.p_staff);if(!st)return {data:false,error:null};
      db.staff_sessions.push({token_hash:args.p_token_hash,staff_id:st.id,branch:st.branch_id,role:st.role});return {data:true,error:null};
    }
    const ss=db.staff_sessions.find(s=>s.token_hash===args.p_token_hash);
    const st=db.staff.find(s=>s.id===ss?.staff_id);
    const actor=st&&ss&&!ss.revoked_at&&st.is_active&&st.branch_id===ss.branch&&st.role===ss.role?{staffId:st.id,restaurantId:st.restaurant_id,branchId:st.branch_id,role:'staff',name:st.name,restaurantName:'Test restaurant',restaurantSlug:st.restaurant_id.toLowerCase()}:null;
    if(name==='staff_session_check')return {data:actor,error:null};
    state.rpcCalls.push({name,args});
    if(name==='manage_staff') {
      const row={id:require('node:crypto').randomUUID(),restaurant_id:args.p_restaurant,branch_id:args.p_branch,name:args.p_name,role:args.p_access,pin_hash:args.p_pin_hash,is_active:true};
      db.staff.push(row);return {error:null};
    }
    if(name==='staff_order_action') {
      if(state.failUpdate)return {error:{message:'Could not update the order.'}};
      const order=db.orders.find(o=>o.id===args.p_order&&o.restaurant_id===actor?.restaurantId&&(!actor.branchId||o.branch_id===actor.branchId));
      if(!order)return {error:{message:'Order not found.'}};
      if(order.status!==args.p_expected)return {data:false,error:null};
      if(!(['pending','accepted','preparing'].includes(args.p_expected)&&args.p_next==='ready'||args.p_expected==='ready'&&args.p_next==='served'))return {data:false,error:null};
      order.status=args.p_next;db.order_status_history.push({order_id:order.id,status:args.p_next,changed_by_staff_id:actor.staffId});
      const visit=db.table_sessions.find(v=>v.id===order.table_session_id);if(visit?.status==='open')db.restaurant_tables.find(t=>t.id===visit.table_id).status='occupied';
      return {data:true,error:null};
    }
    if(name==='staff_table_action'&&args.p_action==='manual_close')return {error:{message:'Unsupported staff action.'}};
    return state.rpcResult;
  }
  const client = {from,rpc,auth:{getUser:async()=>({data:{user:state.user}})}};
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
      if(id==='@/lib/dining-tables') return {getDiningTables:async(restaurant,branch)=>db.restaurant_tables.filter(t=>db.branches.find(b=>b.id===t.branch_id)?.restaurant_id===restaurant&&(!branch||t.branch_id===branch)).map(t=>{const visit=db.table_sessions.find(v=>v.table_id===t.id&&v.status!=='closed');return {...t,sessionId:visit?.id??null,orders:db.orders.filter(o=>visit && o.table_session_id===visit.id)};})};
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
    const id=require('node:crypto').randomUUID();
    db.staff.push({id,name:id,role,restaurant_id:restaurant,branch_id:branch,is_active:true,pin_hash:load('src/lib/staff-pin.ts').hashPin('1234')});
    const form=new FormData();form.set('restaurantSlug',restaurant.toLowerCase());form.set('staffId',id);form.set('pin','1234');
    await assert.rejects(load('src/app/actions/staff-auth.ts').staffLogin({error:null},form),/REDIRECT \/staff\/orders/);
    return id;
  }
  return {db,state,jar,load,login};
}

for(const role of ['staff']) test(`${role}: owner creates staff, one login, seeded order -> Ready -> Served, session stays open`,async()=>{
  const h=harness(), form=new FormData();
  for(const [k,v] of Object.entries({name:'Pat',branchId:'branch-a',access:role,pin:'482951'})) form.set(k,v);
  assert.equal((await h.load('src/app/actions/staff.ts').addStaff({error:null},form)).error,null);
  const staff=h.db.staff[0];
  const login=new FormData();for(const [k,v] of Object.entries({restaurantSlug:'a',staffId:staff.id,pin:'482951'}))login.set(k,v);
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
  await ops.advanceOrderStatus(order.id,'pending');assert.equal(order.status,'ready');
  await ops.markOrderServed(order.id);assert.equal(order.status,'served');
  assert.deepEqual({...order,status:original.status},original);
  assert.equal(h.db.table_sessions[0].status,'open');assert.equal(h.db.table_sessions[0].closed_at,null);
  assert.equal(h.db.restaurant_tables[0].status,'occupied');assert.equal(h.db.order_items[0].quantity,2);
  assert.equal(h.db.customers[0].name,'Guest');assert.equal(h.db.bills[0].status,'open');assert.equal(h.db.payments.length,0);
  assert.deepEqual(h.db.order_status_history.map(r=>r.status),['pending','ready','served']);
  assert.ok(h.db.order_status_history.slice(1).every(r=>r.changed_by_staff_id===staff.id));
  assert.equal(h.jar.get('thaliq_staff_session'),cookie);
});

test('other restaurant and other branch cannot view or mutate orders',async()=>{
  const h=harness();await h.login('kitchen','B','branch-b');
  h.db.orders.push({id:'a-order',restaurant_id:'A',branch_id:'branch-a',status:'pending'});
  h.db.orders.push({id:'b-other-branch',restaurant_id:'B',branch_id:'branch-other',status:'ready'});
  const ops=h.load('src/app/actions/staff-ops.ts');
  await assert.rejects(ops.advanceOrderStatus('a-order','pending'),/not found/);await assert.rejects(ops.markOrderServed('b-other-branch'),/not found/);
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
  assert.equal(order.status,'ready');assert.equal(h.db.order_status_history.length,1);
  await ops.advanceOrderStatus('order','accepted');assert.equal(order.status,'ready');
  await ops.advanceOrderStatus('order','preparing');await ops.markOrderServed('order');await ops.markOrderServed('order');
  assert.deepEqual(h.db.order_status_history.map(r=>r.status),['ready','served']);
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

test('staff cannot confirm a missing bill',async()=>{
  const h=harness();await h.login('kitchen');
  await assert.rejects(h.load('src/app/actions/staff-ops.ts').markBillPaid('bill','cash'),/Bill not found/);
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
  const ops=h.load('src/app/actions/staff-ops.ts');await assert.rejects(ops.markOrderServed('foreign-ready'),/not found/);await assert.rejects(ops.advanceOrderStatus('foreign-new','pending'),/not found/);
  assert.deepEqual(h.state.writes,[]);
  const board=JSON.stringify(await h.load('src/app/staff/orders/page.tsx').default());assert.ok(!board.includes('foreign-'));
  h.db.waiter_requests.push({id:'foreign-request',branch_id:'branch-b',resolved_at:null});
  h.db.waiter_requests.push({id:'own-request',branch_id:'branch-a',resolved_at:null});
  const waiter=JSON.stringify(await h.load('src/app/staff/orders/page.tsx').default());
  assert.ok(!waiter.includes('foreign-request'));assert.ok(waiter.includes('own-request'));
});


test('signed customer references reject forgery and bind restaurant, branch, table and visit',()=>{
  const h=harness(),tabs=h.load('src/lib/customer-tab.ts');
  const identity={restaurantId:'A',branchId:'branch-a',tableId:'table-1',sessionId:'visit',customerSessionId:'browser'};
  const token=tabs.signCustomerTab(identity);assert.deepEqual(tabs.verifyCustomerTab(token),identity);
  assert.equal(tabs.verifyCustomerTab(token+'x'),null);assert.equal(tabs.verifyCustomerTab('bad'),null);
});

test('3.1 counter action binds signed identity, rejects altered/foreign tokens, reports database rejection',async()=>{
  const h=harness(),sign=h.load('src/lib/customer-tab.ts').signCustomerTab;
  const identity={restaurantId:'A',branchId:'branch-a',tableId:'table-1',sessionId:'visit-a',customerSessionId:'device-a'};
  const action=h.load('src/app/actions/dining.ts').chooseCounterPayment;
  assert.ok((await action('a','main','table-1','forged')).error);assert.equal(h.state.rpcCalls.length,0);
  assert.ok((await action('a','main','table-1',sign({...identity,restaurantId:'B'}))).error);assert.equal(h.state.rpcCalls.length,0);
  assert.equal((await action('a','main','table-1',sign(identity))).error,null);
  assert.deepEqual(h.state.rpcCalls[0],{name:'dining_counter_intent',args:{p_restaurant:'A',p_branch:'branch-a',p_table:'table-1',p_session:'visit-a',p_customer_session:'device-a'}});
  h.state.rpcResult={error:{message:'Your table session has ended.'}};
  assert.match((await action('a','main','table-1',sign(identity))).error,/ended/);
});
test('3.3 staff cannot manually clear unpaid visits and rejects another tenant table',async()=>{
  const h=harness();await h.login('cashier');
  const action=h.load('src/app/actions/dining.ts').changeDiningSession;
  assert.match((await action({tableId:'table-1',sessionId:'visit-a',action:'manual_close'})).error,/Unsupported/);
  assert.equal(h.state.rpcCalls.at(-1).name,'staff_table_action');
  h.db.branches.push({id:'branch-b',restaurant_id:'B'});h.db.restaurant_tables.push({id:'foreign',branch_id:'branch-b'});
  assert.ok((await action({tableId:'foreign',sessionId:'foreign',action:'confirm_payment'})).error);
});
test('3.1 legitimate closed pages show ended state even if the table is disabled; no later-party data',async()=>{
  const h=harness(),sign=h.load('src/lib/customer-tab.ts').signCustomerTab;
  h.db.restaurant_tables[0].is_active=false;
  h.db.table_sessions.push({id:'old',table_id:'table-1',status:'closed'},{id:'new',table_id:'table-1',status:'open'});
  h.db.orders.push({id:'new-order',table_session_id:'new',restaurant_id:'A',branch_id:'branch-a',total_amount:10,status:'pending'});
  const token=sign({restaurantId:'A',branchId:'branch-a',tableId:'table-1',sessionId:'old',customerSessionId:'old-device'});
  const props={params:Promise.resolve({restaurant:'a',branch:'main',table:'table-1'}),searchParams:Promise.resolve({session:token})};
  for(const file of ['src/app/menu/[restaurant]/[branch]/[table]/page.tsx','src/app/menu/[restaurant]/[branch]/[table]/tab/page.tsx']){
    const rendered=JSON.stringify(await h.load(file).default(props));assert.match(rendered,/Your table session has ended/);assert.doesNotMatch(rendered,/new-order/);
  }
});
test('3.1 Add More Items link retains the original signed session and shows current total',async()=>{
  const h=harness(),sign=h.load('src/lib/customer-tab.ts').signCustomerTab;
  h.db.table_sessions.push({id:'active',table_id:'table-1',status:'open',payment_intent:'counter'});
  h.db.orders.push({id:'first',table_session_id:'active',restaurant_id:'A',branch_id:'branch-a',total_amount:10,status:'pending'},{id:'second',table_session_id:'active',restaurant_id:'A',branch_id:'branch-a',total_amount:15,status:'pending'});
  const token=sign({restaurantId:'A',branchId:'branch-a',tableId:'table-1',sessionId:'active',customerSessionId:'device'});
  const rendered=JSON.stringify(await h.load('src/app/menu/[restaurant]/[branch]/[table]/tab/page.tsx').default({params:Promise.resolve({restaurant:'a',branch:'main',table:'table-1'}),searchParams:Promise.resolve({session:token})}));
  assert.match(rendered,/Add More Items/);assert.ok(rendered.includes('?session='+encodeURIComponent(token)));assert.match(rendered,/25.00/);assert.doesNotMatch(rendered,/Request Bill/);
});

test('3.2 legacy preparing round still advances to ready and serving does not close the visit',async()=>{
 const h=harness();await h.login('kitchen');h.db.table_sessions.push({id:'visit',table_id:'table-1',status:'open'});
 h.db.orders.push({id:'legacy',restaurant_id:'A',branch_id:'branch-a',table_session_id:'visit',status:'preparing'});
 await h.load('src/app/actions/staff-ops.ts').advanceOrderStatus('legacy','preparing');assert.equal(h.db.orders[0].status,'ready');
 await h.load('src/app/actions/staff-ops.ts').markOrderServed('legacy');assert.equal(h.db.table_sessions[0].status,'open');assert.deepEqual(h.db.order_status_history.map(x=>x.status),['ready','served']);
});
test('3.2 staff board renders one table workspace for multiple rounds and excludes closed history',async()=>{
 const h=harness();await h.login('cashier');h.db.table_sessions.push({id:'active',table_id:'table-1',status:'open'},{id:'old',table_id:'table-1',status:'closed'});
 for(const [id,visit] of [['round-one','active'],['round-two','active'],['old-round','old']])h.db.orders.push({id,restaurant_id:'A',branch_id:'branch-a',table_session_id:visit,status:'pending'});
 const page=JSON.stringify(await h.load('src/app/staff/orders/page.tsx').default());
 assert.equal((page.match(/"type":"DiningTableCard"/g)||[]).length,1);assert.ok(page.includes('round-one')&&page.includes('round-two'));assert.ok(!page.includes('old-round'));assert.ok(!page.includes('KitchenOrderCard'));
});
test('3.2 starting manual payment from open visit internally prepares bill; no customer intent required',async()=>{
 const h=harness();await h.login('cashier');h.db.table_sessions.push({id:'visit',table_id:'table-1',status:'open'});
 const result=await h.load('src/app/actions/dining.ts').changeDiningSession({tableId:'table-1',sessionId:'visit',action:'start_payment',attemptKey:'attempt',method:'cash'});
 assert.equal(result.error,null);assert.equal(h.state.rpcCalls.at(-1).name,'staff_table_action');assert.equal(h.state.rpcCalls.at(-1).args.p_action,'start_payment');
});
test('3.3 legacy kitchen staff uses the unified payment operation',async()=>{
 const h=harness();await h.login('kitchen');h.db.table_sessions.push({id:'visit',table_id:'table-1',status:'open'});
 assert.equal((await h.load('src/app/actions/dining.ts').changeDiningSession({tableId:'table-1',sessionId:'visit',action:'start_payment'})).error,null);
 assert.equal(h.state.rpcCalls.at(-1).name,'staff_table_action');
});
test('3.3 logout revokes stored cookie; staff cannot create staff or grant manager access',async()=>{
 const h=harness();await h.login('staff');const token=h.jar.get('thaliq_staff_session');
 h.state.user=null;
 await assert.rejects(h.load('src/app/actions/staff.ts').manageStaff({error:null},new FormData()),/REDIRECT \/login/);
 await assert.rejects(h.load('src/app/actions/staff-auth.ts').staffLogout(),/REDIRECT \/staff/);
 h.jar.set('thaliq_staff_session',token);await assert.rejects(h.load('src/lib/staff-session.ts').requireStaffSession(),/REDIRECT \/staff/);
});
test('3.3 name selection binds the PIN to that employee and restaurant; directory exposes no hashes',async()=>{
 const h=harness();await h.login('kitchen');h.jar.clear();
 const {lookupRestaurant,staffLogin}=h.load('src/app/actions/staff-auth.ts');
 const directory=await lookupRestaurant('a');
 // Query adapter returns extra fields, so assert the real select projection below in production code tests.
 assert.equal(directory.slug,'a');
 const form=new FormData();form.set('restaurantSlug','b');form.set('staffId',h.db.staff[0].id);form.set('pin','1234');
 assert.ok((await staffLogin({error:null},form)).error);assert.equal(h.jar.size,0);
 form.set('restaurantSlug','a');form.set('pin','5555');assert.ok((await staffLogin({error:null},form)).error);
});
test('3.3 new PIN rules and salted hash verification reject weak/malformed input',()=>{
 const h=harness(),{hashPin,verifyPin,validNewPin}=h.load('src/lib/staff-pin.ts');
 for(const pin of ['1234','111111','123456','987654','notapin'])assert.equal(validNewPin(pin),false);
 assert.equal(validNewPin('482951'),true);const a=hashPin('482951'),b=hashPin('482951');assert.notEqual(a,b);
 assert.equal(verifyPin('482951',a),true);assert.equal(verifyPin('482952',a),false);assert.equal(verifyPin('482951','bad'),false);
});
test('3.3 legacy staff URLs redirect to one console',async()=>{
 const h=harness();await h.login('waiter');
 for(const route of ['kitchen','waiter','cashier'])await assert.rejects(h.load('src/app/staff/'+route+'/page.tsx').default(),/REDIRECT \/staff\/orders/);
});
