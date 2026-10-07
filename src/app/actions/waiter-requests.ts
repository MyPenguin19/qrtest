"use server";

import { raiseBillForTable } from "@/lib/table-bill";
import { getCustomerTableContext, validateCustomerTab } from "@/lib/customer-tab";

import { createAdminClient } from "@/lib/supabase/admin";

const VALID_TYPES = ["call_waiter", "water", "cutlery", "bill", "other"];

export async function requestWaiterAssistance(
  branchId: string,
  tableId: string,
  type: string,
): Promise<{ error: string | null }> {
  if (!VALID_TYPES.includes(type)) {
    return { error: "Invalid request type." };
  }

  const admin = createAdminClient();

  const { data: table } = await admin
    .from("restaurant_tables")
    .select("id, branches(restaurant_id)")
    .eq("id", tableId)
    .eq("branch_id", branchId)
    .maybeSingle();

  if (!table) {
    return { error: "Table not found." };
  }

  if (type === "bill") {
    const result = await raiseBillForTable(admin, branchId, tableId,
      (table.branches as unknown as { restaurant_id: string }).restaurant_id);
    if (result.error || !result.notify) return {error: result.error};
  }
  const { error } = await admin.from("waiter_requests").insert({ branch_id: branchId, table_id: tableId, type });
  return { error: error?.message ?? null };
}

export async function requestTabBill(restaurantSlug: string, branchSlug: string, tableId: string, token: string) {
  const context = await getCustomerTableContext(restaurantSlug, branchSlug, tableId);
  if (!context) return {error: "Table not found."};
  const admin = createAdminClient();
  const session = await validateCustomerTab(admin, token, context.identity);
  if (!session) return {error: "This tab is no longer active or does not match this table."};
  const result = await raiseBillForTable(admin, context.branch.id, tableId, context.restaurant.id, session.id);
  if (!result.error && result.notify) {
    await admin.from("waiter_requests").insert({branch_id: context.branch.id, table_id: tableId, type: "bill"});
  }
  return {error: result.error};
}
