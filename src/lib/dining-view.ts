// Fulfillment remains per order round; items are never merged across submissions.
export type DiningItem = { id: string; item_name: string; variant_name?: string | null; quantity: number; special_instructions?: string | null };
export type DiningRound = { id: string; order_number: number; status: string; created_at: string; total_amount: number; order_items: DiningItem[]; round: number };
export type DiningTable = {
  id: string; label: string; branchId: string; branchName: string; status: string;
  sessionId: string | null; sessionStatus: string | null; openedAt: string | null; ageMinutes: number;
  paymentIntent: string | null; orderCount: number; total: number; orders: DiningRound[];
  attemptKey: string | null; method: string; paymentState?: string | null;
};
export function fulfillmentGroup(status: string) {
  if (["pending", "accepted", "preparing"].includes(status)) return "new";
  if (status === "ready") return "ready";
  if (["served", "completed"].includes(status)) return "completed";
  return "cancelled";
}
export function tableAttention(table: DiningTable) {
  if (!table.sessionId) return "Available";
  if (table.sessionStatus === "paid") return "Paid / Closing";
  if (table.sessionStatus === "payment_pending") return "Payment Pending";
  if (table.paymentState === "failed") return "Payment failed / Retry";
  if (table.paymentIntent === "counter" || table.sessionStatus === "bill_requested") return "Ready to Pay";
  if (table.orders.some(o => fulfillmentGroup(o.status) === "new")) return "New Order";
  if (table.orders.some(o => fulfillmentGroup(o.status) === "ready")) return "Ready";
  return "Open";
}
export function tablePriority(table: DiningTable) {
  const attention = tableAttention(table);
  if (["Ready to Pay", "Payment Pending", "Paid / Closing", "Payment failed / Retry"].includes(attention)) return 0;
  return attention === "New Order" ? 1 : attention === "Ready" ? 2 : attention === "Open" ? 3 : 4;
}
export type DiningTableRow = {
  id: string; label: string; status: string; branch_id: string; branches: {name: string};
  table_sessions: {id: string; status: string; opened_at: string; payment_intent: string | null;
    orders: Omit<DiningRound, "round">[];
    bills: {payments: {attempt_key: string | null; status: string; method: string; created_at?:string}[]}[];
  }[];
};
export function diningTableView(table: DiningTableRow): DiningTable {
  const active = table.table_sessions.filter(s => s.status !== "closed");
  if (active.length > 1) throw new Error("A table has multiple active visits. Please contact support.");
  const session = active[0];
  const orders = [...(session?.orders ?? [])].sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.order_number-b.order_number).map((o,i)=>({...o,round:i+1}));
  const attempts = session?.bills.flatMap(b=>b.payments) ?? [];
  const payment = attempts.find(p=>p.status === "pending");
  const latest = [...attempts].sort((a,b)=>(b.created_at??"").localeCompare(a.created_at??""))[0];
  return {
    id:table.id,label:table.label,branchId:table.branch_id,branchName:table.branches.name,
    status:session ? table.status : "available", sessionId:session?.id??null,sessionStatus:session?.status??null,
    openedAt:session?.opened_at??null,ageMinutes:session?Math.max(0,Math.floor((Date.now()-new Date(session.opened_at).getTime())/60000)):0,paymentIntent:session?.payment_intent??null,orderCount:orders.length,
    total:Math.round(orders.filter(o=>o.status!=="cancelled").reduce((n,o)=>n+Number(o.total_amount),0)*100)/100,
    paymentState:payment?"pending":session?.status === "bill_requested" && latest?.status === "failed"?"failed":null,
    orders,attemptKey:payment?.attempt_key??null,method:payment?.method??"cash",
  };
}
