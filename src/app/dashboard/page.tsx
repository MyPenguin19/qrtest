import { getDashboardMetrics } from "@/lib/dashboard-metrics";
import { fulfillmentLabel } from "@/lib/operations-view";
import { AutoRefresh } from "@/components/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireCurrentRestaurant } from "@/lib/restaurant";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardOverviewPage() {
  const restaurant = await requireCurrentRestaurant();
  const supabase = await createClient();

  const [metrics,recent] = await Promise.all([
    getDashboardMetrics(restaurant.restaurantId),
    supabase.from("orders").select("id, order_number, status, total_amount, order_items(item_name, quantity)")
      .eq("restaurant_id",restaurant.restaurantId).order("created_at",{ascending:false}).order("id").limit(8),
  ]);
  if(recent.error) throw new Error("Could not load recent orders.");
  const recentOrders=recent.data;
  const stats = [
    { label: "Today's Orders", value: metrics.todayOrders },
    { label: "Pending Orders", value: metrics.pendingOrders },
    { label: "Active Tables", value: metrics.activeTables },
    { label: "Today's Revenue", value: `₹${metrics.revenue.toFixed(2)}` },
  ];

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={8000} />
      <div>
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-muted-foreground">{restaurant.restaurantName} — live overview</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Card key={stat.label}>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">Today: midnight to midnight in {metrics.window.timeZone}. Orders count submissions, including cancelled orders. Pending means New rounds on open visits or unassigned orders. Revenue is full successful recorded receipts, including tax/service charges; pending/failed attempts and unpaid orders are excluded. External receipts are staff-reported, not provider-verified.{metrics.legacyCount > 0 ? ` ${metrics.legacyCount} legacy receipt(s) use their creation time because confirmation time is unavailable.` : ""}</p>
      <Card>
        <CardHeader>
          <CardTitle>Recent order history</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(recentOrders ?? []).map((order) => (
            <div key={order.id} className="flex items-center justify-between border-b py-2 last:border-0">
              <div>
                <p className="font-medium">Order #{order.order_number}</p>
                <p className="text-xs text-muted-foreground">
                  {order.order_items.map((i) => `${i.item_name} × ${i.quantity}`).join(", ")}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-medium">₹{order.total_amount}</span>
                <Badge>{fulfillmentLabel(order.status)}</Badge>
              </div>
            </div>
          ))}
          {(!recentOrders || recentOrders.length === 0) && (
            <p className="text-sm text-muted-foreground">
              No orders yet. Once customers start scanning table QR codes, live orders will appear
              here.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
