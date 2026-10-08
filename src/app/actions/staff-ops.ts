"use server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentStaffTokenHash, requireStaffSession } from "@/lib/staff-session";
async function orderAction(orderId:string,expected:string,next:string) {
  await requireStaffSession();
  const {error} = await createAdminClient().rpc("staff_order_action",{
    p_token_hash:await currentStaffTokenHash(),p_order:orderId,p_expected:expected,p_next:next,
  });
  if(error) throw new Error(error.message);
  revalidatePath("/staff/orders");
}
export async function advanceOrderStatus(orderId:string,expectedStatus:string) {
  return orderAction(orderId,expectedStatus,"ready");
}
export async function markOrderServed(orderId:string) {
  return orderAction(orderId,"ready","served");
}
export async function resolveWaiterRequest(requestId:string) {
  await requireStaffSession();
  const {error}=await createAdminClient().rpc("staff_resolve_request",{
    p_token_hash:await currentStaffTokenHash(),p_request:requestId,
  });
  if(error) throw new Error("Could not resolve the request.");
  revalidatePath("/staff/orders");
}
/** Retain legacy entry point; a pending identified attempt is required. */
export async function markBillPaid(billId:string,method:"cash"|"upi"|"card") {
  const session=await requireStaffSession();const admin=createAdminClient();
  let query=admin.from("bills").select("table_session_id,branch_id,table_sessions(table_id)").eq("id",billId).eq("restaurant_id",session.restaurantId);
  if(session.branchId)query=query.eq("branch_id",session.branchId);
  const {data:bill}=await query.maybeSingle();
  if(!bill)throw new Error("Bill not found.");
  const {data:payment}=await admin.from("payments").select("attempt_key").eq("bill_id",billId).eq("status","pending").eq("method",method).maybeSingle();
  if(!payment)throw new Error("Record Payment first, then confirm receipt.");
  const {error}=await admin.rpc("staff_table_action",{p_token_hash:await currentStaffTokenHash(),p_table:(bill.table_sessions as unknown as {table_id:string}).table_id,
    p_session:bill.table_session_id,p_action:"confirm_payment",p_attempt:payment.attempt_key,p_method:method});
  if(error)throw new Error(error.message);
  revalidatePath("/staff/orders");
}
