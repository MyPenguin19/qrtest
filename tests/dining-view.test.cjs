/* eslint-disable @typescript-eslint/no-require-imports -- Native Node test runner. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const source=ts.transpileModule(fs.readFileSync('src/lib/dining-view.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported={};new Function('exports',source)(exported);
const {diningTableView,tableAttention,tablePriority,fulfillmentGroup}=exported;
function round(id,number,status,name,quantity,total){return {id,order_number:number,status,created_at:`2026-10-07T17:${number}:00Z`,total_amount:total,order_items:[{id:`item-${id}`,item_name:name,quantity}]};}
function row(id='T1'){return {id,label:id,branch_id:'branch-a',branches:{name:'Main'},status:'order_pending',table_sessions:[{id:`visit-${id}`,status:'open',opened_at:'2026-10-07T17:00:00Z',payment_intent:null,bills:[],orders:[round('burger',26,'pending','Burger',1,9),round('coke',25,'served','Coke',2,8)]}]};}
test('T1 groups Coke served and Burger new into one visit, preserving rounds and total 17',()=>{
 const r=row(),v=diningTableView(r);assert.equal(v.sessionId,'visit-T1');assert.equal(v.total,17);assert.equal(v.orders.length,2);
 assert.deepEqual(v.orders.map(o=>[o.round,o.id,fulfillmentGroup(o.status)]),[[1,'coke','completed'],[2,'burger','new']]);assert.equal(tableAttention(v),'New Order');assert.equal(r.table_sessions[0].orders[0].id,'burger');
});
test('new devices/rounds stay in one table and never merge item quantities or provenance',()=>{
 const r=row();r.table_sessions[0].orders.push(round('latte',27,'pending','Latte',1,5),round('second-latte',28,'pending','Latte',2,10));
 const v=diningTableView(r);assert.equal(v.total,32);assert.equal(v.orderCount,4);assert.equal(v.orders[2].order_items[0].quantity,1);assert.equal(v.orders[3].order_items[0].quantity,2);
});
test('ready and served rounds retain their original round numbers; cancelled amount excluded',()=>{
 const r=row();r.table_sessions[0].orders[0].status='ready';assert.equal(tableAttention(diningTableView(r)),'Ready');
 r.table_sessions[0].orders[0].status='served';assert.equal(tableAttention(diningTableView(r)),'Open');
 r.table_sessions[0].orders.push(round('cancel',27,'cancelled','Pizza',1,20));assert.equal(diningTableView(r).total,17);
});
test('counter intent sorts before new work, ready, quiet and available without crossing tables',()=>{
 const a=row(),b=row('T2'),c=row('T3'),d=row('T4'),e=row('T5');b.table_sessions[0].payment_intent='counter';c.table_sessions[0].orders=[];d.table_sessions=[];e.table_sessions[0].orders[0].status='ready';
 const all=[a,b,c,d,e].map(diningTableView).sort((x,y)=>tablePriority(x)-tablePriority(y));assert.deepEqual(all.map(t=>t.id),['T2','T1','T5','T3','T4']);assert.equal(tableAttention(all[0]),'Ready to Pay');
});
test('closed sessions never populate available table; a new visit has no prior items',()=>{
 const r=row();r.table_sessions[0].status='closed';const available=diningTableView(r);assert.equal(available.sessionId,null);assert.equal(available.total,0);assert.deepEqual(available.orders,[]);
 r.table_sessions.push({id:'new-visit',status:'open',opened_at:'2026-10-08T00:00:00Z',payment_intent:null,bills:[],orders:[]});assert.deepEqual(diningTableView(r).orders,[]);assert.equal(diningTableView(r).sessionId,'new-visit');
});
test('invalid duplicate active visits fail visibly rather than merging dining parties',()=>{
 const r=row();r.table_sessions.push({...r.table_sessions[0],id:'other'});assert.throws(()=>diningTableView(r),/multiple active/);
});
