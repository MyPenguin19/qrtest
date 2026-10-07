import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { CustomerPayment } from '../../src/components/menu/customer-payment';
import { DiningTableCard } from '../../src/components/staff/dining-table-card';

// Browser component fixture. Actions/router use deterministic adapters;
// authorization and SQL behavior are tested in the separate server/database suites.
function Fixture() {
  const [counter, setCounter] = useState(false);
  const [total, setTotal] = useState(25);
  useEffect(() => {
    const update = () => { setCounter(true); setTotal(30); };
    window.addEventListener('fixture-refresh', update);
    return () => window.removeEventListener('fixture-refresh', update);
  }, []);
  const table = { id:'table', label:'1', status:'occupied', sessionId:'visit-A', sessionStatus:'open', paymentIntent:counter?'counter':null, orderCount:2, total, orders:[{number:1,status:'served'},{number:2,status:'pending'}], attemptKey:null, method:'cash' };
  return <>
    <CustomerPayment restaurant="a" branch="main" table="table" token="original-signed-visit" total={total} counterIntent={counter} menuUrl="/menu/a/main/table?session=original-signed-visit" />
    <DiningTableCard table={table} canPay />
  </>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
