"use server";
import { revalidatePath } from "next/cache";
import { requireCurrentRestaurant } from "@/lib/restaurant";
import { hashPin, validNewPin } from "@/lib/staff-pin";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
export type StaffActionState = { error: string | null; success?: boolean };

export async function manageStaff(_prev: StaffActionState, form: FormData): Promise<StaffActionState> {
  const restaurant = await requireCurrentRestaurant();
  if (!["owner","manager"].includes(restaurant.role)) return {error:"Management access required."};
  const {data:{user}} = await (await createClient()).auth.getUser();
  if (!user) return {error:"Sign in again."};
  const action = String(form.get("action") ?? "add");
  const pin = String(form.get("pin") ?? "");
  const access = String(form.get("access") ?? "staff");
  if ((pin || action === "reset_pin" || (action === "add" && access === "staff")) && !validNewPin(pin))
    return {error:"Use 6–8 digits. Avoid repeated digits and sequences."};
  const {error} = await createAdminClient().rpc("manage_staff",{
    p_actor:user.id,p_restaurant:restaurant.restaurantId,p_action:action,
    p_staff:String(form.get("staffId") ?? "") || null,p_name:String(form.get("name") ?? "").trim(),
    p_branch:String(form.get("branchId") ?? "") || null,p_access:access,
    p_pin_hash:pin ? hashPin(pin) : null,p_email:String(form.get("email") ?? "").trim(),
  });
  if(error) return {error:error.message};
  revalidatePath("/dashboard/staff");
  return {error:null,success:true};
}
export async function addStaff(prev: StaffActionState, form: FormData) {
  form.set("action","add");
  return manageStaff(prev,form);
}
