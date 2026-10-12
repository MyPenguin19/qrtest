export function useParams() { return {restaurant:'cafe',branch:'main',table:'table-1'}; }
export function useSearchParams() { return new URLSearchParams('session=original-visit'); }
export function useRouter() { return {push:(url:string)=>window.dispatchEvent(new CustomEvent('fixture-navigation',{detail:url}))}; }
export async function placeOrder(input:unknown) {
 const response=await fetch('/order',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 if(!response.ok) throw new Error('Unknown result');
 return response.json();
}
