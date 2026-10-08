/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable -- isolated server-module tests */
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
function harness() {
  const state={user:{id:'verified',email:'verified@example.invalid',email_confirmed_at:'2026-01-01'},outcome:'allowed',error:null,authError:null,throw:false,calls:0,reports:[],reportError:null,reportData:{rows:[],total:0}};
  const client={auth:{getUser:async()=>{if(state.throw)throw Error('service offline');return {data:{user:state.user},error:state.authError};}},rpc:async(name,...args)=>{if(name==='platform_admin_status'){assert.deepEqual(args,[]);state.calls++;return {data:state.outcome,error:state.error};}state.reports.push({name,args});return {data:state.reportData,error:state.reportError};}};
  const cache={};function load(file){if(cache[file])return cache[file];const module={exports:{}};
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',code)(id=>{
      if(id==='server-only')return {};
      if(id==='@/lib/supabase/server')return {createClient:async()=>client};
      if(id.startsWith('@/lib/'))return load('src/lib/'+id.slice(6)+'.ts');
      if(id.startsWith('@/components/'))return new Proxy({}, {get:(_,k)=>String(k)});
      if(id==='next/navigation')return {redirect:url=>{throw Error('REDIRECT '+url);}};
      if(id==='@/app/actions/auth')return {signOutOwner:()=>{}};
      return require(id);
    },module,module.exports);return cache[file]=module.exports;
  }return {state,load};
}
test('platform guard: anonymous, expired Auth and PIN-only sessions denied before database call',async()=>{
  const h=harness();h.state.user=null;
  await assert.rejects(h.load('src/lib/platform-admin.ts').requirePlatformAdmin(),/platform\/login/);assert.equal(h.state.calls,0);
  h.state.authError={message:'expired'};assert.equal((await h.load('src/lib/platform-admin.ts').platformAccess()).status,'unauthenticated');
});
test('platform guard: ordinary owner/manager, inactive/revoked and forged metadata denied',async()=>{
  for(const role of ['owner','manager','staff','super_admin']) {
    const h=harness();h.state.user.user_metadata={role};h.state.outcome='denied';
    await assert.rejects(h.load('src/lib/platform-admin.ts').requirePlatformAdmin(),/access-denied/);
  }
});
test('platform guard: active MFA admin allowed; subsequent revocation never cached',async()=>{
  const h=harness(),guard=h.load('src/lib/platform-admin.ts');assert.equal((await guard.requirePlatformAdmin()).userId,'verified');
  h.state.outcome='denied';await assert.rejects(guard.requirePlatformAdmin(),/access-denied/);assert.equal(h.state.calls,2);
});
test('platform guard: MFA required redirects and service errors fail closed',async()=>{
  const h=harness(),guard=h.load('src/lib/platform-admin.ts');h.state.outcome='mfa_required';await assert.rejects(guard.requirePlatformAdmin(),/platform\/mfa/);
  h.state.error={message:'database error'};assert.equal((await guard.platformAccess()).status,'unavailable');
  h.state.throw=true;assert.equal((await guard.platformAccess()).status,'unavailable');
});
test('platform status API independently guards requests; generic response and no-store',async()=>{
  const h=harness(),route=h.load('src/app/api/platform/status/route.ts');
  for(const [outcome,status] of [['allowed',200],['denied',403],['mfa_required',403]]){
    h.state.outcome=outcome;const res=await route.GET(new Request('https://example.invalid/api/platform/status?role=super_admin'));
    assert.equal(res.status,status);assert.equal(res.headers.get('cache-control'),'private, no-store');assert.deepEqual(await res.json(),{authorized:status===200});
  }
  h.state.user=null;assert.equal((await route.GET()).status,401);
});
test('every legacy admin page and platform landing independently deny direct rendering',async()=>{
  for(const file of ['src/app/platform/page.tsx','src/app/platform/restaurants/page.tsx','src/app/platform/restaurants/[restaurantId]/page.tsx','src/app/platform/analytics/page.tsx',...fs.readdirSync(path.join(__dirname,'../src/app/admin'),{recursive:true}).filter(x=>x.endsWith('page.tsx')).map(x=>'src/app/admin/'+x)]) {
    const h=harness();h.state.outcome='denied';await assert.rejects(h.load(file).default({searchParams:Promise.resolve({}),params:Promise.resolve({restaurantId:'00000000-0000-0000-0000-000000000000'})}),/access-denied/);
  }
});

test('3.5.2 DAL: each read freshly guards, normalizes options, and exposes only fixed RPCs',async()=>{
 const h=harness(),dal=h.load('src/lib/platform-reporting.ts');
 await dal.getPlatformRestaurants({days:'999',page:'-2',size:'1000',filter:'arbitrary_sql',sort:'DROP TABLE',q:'  cafe  '});
 assert.deepEqual(h.state.reports[0],{name:'platform_restaurants',args:[{p_days:30,p_page:1,p_size:25,p_search:'cafe',p_filter:'all',p_sort:'newest'}]});
 await dal.getPlatformOverview({days:'7'});assert.equal(h.state.calls,2);
 h.state.outcome='denied';await assert.rejects(dal.getPlatformRestaurant('00000000-0000-0000-0000-000000000001',{}),/access-denied/);assert.equal(h.state.reports.length,2);
});
test('3.5.2 DAL: malformed identifiers authorize first; internal query errors never escape',async()=>{
 const h=harness(),dal=h.load('src/lib/platform-reporting.ts');assert.equal(await dal.getPlatformRestaurant('not-a-uuid',{}),null);assert.equal(h.state.calls,1);assert.equal(h.state.reports.length,0);
 h.state.reportError={message:'secret database detail'};await assert.rejects(dal.getPlatformOverview({}),e=>e.message==='Platform reporting is unavailable. Please retry.');
});
test('3.5.2 query options preserve bounded filters and pagination links',()=>{
 const h=harness(),o=h.load('src/lib/platform-report-options.ts');
 assert.deepEqual(o.reportOptions({days:'90',page:'21',size:'50',filter:'ready',sort:'orders',q:'Latte'}),{days:90,page:21,size:50,search:'Latte',filter:'ready',sort:'orders'});
 assert.equal(o.reportOptions({days:['7','90'],q:'x'.repeat(200)}).search.length,100);
 const url=new URL(o.directoryUrl({days:'7',q:'A & B',size:'50'},2),'https://example.invalid');assert.equal(url.searchParams.get('q'),'A & B');assert.equal(url.searchParams.get('page'),'2');
});
