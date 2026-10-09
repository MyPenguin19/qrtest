import Link from "next/link";
import { PlatformShell } from "@/components/platform/report-ui";
import { getAudit } from "@/lib/platform-controls";
import { utcDate,type SearchValues } from "@/lib/platform-report-options";
export const dynamic="force-dynamic";
const actions=["platform_admin.provisioned","platform_admin.revoked","platform_admin.authorization_changed","platform.access_denied","restaurant.suspended","restaurant.reactivated","restaurant.control_denied","restaurant.control_failed"];
export default async function AuditPage({searchParams}:{searchParams:Promise<SearchValues>}) {
 const search=await searchParams;const value=(k:string)=>typeof search[k]==="string"?search[k] as string:"";
 const rawPage=Number(value("page"));const page=Number.isInteger(rawPage)&&rawPage>=1&&rawPage<=1000000?rawPage:1;const size=value("size")==="50"?50:25;
 const action=actions.includes(value("action"))?value("action"):"";
 const uuid=(s:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)?s:null;
 const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))?s+"T00:00:00Z":null;
 const data=await getAudit({p_page:page,p_size:size,p_from:date(value("from")),p_to:date(value("to")),p_action:action,p_restaurant:uuid(value("restaurant")),p_actor:uuid(value("actor"))});
 const url=(n:number)=>{const p=new URLSearchParams();for(const k of ["from","to","action","restaurant","actor"])if(value(k))p.set(k,value(k));p.set("page",String(n));p.set("size",String(size));return `/platform/audit?${p}`;};
 return <PlatformShell title="Audit Logs"><p>Append-only platform events. UTC date range includes From and excludes Until. Legacy entries may have no previous/new state or reason. Trusted SQL operator events may have no Auth actor.</p>
 <form className="grid gap-3 rounded border p-4 sm:grid-cols-2 lg:grid-cols-3">
 <label>From (inclusive UTC)<input className="block rounded border p-2" type="date" name="from" defaultValue={value("from")}/></label><label>Until (exclusive UTC)<input className="block rounded border p-2" type="date" name="to" defaultValue={value("to")}/></label>
 <label>Action<select className="block w-full rounded border p-2" name="action" defaultValue={action}><option value="">All actions</option>{actions.map(a=><option key={a}>{a}</option>)}</select></label>
 <label>Restaurant UUID<input className="block w-full rounded border p-2" name="restaurant" defaultValue={value("restaurant")} pattern="[0-9a-fA-F-]{36}"/></label><label>Administrator UUID<input className="block w-full rounded border p-2" name="actor" defaultValue={value("actor")} pattern="[0-9a-fA-F-]{36}"/></label>
 <label>Per page<select name="size" defaultValue={size} className="ml-2 rounded border p-2"><option>25</option><option>50</option></select></label><button className="rounded border p-2">Apply / refresh</button></form>
 <p>{data.total} matching events · page {page}</p>
 {data.rows.length===0&&<p>No matching audit events.</p>}
 <div className="space-y-3">{data.rows.map(row=><article className="space-y-1 break-all rounded border p-4 text-sm" key={row.id}><h2 className="font-semibold">{row.action} · {row.result}</h2><p>{utcDate(row.created_at)}</p><p>Actor: {row.actor_user_id??"Trusted operator / unavailable"}</p><p>Target: {row.target_type} {row.target_id??"—"}</p><p>Reason: {row.reason??"Not recorded"} · Outcome: {row.code??row.result}</p><p>Previous: {JSON.stringify(row.previous_state)} → New: {JSON.stringify(row.new_state)}</p><p>Event: {row.id} · Request: {row.request_id}</p></article>)}</div>
 <nav aria-label="Audit pagination" className="flex gap-4">{page>1&&<Link className="underline" href={url(page-1)}>Previous</Link>}{page*size<data.total&&<Link className="underline" href={url(page+1)}>Next</Link>}</nav>
 </PlatformShell>;
}
