import type { ComponentProps } from 'react';
export const useRouter = () => ({ refresh: () => window.dispatchEvent(new Event('fixture-refresh')) });
export default function Link(props: ComponentProps<'a'>) { return <a {...props} />; }
export async function chooseCounterPayment(restaurant:string, branch:string, table:string, token:string) {
  return (await fetch('/counter', { method:'POST', body:JSON.stringify({restaurant,branch,table,token}) })).json();
}
export async function changeDiningSession(input:unknown) {
  return (await fetch('/manual', {method:'POST',body:JSON.stringify(input)})).json();
}
