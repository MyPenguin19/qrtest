"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireStaffSession } from "@/lib/staff-session";

const ORDER_NEXT_STATUS: Record<string, string> = {
  pending: "preparing",
  accepted: "preparing",
  preparing: "ready",
};

export async function advanceOrderStatus(orderId: string, expectedStatus: string) {
  const session = await requireStaffSession();
  const admin = createAdminClient();

  let query = admin
    .from("orders")
    .select("id, status, restaurant_id")
    .eq("id", orderId)
    .eq("restaurant_id", session.restaurantId);
  if (session.branchId) query = query.eq("branch_id", session.branchId);
  const { data: order } = await query.maybeSingle();

  if (!order || order.status !== expectedStatus) return;

  const nextStatus = ORDER_NEXT_STATUS[order.status];
  if (!nextStatus) return;

  const { data: updated, error } = await admin.from("orders")
    .update({ status: nextStatus }).eq("id", orderId)
    .eq("restaurant_id", session.restaurantId).eq("status", order.status)
    .select("id").maybeSingle();
  if (error) throw new Error("Could not update the order. Please try again.");
  if (!updated) return;
  await admin.from("order_status_history").insert({
    order_id: orderId,
    status: nextStatus,
    changed_by_staff_id: session.staffId,
  });

  revalidatePath("/staff/kitchen");
  revalidatePath("/staff/orders");
}

/**
 * Operational staff serve a ready order without closing its table session.
 */
export async function markOrderServed(orderId: string) {
  const session = await requireStaffSession();
  const admin = createAdminClient();

  let query = admin
    .from("orders")
    .select("id, status, table_session_id")
    .eq("id", orderId)
    .eq("restaurant_id", session.restaurantId)
    .eq("status", "ready");
  if (session.branchId) query = query.eq("branch_id", session.branchId);
  const { data: order } = await query.maybeSingle();

  if (!order) return;

  const { data: updated, error } = await admin.from("orders")
    .update({ status: "served" }).eq("id", orderId)
    .eq("restaurant_id", session.restaurantId).eq("status", "ready")
    .select("id").maybeSingle();
  if (error) throw new Error("Could not serve the order. Please try again.");
  if (!updated) return;
  await admin.from("order_status_history").insert({
    order_id: orderId,
    status: "served",
    changed_by_staff_id: session.staffId,
  });

  // Reflect it on the floor plan: the table is occupied and eating rather
  // than waiting on the kitchen.
  if (order.table_session_id) {
    const { data: tableSession } = await admin
      .from("table_sessions")
      .select("table_id, status")
      .eq("id", order.table_session_id)
      .maybeSingle();

    if (tableSession?.table_id && tableSession.status === "open") {
      await admin
        .from("restaurant_tables")
        .update({ status: "occupied" })
        .eq("id", tableSession.table_id);
    }
  }

  revalidatePath("/staff/waiter");
  revalidatePath("/staff/orders");
}

export async function resolveWaiterRequest(requestId: string) {
  const session = await requireStaffSession("waiter");
  const admin = createAdminClient();

  await admin
    .from("waiter_requests")
    .update({ resolved_at: new Date().toISOString(), resolved_by_staff_id: session.staffId })
    .eq("id", requestId)
    .eq("branch_id", session.branchId ?? "");

  revalidatePath("/staff/waiter");
}

export async function markBillPaid(billId: string, method: "cash" | "upi" | "card") {
  const session = await requireStaffSession("cashier");
  const admin = createAdminClient();

  const { data: bill } = await admin
    .from("bills")
    .select("id, total_amount, restaurant_id, table_session_id")
    .eq("id", billId)
    .eq("restaurant_id", session.restaurantId)
    .single();

  if (!bill) return;

  await admin
    .from("bills")
    .update({ status: "paid", closed_at: new Date().toISOString() })
    .eq("id", billId);

  await admin.from("payments").insert({
    restaurant_id: session.restaurantId,
    bill_id: billId,
    method,
    status: "paid",
    amount: bill.total_amount,
    recorded_by_staff_id: session.staffId,
  });

  if (bill.table_session_id) {
    // Payment is the end of the lifecycle: everything still open on this
    // table session becomes "completed", otherwise orders would linger as
    // served/ready forever and skew the dashboard's pending count.
    const { data: openOrders } = await admin
      .from("orders")
      .select("id")
      .eq("table_session_id", bill.table_session_id)
      .not("status", "in", "(completed,cancelled)");

    if (openOrders && openOrders.length > 0) {
      const ids = openOrders.map((o) => o.id);
      await admin.from("orders").update({ status: "completed" }).in("id", ids);
      await admin.from("order_status_history").insert(
        ids.map((id) => ({
          order_id: id,
          status: "completed",
          changed_by_staff_id: session.staffId,
        })),
      );
    }

    const { data: tableSession } = await admin
      .from("table_sessions")
      .select("table_id")
      .eq("id", bill.table_session_id)
      .maybeSingle();

    await admin
      .from("table_sessions")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", bill.table_session_id);

    // Free the table for the next guests.
    if (tableSession?.table_id) {
      await admin
        .from("restaurant_tables")
        .update({ status: "cleaning" })
        .eq("id", tableSession.table_id);
    }
  }

  revalidatePath("/staff/cashier");
}
