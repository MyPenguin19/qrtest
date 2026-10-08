import Link from "next/link";
import { getPlatformOverview } from "@/lib/platform-reporting";
import { PlatformShell,ReportFilters,ReportPeriod,Metrics,ActivityChart,Definitions } from "@/components/platform/report-ui";
import { utcDate } from "@/lib/platform-report-options";
export const dynamic="force-dynamic";
export default async function PlatformPage({searchParams}:PageProps<"/platform">) {
  const search=await searchParams,data=await getPlatformOverview(search);
  return <PlatformShell title="Platform overview"><ReportFilters search={search}/><ReportPeriod period={data}/>
    <Metrics items={[["Total restaurant tenants",data.total_restaurants],["Active restaurants in period",data.active_restaurants],["New restaurants in period",data.new_restaurants],["Submitted orders (including cancelled)",data.orders],["Restaurants needing setup",data.needs_setup],["Currently active table visits",data.active_visits]]}/>
    <p className="text-sm">{data.cancelled_orders} submitted orders are cancelled. Active means at least one non-cancelled order in this period. Active visits reflect current session state, not historical table flags.</p>
    <div className="grid gap-4 lg:grid-cols-3"><ActivityChart rows={data.trend} metric="signups" title="Restaurant signups"/><ActivityChart rows={data.trend} metric="orders" title="Submitted orders"/><ActivityChart rows={data.trend} metric="active_restaurants" title="Distinct active restaurants per day"/></div>
    <section><h2 className="mb-3 text-lg font-semibold">Recently registered</h2>{data.recent_restaurants.length?<ul className="space-y-3">{data.recent_restaurants.map(r=><li key={r.id} className="break-words rounded border p-3"><Link className="font-semibold underline" href={`/platform/restaurants/${r.id}`}>{r.name}</Link><p>{r.slug} · {utcDate(r.created_at)} · {r.readiness}</p></li>)}</ul>:<p>No restaurants registered.</p>}</section>
    <p className="text-sm">Reporting query completed at {utcDate(data.end)}. This is data freshness, not an uptime or infrastructure-health check.</p><Definitions/>
  </PlatformShell>;
}
