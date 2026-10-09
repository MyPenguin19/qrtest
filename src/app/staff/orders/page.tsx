import { AccountNotice } from "@/components/account-notice";
import { StaffOperationNotice } from "@/components/staff/staff-operation-notice";
import { ACTIONABLE_ORDER_STATUSES, unassociatedOrderKind } from "@/lib/operations-view";
import { readAllRows } from "@/lib/query-pages";
import { WaiterRequestCard } from "@/components/staff/waiter-request-card";
import { StaffActivity } from "@/components/staff/staff-activity";
import { DiningTableCard } from "@/components/staff/dining-table-card";
import { getDiningTables } from "@/lib/dining-tables";

import { AutoRefresh } from "@/components/auto-refresh";
import { KitchenOrderCard } from "@/components/staff/kitchen-order-card";
import { Button } from "@/components/ui/button";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffSession } from "@/lib/staff-session";
import { staffLogout } from "@/app/actions/staff-auth";

export default async function StaffOrdersPage() {
  const session = await requireStaffSession();
  const admin = createAdminClient();

  const orderPage = (from:number,to:number) => {
  let query = admin
    .from("orders")
    .select(
      "id, order_number, status, created_at, submission_key, customer_session_id, payments(status), order_items(id, item_name, quantity), table_sessions(restaurant_tables(label))",
    )
    .eq("restaurant_id", session.restaurantId)
    .is("table_session_id", null)
    .in("status", ACTIONABLE_ORDER_STATUSES)
    .order("created_at").order("id").range(from,to);

  if (session.branchId) {
    query = query.eq("branch_id", session.branchId);
  }

  return query;
  };
  const [orders,tables] = await Promise.all([readAllRows<{
    id:string;order_number:number;status:string;created_at:string;submission_key:string|null;customer_session_id:string|null;
    payments:{status:string}[];order_items:{id:string;item_name:string;quantity:number}[];
  }>(orderPage),getDiningTables(session.restaurantId,session.branchId)]);

  const {data:branches}=await admin.from("branches").select("id").eq("restaurant_id",session.restaurantId);
  let requestsQuery=admin.from("waiter_requests").select("id,type,restaurant_tables(label)")
    .in("branch_id",(branches??[]).map(b=>b.id)).is("resolved_at",null).order("created_at");
  if(session.branchId) requestsQuery=requestsQuery.eq("branch_id",session.branchId);
  const {data:requests,error:requestError}=await requestsQuery;
  if(requestError) throw new Error("Could not load table requests.");



  return (
    <div className="flex min-h-screen flex-col gap-6 bg-muted/20 p-6">
      <AccountNotice restaurantId={session.restaurantId}/><AutoRefresh intervalMs={3000} /><StaffActivity/><StaffOperationNotice/>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Staff Console</h1>
          <p className="text-muted-foreground">{session.restaurantName} · Welcome, {session.name}</p>
        </div>
        <form action={staffLogout}>
          <Button type="submit" variant="outline">
            Sign out
          </Button>
        </form>
      </div>

      <nav className="flex gap-4 text-sm"><a href="#active-tables">Active Tables</a><a href="#available-tables">Available Tables</a></nav>

      <h2 id="active-tables" className="text-lg font-semibold">Active Tables</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tables.filter(t=>t.sessionId).map(table=><DiningTableCard key={table.sessionId} table={table} canFulfill canPay/>)}
        {!tables.some(t=>t.sessionId) && <p className="text-sm text-muted-foreground">No active tables.</p>}
      </div>
      <details id="available-tables">
        <summary className="cursor-pointer text-sm">Available tables ({tables.filter(t=>!t.sessionId).length})</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tables.filter(t=>!t.sessionId).map(table=><DiningTableCard key={table.id} table={table}/>)}</div>
      </details>
      {!!requests?.length && <section><h2 className="text-lg font-semibold">Table requests</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{requests.map(request=><WaiterRequestCard key={request.id} request={{id:request.id,type:request.type,tableLabel:(request.restaurant_tables as unknown as {label:string}|null)?.label ?? "—"}}/>)}</div></section>}
      {(orders?.length ?? 0) > 0 && <h2 className="text-lg font-semibold">Active orders without a table</h2>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(orders ?? []).map((order) => (
          <div key={order.id} className="flex flex-col gap-2"><p className="text-sm font-medium">{unassociatedOrderKind(order)}</p>
            {order.payments?.some(p=>p.status === "paid") && <p className="text-xs">Payment recorded · fulfillment still required</p>}
          <KitchenOrderCard
            order={{
              id: order.id,
              order_number: order.order_number,
              status: order.status,
              createdAt: order.created_at,
              order_items: order.order_items,
              tableLabel: null,
            }}
          /></div>
        ))}

      </div>
      <p className="text-xs text-muted-foreground">Served and completed orders remain in Owner Orders history. Unassigned orders marked for review have no reliable table association; ask management to review them.</p>
    </div>
  );
}
