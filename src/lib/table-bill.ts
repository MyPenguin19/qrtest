import type { createAdminClient } from "@/lib/supabase/admin";
import { findActiveTableSession } from "@/lib/customer-tab";

export async function raiseBillForTable(
  admin: ReturnType<typeof createAdminClient>,
  branchId: string,
  tableId: string,
  restaurantId: string,
  expectedSessionId?: string,
) {
  const session = await findActiveTableSession(admin, tableId);
  if (!session || (expectedSessionId && session.id !== expectedSessionId))
    return { error: "This visit has ended." };
  const { error } = await admin.rpc("dining_request_bill", {
    p_restaurant: restaurantId,
    p_branch: branchId,
    p_table: tableId,
    p_session: session.id,
  });
  // The atomic operation creates the waiter request itself, once.
  return { error: error?.message ?? null };
}
