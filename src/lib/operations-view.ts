export const ACTIONABLE_ORDER_STATUSES = ["pending", "accepted", "preparing", "ready"];
export function fulfillmentLabel(status: string) {
  return ({pending:"New",accepted:"New",preparing:"New",ready:"Ready",served:"Served",completed:"Completed",cancelled:"Cancelled"} as Record<string,string>)[status] ?? status;
}
export function unassociatedOrderKind(order:{submission_key?:string|null;customer_session_id?:string|null}) {
  return order.submission_key && !order.customer_session_id ? "Counter order" : "Unassigned order · needs review";
}

// A calendar business day in the requested IANA zone, never the server's timezone.
export const BUSINESS_TIME_ZONE = "America/New_York";
function localParts(date:Date,timeZone:string) {
  const parts=new Intl.DateTimeFormat("en-US",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const get=(type:string)=>Number(parts.find(p=>p.type===type)!.value);
  return {year:get("year"),month:get("month"),day:get("day"),hour:get("hour"),minute:get("minute"),second:get("second")};
}
function midnightUtc(year:number,month:number,day:number,timeZone:string) {
  const wall=Date.UTC(year,month-1,day);let candidate=wall;
  for(let i=0;i<4;i++) {
    const p=localParts(new Date(candidate),timeZone);
    const delta=wall-Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second);
    candidate+=delta;if(!delta)break;
  }
  return new Date(candidate).toISOString();
}
export function businessDayWindow(now=new Date(),timeZone=BUSINESS_TIME_ZONE) {
  const p=localParts(now,timeZone),next=new Date(Date.UTC(p.year,p.month-1,p.day+1));
  return {start:midnightUtc(p.year,p.month,p.day,timeZone),end:midnightUtc(next.getUTCFullYear(),next.getUTCMonth()+1,next.getUTCDate(),timeZone),timeZone};
}
export type Receipt = {id:string;status:string;amount:number|string;confirmed_at:string|null;created_at:string};
export function receiptSummary(receipts:Receipt[],window:{start:string;end:string}) {
  let cents=0,legacyCount=0;const seen=new Set<string>();
  for(const p of receipts) {
    const at=p.confirmed_at??p.created_at;
    if(seen.has(p.id)||p.status!=="paid"||Date.parse(at)<Date.parse(window.start)||Date.parse(at)>=Date.parse(window.end))continue;
    seen.add(p.id);cents+=Math.round(Number(p.amount)*100);if(!p.confirmed_at)legacyCount++;
  }
  return {revenue:cents/100,legacyCount};
}
