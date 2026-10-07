import { createHmac, timingSafeEqual } from "node:crypto";

import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;
export type TabIdentity = { restaurantId: string; branchId: string; tableId: string; sessionId: string; customerSessionId?: string };

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
    .in("status", ["open", "bill_requested", "payment_pending", "paid"])
    .maybeSingle();
  // Never treat a query failure/multiple existing sessions as permission to create another.
  if (error) throw new Error("Could not identify the active table session. Please ask staff.");
  return data;
}

export async function validateCustomerTab(
  admin: AdminClient,
  token: string,
  expected: Omit<TabIdentity, "sessionId" | "customerSessionId">,
) {
  const identity = verifyCustomerTab(token);
  if (!identity || identity.restaurantId !== expected.restaurantId ||
      identity.branchId !== expected.branchId || identity.tableId !== expected.tableId) return null;
  const session = await findActiveTableSession(admin, expected.tableId);
  return session?.id === identity.sessionId ? session : null;
}

export async function getCustomerTableContext(restaurantSlug: string, branchSlug: string, tableId: string, includeUnavailable = false) {
  const admin = createAdminClient();
  let restaurantQuery = admin.from("restaurants").select("id, name, status").eq("slug", restaurantSlug);
  if (!includeUnavailable) restaurantQuery = restaurantQuery.eq("status", "active");
  const {data: restaurant} = await restaurantQuery.maybeSingle();
  if (!restaurant) return null;
  let branchQuery = admin.from("branches").select("id, is_active").eq("restaurant_id", restaurant.id).eq("slug", branchSlug);
  if (!includeUnavailable) branchQuery = branchQuery.eq("is_active", true);
  const {data: branch} = await branchQuery.maybeSingle();
  if (!branch) return null;
  let tableQuery = admin.from("restaurant_tables").select("id, label, is_active").eq("branch_id", branch.id).eq("id", tableId);
  if (!includeUnavailable) tableQuery = tableQuery.eq("is_active", true);
  const {data: table} = await tableQuery.maybeSingle();
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
  const context = await getCustomerTableContext(restaurantSlug, branchSlug, tableId, true);
  if (!context) return null;
  const admin = createAdminClient();
  const identity = verifyCustomerTab(token);
  if (!identity || identity.restaurantId !== context.restaurant.id || identity.branchId !== context.branch.id || identity.tableId !== tableId) return null;
  const {data: session} = await admin.from("table_sessions").select("id, status, payment_intent").eq("id", identity.sessionId).eq("table_id", tableId).maybeSingle();
  if (!session) return null;
  if (session.status === "closed") return {...context, session, orders: [], total: 0};
  if (context.restaurant.status !== "active" || !context.branch.is_active || !context.table.is_active) return null;
  const { data: orders, error } = await admin.from("orders")
    .select("id, order_number, status, total_amount, created_at, order_items(id, item_name, variant_name, quantity)")
    .eq("restaurant_id", context.restaurant.id).eq("branch_id", context.branch.id)
    .eq("table_session_id", session.id).order("created_at").order("order_number");
  if (error) throw new Error("Could not load your tab. Please try again.");
  return { ...context, session, orders: orders ?? [], total: tabTotal(orders ?? []) };
}
