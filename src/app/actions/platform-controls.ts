"use server";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
export async function changeRestaurantAccount(input:{restaurantId:string;suspend:boolean;reason:string;confirmed:boolean;version:number;requestId:string}) {
  await requirePlatformAdmin();
  const {data,error}=await (await createClient()).rpc("platform_set_restaurant_account",{
    p_id:input.restaurantId,p_suspend:input.suspend,p_reason:input.reason,p_confirm:input.confirmed,
    p_expected_version:input.version,p_request:input.requestId,
  });
  if(error) return {code:"unavailable"};
  revalidatePath("/platform","layout");
  return {code:String(data?.code??"unavailable")};
}
