import { createHmac, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
export type TabIdentity = { restaurantId: string; branchId: string; tableId: string; sessionId: string };

// Separate signing purpose from staff cookies; this grants access only to one tab.
function signature(payload: string) {
  const secret = process.env.STAFF_SESSION_SECRET;
  if (!secret) throw new Error("STAFF_SESSION_SECRET is not configured");
  return createHmac("sha256", secret).update(`customer-tab:${payload}`).digest("base64url");
}

export function signCustomerTab(identity: TabIdentity) {
  const payload = Buffer.from(JSON.stringify(identity)).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifyCustomerTab(token: string | undefined): TabIdentity | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, supplied] = parts;
  const a = Buffer.from(supplied), b = Buffer.from(signature(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const identity = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return [identity.restaurantId, identity.branchId, identity.tableId, identity.sessionId]
      .every((value) => typeof value === "string" && value.length > 0) ? identity : null;
  } catch { return null; }
}

export async function findActiveTableSession(admin: AdminClient, tableId: string) {
  const { data, error } = await admin.from("table_sessions")
    .select("id, table_id, status")
    .eq("table_id", tableId)
    .in("status", ["open", "bill_requested"])
    .maybeSingle();
  // Never treat a query failure/multiple existing sessions as permission to create another.
  if (error) throw new Error("Could not identify the active table session. Please ask staff.");
  return data;
}

export async function validateCustomerTab(
  admin: AdminClient,
  token: string,
  expected: Omit<TabIdentity, "sessionId">,
) {
  const identity = verifyCustomerTab(token);
  if (!identity || identity.restaurantId !== expected.restaurantId ||
      identity.branchId !== expected.branchId || identity.tableId !== expected.tableId) return null;
  const session = await findActiveTableSession(admin, expected.tableId);
  return session?.id === identity.sessionId ? session : null;
}

export async function getCustomerTableContext(restaurantSlug: string, branchSlug: string, tableId: string) {
  const admin = createAdminClient();
  const { data: restaurant } = await admin.from("restaurants").select("id, name")
    .eq("slug", restaurantSlug).eq("status", "active").maybeSingle();
  if (!restaurant) return null;
  const { data: branch } = await admin.from("branches").select("id")
    .eq("restaurant_id", restaurant.id).eq("slug", branchSlug).eq("is_active", true).maybeSingle();
  if (!branch) return null;
  const { data: table } = await admin.from("restaurant_tables").select("id, label")
    .eq("branch_id", branch.id).eq("id", tableId).maybeSingle();
  if (!table) return null;
  return { restaurant, branch, table, identity: {restaurantId: restaurant.id, branchId: branch.id, tableId: table.id} };
}

export function customerTabUrl(restaurant: string, branch: string, table: string, token: string) {
  return `/menu/${encodeURIComponent(restaurant)}/${encodeURIComponent(branch)}/${encodeURIComponent(table)}/tab?session=${encodeURIComponent(token)}`;
}

export function tabTotal(orders: {status: string; total_amount: number}[]) {
  return Math.round(orders.filter((order) => order.status !== "cancelled")
    .reduce((sum, order) => sum + Number(order.total_amount), 0) * 100) / 100;
}

export async function getCustomerTab(restaurantSlug: string, branchSlug: string, tableId: string, token: string) {
  const context = await getCustomerTableContext(restaurantSlug, branchSlug, tableId);
  if (!context) return null;
  const admin = createAdminClient();
  const session = await validateCustomerTab(admin, token, context.identity);
  if (!session) return null;
  const { data: orders, error } = await admin.from("orders")
    .select("id, order_number, status, total_amount, created_at, order_items(id, item_name, variant_name, quantity)")
    .eq("restaurant_id", context.restaurant.id).eq("branch_id", context.branch.id)
    .eq("table_session_id", session.id).order("created_at").order("order_number");
  if (error) throw new Error("Could not load your tab. Please try again.");
  return { ...context, session, orders: orders ?? [], total: tabTotal(orders ?? []) };
}
