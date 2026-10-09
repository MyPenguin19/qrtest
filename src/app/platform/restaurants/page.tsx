import Link from "next/link";
import { getPlatformRestaurants } from "@/lib/platform-reporting";
import { PlatformShell,ReportFilters,ReportPeriod,Definitions } from "@/components/platform/report-ui";
import { count,directoryUrl,reportOptions,utcDate } from "@/lib/platform-report-options";
export const dynamic="force-dynamic";
export default async function RestaurantsPage({searchParams}:PageProps<"/platform/restaurants">) {
  const search=await searchParams,data=await getPlatformRestaurants(search),options=reportOptions(search);
  return <PlatformShell title="Restaurant directory"><ReportFilters search={search} directory/><ReportPeriod period={data}/>
    <p>{count(data.total)} matching restaurants · Page {data.page} of {Math.max(1,Math.ceil(data.total/data.size))}</p>
    <div className="grid min-w-0 gap-4 lg:grid-cols-2">{data.rows.map(r=><article key={r.id} className="min-w-0 space-y-3 rounded border p-4">
      <h2 className="break-words text-lg font-semibold"><Link className="underline" href={`/platform/restaurants/${r.id}?days=${options.days}`}>{r.name}</Link></h2>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">{[["Slug",r.slug],["Verified owner contact",r.owner_email??"Unavailable"],["Created",utcDate(r.created_at)],["Account status",r.account_status],["Restaurant operating status",r.status],["Readiness",r.readiness],["Last qualifying order",utcDate(r.last_order)],["Submitted orders in period",count(r.orders)],["Qualifying orders: current / previous period",`${r.qualifying_orders} / ${r.previous_orders}`],["Branches",`${r.branches} (${r.active_branches} active)`]].map(([k,v])=><div key={k} className="min-w-0"><dt className="text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
    </article>)}</div>
    {!data.rows.length&&<p>No restaurants on this page match your filters. Change the filters or return to page 1.</p>}
    <nav aria-label="Directory pages" className="flex flex-wrap gap-4">{data.page>1&&<><Link href={directoryUrl(search,1)}>First page</Link><Link href={directoryUrl(search,data.page-1)}>Previous</Link></>}{data.page*data.size<data.total&&<Link href={directoryUrl(search,data.page+1)}>Next</Link>}</nav><p className="text-sm">Previous-period activity uses the preceding {options.days} calendar days; the current period includes a partial today.</p><Definitions/>
  </PlatformShell>;
}
