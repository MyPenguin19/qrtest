import Link from "next/link";
import { signOutOwner } from "@/app/actions/auth";
import { FILTERS,PERIODS,SORTS,reportOptions,utcDate,count,type SearchValues } from "@/lib/platform-report-options";
import type { Period,Trend } from "@/lib/platform-reporting";
export function PlatformShell({title,children}:{title:string;children:React.ReactNode}) {
  return <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-col gap-6 p-4 sm:p-6">
    <nav aria-label="Platform navigation" className="flex flex-wrap items-center gap-4 border-b pb-4">
      <Link href="/platform">Overview</Link><Link href="/platform/restaurants">Restaurants</Link><Link href="/platform/analytics">Analytics</Link>
      <form action={signOutOwner}><button className="rounded border px-3 py-2">Sign out</button></form>
    </nav><header><p className="text-sm text-muted-foreground">THALIQ · Read-only platform administration · MFA required</p><h1 className="break-words text-2xl font-semibold">{title}</h1></header>{children}</main>;
}
export function ReportFilters({search,directory=false}:{search:SearchValues;directory?:boolean}) {
  const o=reportOptions(search);const cls="block w-full rounded border bg-background p-2";
  return <form className="grid items-end gap-3 rounded border p-4 sm:grid-cols-2 lg:grid-cols-3">
    <label>Reporting period<select aria-label="Reporting period" name="days" defaultValue={o.days} className={cls}>{PERIODS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
    {directory&&<><label>Restaurant or verified owner email<input name="q" defaultValue={o.search} maxLength={100} className={cls} /></label>
      <label>Filter<select aria-label="Filter" name="filter" defaultValue={o.filter} className={cls}>{Object.entries(FILTERS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Sort<select aria-label="Sort" name="sort" defaultValue={o.sort} className={cls}>{Object.entries(SORTS).map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
      <label>Per page<select aria-label="Per page" name="size" defaultValue={o.size} className={cls}><option value="25">25</option><option value="50">50</option></select></label></>}
    <button className="min-h-11 rounded border px-4 py-2">Apply / refresh</button>
  </form>;
}
export function ReportPeriod({period}:{period:Period}) {
  return <p className="break-words text-sm text-muted-foreground">Reporting timezone: UTC. {utcDate(period.start)} inclusive → {utcDate(period.end)} exclusive. Today is partial. Apply / refresh to update. Attention threshold: {period.inactivity_days} days without a non-cancelled order.</p>;
}
export function Metrics({items}:{items:[string,number|string][]}) {
  return <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map(([label,value])=><div key={label} className="min-w-0 rounded border p-4"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="mt-2 break-words break-words text-2xl font-semibold">{typeof value==="number"?count(value):value}</dd></div>)}</dl>;
}
export function ActivityChart({rows,metric,title}:{rows:Trend[];metric:"orders"|"signups"|"active_restaurants"|"total_restaurants";title:string}) {
  const max=Math.max(1,...rows.map(r=>Number(r[metric]))),width=600,height=140;
  return <section className="min-w-0 rounded border p-4"><h2 className="mb-3 font-semibold">{title}</h2>
    <svg role="img" aria-label={`${title}. Daily UTC buckets; exact values follow.`} viewBox={`0 0 ${width} ${height}`} className="h-40 w-full">
      {rows.map((r,i)=><rect key={r.day} x={i*width/rows.length+1} y={height-Number(r[metric])/max*(height-15)} width={Math.max(1,width/rows.length-2)} height={Number(r[metric])/max*(height-15)} fill="currentColor"><title>{r.day}: {r[metric]}</title></rect>)}
      <line x1="0" x2={width} y1={height-1} y2={height-1} stroke="currentColor" />
    </svg><p className="text-xs text-muted-foreground">{rows[0]?.day} → {rows.at(-1)?.day} · daily scale 0–{count(max)}</p>
    {rows.every(r=>Number(r[metric])===0)&&<p className="text-sm">No recorded activity in this period.</p>}
    <details className="mt-3"><summary>Exact daily values</summary><dl className="mt-2 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto text-sm">{rows.map(r=><div key={r.day}><dt>{r.day}</dt><dd>{count(Number(r[metric]))}</dd></div>)}</dl></details>
  </section>;
}
export function Definitions() {
  return <details className="rounded border p-4 text-sm"><summary>Metric definitions and limitations</summary><div className="mt-3 space-y-2">
    <p>Submitted orders include cancellations and legacy records without table associations. Activity, first-order activation and repeat activity use non-cancelled orders only. Enabled account status is separate from activity. No-activity filters include restaurants with no orders ever.</p>
    <p>Setup requires an enabled restaurant, active branch and available item in its own category. A table is optional for counter orders; dine-in also needs an active table on an active branch. Staff setup is reported separately.</p>
    <p>Counts include all existing tenants, even test-like names and disabled accounts. There is no reliable test flag or deleted-tenant history. Trends reconstruct current records; cancellations/deletions can revise history. These usage reports do not measure system uptime, subscription revenue or customer health.</p>
  </div></details>;
}
