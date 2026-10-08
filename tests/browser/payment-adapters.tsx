import type { ComponentProps } from 'react';
export const useRouter = () => ({ refresh: () => window.dispatchEvent(new Event('fixture-refresh')) });
export default function Link(props: ComponentProps<'a'>) { return <a {...props} />; }
export async function chooseCounterPayment(restaurant:string, branch:string, table:string, token:string) {
  const result = await (await fetch('/counter', { method:'POST', body:JSON.stringify({restaurant,branch,table,token}) })).json();
  if(!result.error)window.dispatchEvent(new Event('fixture-counter'));
  return result;
}
export async function changeDiningSession(input:unknown) {
  const result = await (await fetch('/manual', {method:'POST',body:JSON.stringify(input)})).json();
  if(!result.error) {
    const {action,attemptKey} = input as {action:string;attemptKey?:string};
    if(action==='manual_close' || action==='confirm_payment')window.dispatchEvent(new Event('fixture-close'));
    if(action==='start_payment' || action==='fail_payment')window.dispatchEvent(new CustomEvent('fixture-payment',{detail:{status:action==='start_payment'?'payment_pending':'bill_requested',attemptKey}}));
  }
  return result;
}

export async function advanceOrderStatus(orderId:string,expectedStatus:string) {
  const result=await (await fetch('/ready',{method:'POST',body:JSON.stringify({orderId,expectedStatus})})).json();
  if(result.error)throw new Error(result.error);
  window.dispatchEvent(new CustomEvent('fixture-fulfill',{detail:{orderId,status:'ready'}}));
}
export async function markOrderServed(orderId:string) {
  const result=await (await fetch('/served',{method:'POST',body:JSON.stringify({orderId})})).json();
  if(result.error)throw new Error(result.error);
  window.dispatchEvent(new CustomEvent('fixture-fulfill',{detail:{orderId,status:'served'}}));
}
