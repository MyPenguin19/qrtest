import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatformRestaurant } from "@/lib/platform-reporting";
import { PlatformShell,ReportFilters,ReportPeriod,Metrics,ActivityChart,Definitions } from "@/components/platform/report-ui";
import { decimal,utcDate,reportOptions } from "@/lib/platform-report-options";
export const dynamic="force-dynamic";
export default async function RestaurantPage({params,searchParams}:PageProps<"/platform/restaurants/[restaurantId]">) {
  const {restaurantId}=await params,search=await searchParams,data=await getPlatformRestaurant(restaurantId,search);
  if(!data) notFound();
  return <PlatformShell title={data.name}><Link className="underline" href={`/platform/restaurants?days=${reportOptions(search).days}`}>Back to restaurant directory</Link><ReportFilters search={search}/><ReportPeriod period={data}/>
    <dl className="grid gap-3 rounded border p-4 sm:grid-cols-2">{[["Restaurant ID",data.id],["Slug",data.slug],["Verified owner contact",data.owner_email??"Unavailable"],["Created",utcDate(data.created_at)],["Account status",data.status],["Readiness",data.readiness],["Configured currency","Unavailable — no currency setting"],["Restaurant timezone","Unavailable — reports use UTC"],["Branch configuration",`${data.active_branches} active / ${data.branches} configured`],["Dine-in QR destinations",`${data.dine_in_tables} active tables on active branches`]].map(([k,v])=><div key={k} className="min-w-0"><dt className="text-sm text-muted-foreground">{k}</dt><dd className="break-words">{v}</dd></div>)}</dl>
    <Metrics items={[["Submitted orders in period",data.orders],["Cancelled orders in period",data.cancelled_orders],["Configured tables",data.tables],["Currently active visits",data.active_visits],["Menu items",data.menu_items],["Available items in own categories",data.available_items],["Menu categories",data.categories],["Configured operational staff",data.staff_accounts]]}/>
    <section className="space-y-2 rounded border p-4"><h2 className="font-semibold">Setup and attention</h2><ul className="list-inside list-disc">
      <li>Restaurant account: created</li><li>Restaurant ordering: {data.status==="active"?"enabled":"not enabled"}</li>
      <li>Active branch: {data.active_branches?"configured":"missing"}</li><li>Menu category: {data.categories?"configured":"missing"}</li>
      <li>Available item in own category: {data.available_items?"configured":"missing"}</li>
      <li>Counter ordering: {data.ready?"ready":"setup incomplete"}</li><li>Dine-in ordering: {data.ready&&data.dine_in_tables?"ready":"needs an enabled restaurant, active branch, available menu and active table"}</li>
    </ul>{data.first_order===null&&<p>No non-cancelled order has been recorded yet.</p>}
    {data.last_order&&Date.parse(data.last_order)<Date.parse(data.end)-data.inactivity_days*86400000&&<p>No qualifying order for at least {data.inactivity_days} days. Review adoption or offer assistance; this is not a sales-based health score.</p>}</section>
    <section className="space-y-3"><h2 className="font-semibold">Order values and recorded receipts</h2>
      <Metrics items={[["Non-cancelled submitted order value",decimal(data.order_value)],["Successful staff-recorded external receipts",decimal(data.staff_recorded_amount)],["Successful staff-recorded receipt count",data.staff_recorded_count]]}/>
      <p className="text-sm">Amounts use stored numeric units; currency is not configured and cannot be verified. Order value is not money collected. Receipt totals include tax/service within the stored amount and use confirmation time; {data.fallback_timestamp_count} paid records in this period use a legacy creation-time fallback. {data.legacy_paid_count} paid records have unknown confirmation source and are excluded from staff-recorded totals. Provider-verified online payment totals are unavailable. These are not platform revenue.</p>
    </section>
    <section><h2 className="mb-3 font-semibold">Recent record activity</h2><dl className="grid gap-3 sm:grid-cols-2">{[["First qualifying order",data.first_order],["Last qualifying order",data.last_order],["Last completion history event",data.last_completed_order],["Last visit opened",data.last_visit],["Last staff-recorded successful receipt",data.last_recorded_payment],["Last menu item record update",data.last_menu_update]].map(([k,v])=><div key={k}><dt className="text-sm text-muted-foreground">{k}</dt><dd>{utcDate(v)}</dd></div>)}</dl><p className="mt-2 text-sm">A completion can include manual unpaid closure. Menu update time does not prove a substantive content change.</p></section>
    <ActivityChart rows={data.trend} metric="orders" title="Submitted orders per day"/><Definitions/>
  </PlatformShell>;
}
