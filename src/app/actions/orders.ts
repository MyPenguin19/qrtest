"use server";

import {
  customerTabUrl,
  getCustomerTableContext,
  verifyCustomerTab,
} from "@/lib/customer-tab";
import { createAdminClient } from "@/lib/supabase/admin";

export type PlaceOrderLine = {
  itemId: string;
  variantId: string | null;
  addonIds: string[];
  quantity: number;
  specialInstructions: string;
};
export type PlaceOrderInput = {
  restaurantSlug: string;
  branchSlug: string;
  tableId?: string;
  tableSessionToken?: string;
  submissionKey: string;
  lines: PlaceOrderLine[];
  couponCode?: string;
  customerName?: string;
  customerPhone?: string;
};
export type PlaceOrderResult =
  | { orderId: string; orderNumber: number; tabUrl?: string }
  | { error: string };

export async function placeOrder(
  input: PlaceOrderInput,
): Promise<PlaceOrderResult> {
  if (!input.lines?.length) return { error: "Cart is empty." };
  if (!/^[0-9a-f-]{36}$/i.test(input.submissionKey ?? ""))
    return { error: "Reload your cart before submitting." };
  const admin = createAdminClient();
  let restaurantId: string, branchId: string;
  const identity = verifyCustomerTab(input.tableSessionToken);
  if (input.tableId) {
    const context = await getCustomerTableContext(
      input.restaurantSlug,
      input.branchSlug,
      input.tableId,
    );
    if (!context) return { error: "This table is unavailable." };
    if (
      !identity?.customerSessionId ||
      identity.restaurantId !== context.restaurant.id ||
      identity.branchId !== context.branch.id ||
      identity.tableId !== input.tableId
    ) {
      return { error: "Open this table's menu again before ordering." };
    }
    restaurantId = context.restaurant.id;
    branchId = context.branch.id;
    // The transaction checks active status, or returns an already-saved retry.
  } else {
    if (input.tableSessionToken)
      return { error: "A table is required for this visit." };
    const { data: restaurant } = await admin
      .from("restaurants")
      .select("id")
      .eq("slug", input.restaurantSlug)
      .eq("status", "active")
      .maybeSingle();
    if (!restaurant) return { error: "Restaurant not found." };
    const { data: branch } = await admin
      .from("branches")
      .select("id")
      .eq("restaurant_id", restaurant.id)
      .eq("slug", input.branchSlug)
      .eq("is_active", true)
      .maybeSingle();
    if (!branch) return { error: "Branch not found." };
    restaurantId = restaurant.id;
    branchId = branch.id;
  }
  const { data, error } = await admin.rpc("dining_submit", {
    p_restaurant: restaurantId,
    p_branch: branchId,
    p_table: input.tableId ?? null,
    p_session: identity?.sessionId ?? null,
    p_customer_session: identity?.customerSessionId ?? null,
    p_submission: input.submissionKey,
    p_payload: {
      lines: input.lines,
      couponCode: input.couponCode ?? "",
      customerName: input.customerName ?? "",
      customerPhone: input.customerPhone ?? "",
    },
  });
  if (error) return { error: error.message };
  return {
    ...data,
    tabUrl:
      input.tableId && input.tableSessionToken
        ? customerTabUrl(
            input.restaurantSlug,
            input.branchSlug,
            input.tableId,
            input.tableSessionToken,
          )
        : undefined,
  };
}
