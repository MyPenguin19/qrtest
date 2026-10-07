"use server";

import { revalidatePath } from "next/cache";
import { getCustomerTableContext, signCustomerTab, verifyCustomerTab } from "@/lib/customer-tab";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireCurrentRestaurant } from "@/lib/restaurant";
import { requireStaffSession } from "@/lib/staff-session";

export async function joinDiningTable(
  restaurant: string,
  branch: string,
  table: string,
  device: string,
  existingToken?: string,
) {
  const context = await getCustomerTableContext(restaurant, branch, table);
  if (!context)
    return { error: "This table is unavailable. Please ask staff." };
  const previous = existingToken ? verifyCustomerTab(existingToken) : null;
  if (existingToken && (!previous || previous.restaurantId !== context.restaurant.id || previous.branchId !== context.branch.id || previous.tableId !== table))
    return {error:"This visit does not match your table."};
  const { data, error } = await createAdminClient().rpc("dining_join", {
    p_restaurant: context.restaurant.id,
    p_branch: context.branch.id,
    p_table: table,
    p_device: device,
    p_expected_session: previous?.sessionId ?? null,
  });
  if (error) return { error: error.message };
  return {
    token: signCustomerTab({
      ...context.identity,
      sessionId: data.sessionId,
      customerSessionId: data.customerSessionId,
    }),
  };
}

export async function changeDiningSession(input: {
  tableId: string;
  sessionId: string;
  action: string;
  owner?: boolean;
  attemptKey?: string;
  method?: string;
  closureReason?: "external_manual" | "manual_unsettled";
}) {
  const admin = createAdminClient();
  let restaurantId: string,
    branchId: string | null = null,
    staffId: string | null = null,
    userId: string | null = null;
  if (input.owner) {
    const owner = await requireCurrentRestaurant();
    if (!["owner", "manager"].includes(owner.role))
      return { error: "Owner or manager access is required." };
    restaurantId = owner.restaurantId;
    const {
      data: { user },
    } = await (await createClient()).auth.getUser();
    userId = user!.id;
  } else {
    const staff = await requireStaffSession();
    restaurantId = staff.restaurantId;
    branchId = staff.branchId;
    staffId = staff.staffId;
  }
  const { data: table } = await admin
    .from("restaurant_tables")
    .select("branch_id, branches!inner(restaurant_id)")
    .eq("id", input.tableId)
    .eq("branches.restaurant_id", restaurantId)
    .maybeSingle();
  if (!table || (branchId && table.branch_id !== branchId))
    return { error: "Table not found." };
  const { error } = input.action === "manual_close"
    ? await admin.rpc("dining_manual_close", {
      p_restaurant: restaurantId, p_branch: table.branch_id, p_table: input.tableId,
      p_session: input.sessionId, p_staff: staffId, p_user: userId,
      p_reason: input.closureReason ?? "external_manual",
    })
    : await admin.rpc("dining_transition", {
    p_restaurant: restaurantId,
    p_branch: table.branch_id,
    p_table: input.tableId,
    p_session: input.sessionId,
    p_action: input.action,
    p_staff: staffId,
    p_user: userId,
    p_attempt: input.attemptKey ?? null,
    p_method: input.method ?? "cash",
  });
  if (error) return { error: error.message };
  for (const path of [
    "/staff/orders",
    "/staff/cashier",
    "/dashboard/tables",
    "/dashboard/orders",
  ])
    revalidatePath(path);
  return { error: null };
}


export async function chooseCounterPayment(restaurant: string, branch: string, table: string, token: string) {
  const identity = verifyCustomerTab(token);
  if (!identity?.customerSessionId) return { error: "Open your table menu before choosing payment." };
  const context = await getCustomerTableContext(restaurant, branch, table);
  if (!context || identity.restaurantId !== context.restaurant.id || identity.branchId !== context.branch.id || identity.tableId !== table)
    return { error: "This payment choice does not match your table." };
  const {error} = await createAdminClient().rpc("dining_counter_intent", {
    p_restaurant: identity.restaurantId, p_branch: identity.branchId, p_table: identity.tableId,
    p_session: identity.sessionId, p_customer_session: identity.customerSessionId,
  });
  if(error) return {error:error.message};
  for(const path of ["/staff/orders", "/staff/cashier", "/dashboard/tables"])
    revalidatePath(path);
  return {error:null};
}
