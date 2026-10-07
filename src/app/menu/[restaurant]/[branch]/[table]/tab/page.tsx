import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { OrderStatusStepper } from "@/components/menu/order-status-stepper";
import { CustomerPayment } from "@/components/menu/customer-payment";
import { Button } from "@/components/ui/button";
import { getCustomerTab } from "@/lib/customer-tab";

export default async function CustomerTabPage(props: PageProps<"/menu/[restaurant]/[branch]/[table]/tab">) {
  const { restaurant, branch, table } = await props.params;
  const { session: token } = await props.searchParams;
  if (typeof token !== "string") notFound();
  const tab = await getCustomerTab(restaurant, branch, table, token);
  if (!tab) notFound();
  if (tab.session.status === "closed") return <div className="mx-auto max-w-xl p-6"><h1 className="text-xl font-semibold">Thank you</h1><p>Your table session has ended.</p></div>;
  const canOrder = ["open", "bill_requested"].includes(tab.session.status);
  const menuUrl = `/menu/${encodeURIComponent(restaurant)}/${encodeURIComponent(branch)}/${encodeURIComponent(table)}?session=${encodeURIComponent(token)}`;

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6 p-4 pb-16">
      <AutoRefresh intervalMs={4000} />
      <div className="pt-6 text-center">
        <p className="text-sm text-muted-foreground">{tab.restaurant.name} · Table {tab.table.label}</p>
        <h1 className="text-2xl font-semibold">Your Table</h1>
      </div>
      {tab.orders.map((order, index) => (
        <section key={order.id} className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="font-medium">Round {index + 1} · Order #{order.order_number}</h2>
          {order.order_items.map((item) => (
            <p key={item.id} className="text-sm">
              {item.item_name}{item.variant_name ? ` (${item.variant_name})` : ""} × {item.quantity}
            </p>
          ))}
          <OrderStatusStepper status={order.status} />
          <p className="text-sm">Round total: ₹{Number(order.total_amount).toFixed(2)}{order.status === "cancelled" ? " (excluded)" : ""}</p>
        </section>
      ))}
      <p className="flex justify-between border-t pt-4 font-semibold"><span>Running total</span><span>₹{tab.total.toFixed(2)}</span></p>
      {canOrder ? <Button asChild><Link href={menuUrl}>Add More Items</Link></Button> : <p role="status">{tab.session.status === "paid" ? "Staff recorded your payment. They will close your table." : "Payment pending. Please complete payment with staff."}</p>}
      {canOrder && <CustomerPayment restaurant={restaurant} branch={branch} table={table} token={token} total={tab.total} counterIntent={tab.session.payment_intent === "counter"} menuUrl={menuUrl} />}
    </div>
  );
}
