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

  if (order.table_session_id) {
    const {error: tableError} = await admin.rpc("dining_refresh_table", {p_session: order.table_session_id});
    if (tableError) throw new Error("Order served, but the table display could not refresh. Please refresh the screen.");
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

/** Compatibility entry point: confirmation requires an existing pending attempt. */
export async function markBillPaid(billId: string, method: "cash" | "upi" | "card") {
  const staff = await requireStaffSession("cashier");
  const admin = createAdminClient();
  let query = admin.from("bills").select("table_session_id, branch_id, table_sessions(table_id)").eq("id", billId).eq("restaurant_id", staff.restaurantId);
  if (staff.branchId) query = query.eq("branch_id", staff.branchId);
  const {data: bill} = await query.maybeSingle();
  if (!bill) throw new Error("Bill not found.");
  const {data: payment} = await admin.from("payments").select("attempt_key").eq("bill_id", billId).eq("status", "pending").eq("method", method).maybeSingle();
  if (!payment?.attempt_key) throw new Error("Start payment first, then confirm only after payment is received.");
  const {error} = await admin.rpc("dining_transition", {p_restaurant: staff.restaurantId, p_branch: bill.branch_id,
    p_table: (bill.table_sessions as unknown as {table_id:string}).table_id, p_session: bill.table_session_id,
    p_action: "confirm_payment", p_staff: staff.staffId, p_attempt: payment.attempt_key, p_method: method});
  if (error) throw new Error(error.message);
  revalidatePath("/staff/cashier");
}
