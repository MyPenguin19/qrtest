/* eslint-disable @typescript-eslint/no-require-imports, @next/next/no-assign-module-variable */
const {test}=require('node:test'),assert=require('node:assert/strict'),ts=require('typescript'),fs=require('node:fs');
function load(file){const module={exports:{}};new Function('exports','module',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(module.exports,module);return module.exports;}
const {businessDayWindow,receiptSummary,unassociatedOrderKind,ACTIONABLE_ORDER_STATUSES,fulfillmentLabel}=load('src/lib/operations-view.ts');
const {readAllRows}=load('src/lib/query-pages.ts');
test('New York business day spans 23 hours in spring and 25 in fall',()=>{
 assert.deepEqual(businessDayWindow(new Date('2026-03-08T15:00:00Z')),{start:'2026-03-08T05:00:00.000Z',end:'2026-03-09T04:00:00.000Z',timeZone:'America/New_York'});
 const fall=businessDayWindow(new Date('2026-11-01T15:00:00Z'));assert.equal(fall.start,'2026-11-01T04:00:00.000Z');assert.equal(fall.end,'2026-11-02T05:00:00.000Z');
});
test('Today uses restaurant date near UTC midnight, including year boundary',()=>{
 const day=businessDayWindow(new Date('2027-01-01T02:00:00Z'));assert.equal(day.start,'2026-12-31T05:00:00.000Z');assert.equal(day.end,'2027-01-01T05:00:00.000Z');
});
test('Revenue counts successful receipts on receipt day, not submissions/attempts; boundaries and cents are exact',()=>{
 const window=businessDayWindow(new Date('2026-10-08T12:00:00Z'));
 const receipt=(id,amount,status='paid',confirmed_at=window.start)=>({id,amount,status,confirmed_at,created_at:'2026-10-07T23:00:00Z'});
 const rows=[receipt('one','10.10'),receipt('two','0.20'),receipt('one','10.10'),receipt('pending',999,'pending'),receipt('failed',99,'failed'),receipt('end',500,'paid',window.end),receipt('old',600,'paid','2026-10-08T03:59:59Z')];
 assert.deepEqual(receiptSummary(rows,window),{revenue:10.3,legacyCount:0});
});
test('Legacy paid receipts use creation timestamp transparently and failed legacy records are excluded',()=>{
 const window=businessDayWindow(new Date('2026-10-08T12:00:00Z'));
 assert.deepEqual(receiptSummary([{id:'legacy',status:'paid',amount:'7.25',confirmed_at:null,created_at:window.start},{id:'legacy-failed',status:'failed',amount:8,confirmed_at:null,created_at:window.start}],window),{revenue:7.25,legacyCount:1});
});
test('Served/Completed never reappear as actionable; legacy Preparing remains New',()=>{
 assert.ok(!ACTIONABLE_ORDER_STATUSES.includes('served'));assert.ok(!ACTIONABLE_ORDER_STATUSES.includes('completed'));assert.ok(ACTIONABLE_ORDER_STATUSES.includes('preparing'));assert.equal(fulfillmentLabel('preparing'),'New');assert.equal(fulfillmentLabel('served'),'Served');
 assert.equal(unassociatedOrderKind({submission_key:null,customer_session_id:null}),'Unassigned order · needs review');
 assert.equal(unassociatedOrderKind({submission_key:'submission',customer_session_id:null}),'Counter order');
 assert.equal(unassociatedOrderKind({submission_key:'submission',customer_session_id:'original-device'}),'Unassigned order · needs review');
});
test('Operational/receipt reads traverse Supabase row limits and fail visibly on query errors',async()=>{
 const rows=Array.from({length:2501},(_,id)=>({id}));let calls=0;
 const result=await readAllRows(async(from,to)=>{calls++;return {data:rows.slice(from,to+1),error:null};});assert.equal(result.length,2501);assert.equal(calls,3);
 await assert.rejects(readAllRows(async()=>({data:null,error:{message:'network'}})),/Could not load/);
});
