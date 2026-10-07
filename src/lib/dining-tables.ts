import { createAdminClient } from "@/lib/supabase/admin";
import { diningTableView, tablePriority, type DiningTableRow } from "@/lib/dining-view";
export type { DiningTable } from "@/lib/dining-view";

export async function getDiningTables(restaurantId: string, branchId?: string | null) {
  let query = createAdminClient().from("restaurant_tables")
    .select("id, label, status, branch_id, branches!inner(restaurant_id, name), table_sessions(id, status, opened_at, payment_intent, orders(id, order_number, status, total_amount, created_at, order_items(id, item_name, variant_name, quantity, special_instructions)), bills(id, payments(attempt_key, status, method)))")
    .eq("branches.restaurant_id", restaurantId)
    // Filter the embedded visits without excluding available parent tables.
    .neq("table_sessions.status", "closed")
    .order("label");
  if (branchId) query = query.eq("branch_id", branchId);
  const {data,error} = await query;
  if (error) throw new Error("Could not load tables.");
  return ((data??[]) as unknown as DiningTableRow[]).map(diningTableView)
    .sort((a,b)=>tablePriority(a)-tablePriority(b)||a.label.localeCompare(b.label,undefined,{numeric:true})||a.branchName.localeCompare(b.branchName));
}
