import type { createAdminClient } from "@/lib/supabase/admin";

// Shared by table assistance and additional rounds on an already-requested bill.
export async function raiseBillForTable(
  admin: ReturnType<typeof createAdminClient>,
  branchId: string,
  tableId: string,
  restaurantId: string,
  expectedSessionId?: string,
) {
  const { data: session } = await admin
    .from("table_sessions")
    .select("id, status")
    .eq("table_id", tableId)
    .in("status", ["open", "bill_requested"])
    .maybeSingle();

  if (!session || (expectedSessionId && session.id !== expectedSessionId)) {
    return { error: "This tab is no longer active.", notify: false };
  }

  const { data: orders, error: ordersError } = await admin
    .from("orders")
    .select("total_amount")
    .eq("table_session_id", session.id)
    .eq("restaurant_id", restaurantId)
    .eq("branch_id", branchId)
    .neq("status", "cancelled");

  if (ordersError) return {error: "Could not calculate the bill.", notify: false};
  const totalAmount = Math.round((orders ?? []).reduce((sum, o) => sum + Number(o.total_amount), 0) * 100) / 100;

  const { data: existingBill, error: billError } = await admin
    .from("bills")
    .select("id")
    .eq("table_session_id", session.id)
    .neq("status", "paid")
    .maybeSingle();

  if (billError) return {error: "Could not find the bill.", notify: false};
  if (existingBill) {
    const { error } = await admin
      .from("bills")
      .update({ status: "requested", total_amount: totalAmount })
      .eq("id", existingBill.id);
    if (error) return {error: "Could not update the bill.", notify: false};
  } else {
    const { error } = await admin.from("bills").insert({
      restaurant_id: restaurantId,
      branch_id: branchId,
      table_session_id: session.id,
      status: "requested",
      total_amount: totalAmount,
    });
    if (error) return {error: "Could not request the bill.", notify: false};
  }

  const { error } = await admin.from("table_sessions").update({ status: "bill_requested" }).eq("id", session.id)
    .in("status", ["open", "bill_requested"]);
  if (error) return {error: "Could not update the table session.", notify: false};
  await admin.from("restaurant_tables").update({status: "bill_requested"}).eq("id", tableId).eq("branch_id", branchId);
  return {error: null, notify: session.status === "open"};
}
