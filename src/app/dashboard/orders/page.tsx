import Link from "next/link";
import { BUSINESS_TIME_ZONE, fulfillmentLabel, unassociatedOrderKind } from "@/lib/operations-view";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentRestaurant } from "@/lib/restaurant";
import { createClient } from "@/lib/supabase/server";

export default async function OrdersPage(props: PageProps<"/dashboard/orders">) {
  const search=await props.searchParams;
  const page=Math.max(1,Math.min(1000000,Math.floor(Number(typeof search.page === "string" ? search.page : 1)) || 1));
  const restaurant = await requireCurrentRestaurant();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("orders")
    .select("id, order_number, status, total_amount, created_at, submission_key, customer_session_id, payments(status), branches(name), table_sessions(status, restaurant_tables(label))")
    .eq("restaurant_id", restaurant.restaurantId)
    .order("created_at", { ascending: false })
    .order("id",{ascending:false})
    .range((page-1)*50,page*50);
  if(error) throw new Error("Could not load order history.");
  const hasNext=(data?.length??0)>50;
  const orders=data?.slice(0,50);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={5000} />
      <div>
        <h1 className="text-2xl font-semibold">Orders</h1>
        <p className="text-muted-foreground">Active and historical orders across all branches. Served and completed records are retained.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order history · Page {page}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(orders ?? []).map((order) => (
            <div key={order.id} className="flex items-center justify-between border-b py-2 last:border-0">
              <div>
                <p className="font-medium">Order #{order.order_number}</p>
                {order.table_sessions && <p className="text-xs text-muted-foreground">Table {(order.table_sessions as unknown as {restaurant_tables:{label:string}}).restaurant_tables.label} · {(order.table_sessions as unknown as {status:string}).status.replaceAll("_", " ")}</p>}
                {!order.table_sessions && <p className="text-xs text-muted-foreground">{unassociatedOrderKind(order)}</p>}
                <p className="text-xs text-muted-foreground">{new Intl.DateTimeFormat("en-US",{timeZone:BUSINESS_TIME_ZONE,dateStyle:"medium",timeStyle:"short"}).format(new Date(order.created_at))} · {BUSINESS_TIME_ZONE}</p>
                <p className="text-xs text-muted-foreground">
                  {(order.branches as unknown as { name: string } | null)?.name}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">₹{order.total_amount}</span>
                <Badge>{fulfillmentLabel(order.status)}</Badge>
              </div>
            </div>
          ))}
          {(!orders || orders.length === 0) && (
            <p className="text-sm text-muted-foreground">
              No orders yet. Orders placed from the customer QR menu will appear here in real time.
            </p>
          )}
        </CardContent>
      </Card>
      <nav aria-label="Order history pages" className="flex gap-4">
        {page>1 && <Link className="underline" href={`/dashboard/orders?page=${page-1}`}>Newer orders</Link>}
        {hasNext && <Link className="underline" href={`/dashboard/orders?page=${page+1}`}>Older orders</Link>}
      </nav>
    </div>
  );
}
