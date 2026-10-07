import { createAdminClient } from "@/lib/supabase/admin";
export async function getDiningTables(
  restaurantId: string,
  branchId?: string | null,
) {
  let query = createAdminClient()
    .from("restaurant_tables")
    .select(
      "id, label, status, branch_id, branches!inner(restaurant_id), table_sessions(id, status, opened_at, payment_intent, orders(id, order_number, status, total_amount), bills(id, payments(attempt_key, status, method)))",
    )
    .eq("branches.restaurant_id", restaurantId)
    .order("label");
  if (branchId) query = query.eq("branch_id", branchId);
  const { data, error } = await query;
  if (error) throw new Error("Could not load tables.");
  return (data ?? []).map((table) => {
    const session = table.table_sessions.find((s) => s.status !== "closed");
    const payment = session?.bills
      .flatMap((b) => b.payments)
      .find((p) => p.status === "pending");
    return {
      id: table.id,
      label: table.label,
      status: table.status,
      sessionId: session?.id ?? null,
      sessionStatus: session?.status ?? null,
      paymentIntent: session?.payment_intent ?? null,
      orderCount: session?.orders.length ?? 0,
      total:
        session?.orders
          .filter((o) => o.status !== "cancelled")
          .reduce((n, o) => n + Number(o.total_amount), 0) ?? 0,
      orders:
        session?.orders.map((o) => ({
          number: o.order_number,
          status: o.status,
        })) ?? [],
      attemptKey: payment?.attempt_key ?? null,
      method: payment?.method ?? "cash",
    };
  });
}
export type DiningTable = Awaited<ReturnType<typeof getDiningTables>>[number];
