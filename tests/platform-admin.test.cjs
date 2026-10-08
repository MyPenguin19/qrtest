/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable -- isolated server-module tests */
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
function harness() {
  const state={user:{id:'verified',email:'verified@example.invalid',email_confirmed_at:'2026-01-01'},outcome:'allowed',error:null,authError:null,throw:false,calls:0};
  const client={auth:{getUser:async()=>{if(state.throw)throw Error('service offline');return {data:{user:state.user},error:state.authError};}},rpc:async(name,...args)=>{assert.equal(name,'platform_admin_status');assert.deepEqual(args,[]);state.calls++;return {data:state.outcome,error:state.error};}};
  const cache={};function load(file){if(cache[file])return cache[file];const module={exports:{}};
    const code=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
    new Function('require','module','exports',code)(id=>{
      if(id==='server-only')return {};
      if(id==='@/lib/supabase/server')return {createClient:async()=>client};
      if(id==='@/lib/platform-admin')return load('src/lib/platform-admin.ts');
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
  for(const file of ['src/app/platform/page.tsx',...fs.readdirSync(path.join(__dirname,'../src/app/admin'),{recursive:true}).filter(x=>x.endsWith('page.tsx')).map(x=>'src/app/admin/'+x)]) {
    const h=harness();h.state.outcome='denied';await assert.rejects(h.load(file).default(),/access-denied/);
  }
});
