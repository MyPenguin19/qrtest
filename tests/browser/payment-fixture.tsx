import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { CustomerPayment } from '../../src/components/menu/customer-payment';
import type { DiningRound } from '../../src/lib/dining-view';
import { DiningTableCard } from '../../src/components/staff/dining-table-card';

// Browser component fixture. Actions/router use deterministic adapters;
// authorization and SQL behavior are tested in the separate server/database suites.
const INITIAL_ORDERS: DiningRound[] = [{id:'round1',round:1,order_number:1,status:'served',created_at:'2026-10-07T17:00:00Z',total_amount:8,order_items:[{id:'coke',item_name:'Coke',quantity:2}]},{id:'round2',round:2,order_number:2,status:'pending',created_at:'2026-10-07T17:05:00Z',total_amount:17,order_items:[{id:'burger',item_name:'Burger',quantity:1}]}];
function Fixture() {
  const [counter, setCounter] = useState(false);
  const [owner,setOwner] = useState(true);
  const [total, setTotal] = useState(25);
  useEffect(() => {
    const update = () => { setCounter(true); setTotal(30); };
    window.addEventListener('fixture-counter', update);
    return () => window.removeEventListener('fixture-counter', update);
  }, []);
  const [orders,setOrders] = useState<DiningRound[]>(INITIAL_ORDERS);
  const [closed,setClosed] = useState(false);
  const [payment,setPayment] = useState({status:'open',attemptKey:null as string|null});
  useEffect(()=>{
    const fulfill = (event:Event)=>{const {orderId,status}=(event as CustomEvent).detail;setOrders(previous=>previous.map(o=>o.id===orderId?{...o,status}:o));};
    const close = ()=>setClosed(true);
    const pay = (event:Event)=>setPayment((event as CustomEvent).detail);
    window.addEventListener('fixture-payment',pay);
    window.addEventListener('fixture-fulfill',fulfill);window.addEventListener('fixture-close',close);
    return ()=>{window.removeEventListener('fixture-payment',pay);window.removeEventListener('fixture-fulfill',fulfill);window.removeEventListener('fixture-close',close);};
  },[]);
  const table = { id:'table', label:'1',branchId:'branch',branchName:'Main',openedAt:'2026-10-07T17:00:00Z',ageMinutes:32, status:'occupied', sessionId:closed?null:'visit-A', sessionStatus:closed?null:payment.status, paymentIntent:counter?'counter':null, orderCount:closed?0:orders.length, total:closed?0:total, orders:closed?[]:orders, attemptKey:payment.attemptKey, method:'cash' };
  return <>
    <CustomerPayment restaurant="a" branch="main" table="table" token="original-signed-visit" total={total} counterIntent={counter} menuUrl="/menu/a/main/table?session=original-signed-visit" />
    <DiningTableCard table={table} canPay canFulfill owner={owner} />
    <button onClick={()=>setOwner(false)}>Fixture: Staff access</button>
    <button onClick={()=>{setOrders(previous=>[...previous,{id:"round3",round:3,order_number:3,status:"pending",created_at:"2026-10-07T17:10:00Z",total_amount:5,order_items:[{id:"latte",item_name:"Latte",quantity:1}]}]);setTotal(n=>n+5);}}>Fixture: add Latte round</button>
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
