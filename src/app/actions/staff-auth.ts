"use server";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentStaffTokenHash, staffTokenHash, STAFF_SESSION_COOKIE } from "@/lib/staff-session";
import { verifyPin } from "@/lib/staff-pin";

export type StaffLoginState = { error: string | null };
export async function lookupRestaurant(code: string) {
  const slug = code.trim().toLowerCase();
  if (!slug || slug.length > 100) return { error: "Enter your restaurant code." };
  const admin = createAdminClient();
  const { data: restaurant } = await admin.from("restaurants").select("id, slug, name")
    .eq("slug", slug).eq("status", "active").maybeSingle();
  if (!restaurant) return { error: "Restaurant not found." };
  // Only the minimum public directory needed to choose a person. Never select hashes.
  const { data: staff, error } = await admin.from("staff").select("id, name")
    .eq("restaurant_id", restaurant.id).eq("is_active", true)
    .in("role", ["staff", "waiter", "kitchen", "cashier"]).order("name");
  if (error) return { error: "Staff access is unavailable. Ask your manager." };
  return { slug: restaurant.slug as string, name: restaurant.name as string, staff: (staff ?? []).map(member=>({id:String(member.id),name:String(member.name)})) };
}
export async function staffLogin(_prev: StaffLoginState, form: FormData): Promise<StaffLoginState> {
  const slug = String(form.get("restaurantSlug") ?? "").trim().toLowerCase();
  const id = String(form.get("staffId") ?? "");
  const pin = String(form.get("pin") ?? "");
  const denied = { error: "Unable to sign in. Check your name and PIN, or try again in 15 minutes." };
  if (!slug || slug.length > 100 || !/^[a-f0-9-]{36}$/i.test(id) || !/^\d{4,8}$/.test(pin)) return denied;
  const admin = createAdminClient();
  const {data: candidate,error} = await admin.rpc("staff_login_begin", {p_slug:slug,p_staff:id});
  if (error || !candidate || candidate.locked || !verifyPin(pin,candidate.pin_hash)) return denied;
  const token = randomBytes(32).toString("hex");
  const {data: granted,error: finishError} = await admin.rpc("staff_login_finish", {
    p_slug:slug,p_staff:id,p_version:candidate.auth_version,p_pin_hash:candidate.pin_hash,p_token_hash:staffTokenHash(token),
  });
  if (finishError || !granted) return denied;
  (await cookies()).set(STAFF_SESSION_COOKIE,token,{httpOnly:true,sameSite:"lax",secure:true,path:"/",maxAge:12*60*60});
  redirect("/staff/orders");
}
export async function staffActivity() {
  const token = await currentStaffTokenHash();
  if (!token) return {expired:true};
  const {data,error} = await createAdminClient().rpc("staff_session_check",{p_token_hash:token,p_touch:true});
  return {expired:!!error || !data};
}
export async function staffLogout() {
  const token = await currentStaffTokenHash();
  if (token) {
    const {error} = await createAdminClient().from("staff_sessions").update({revoked_at:new Date().toISOString()}).eq("token_hash",token);
    if (error) throw new Error("Could not revoke this session. Please retry sign out.");
  }
  (await cookies()).delete(STAFF_SESSION_COOKIE);
  redirect("/staff");
}
