import "server-only";
import { createClient } from "@/lib/supabase/server";
/** Public-safe availability only; never returns internal account-control metadata. */
export async function accountAvailable(restaurantId:string) {
 const {data,error}=await (await createClient()).rpc("restaurant_account_available",{p_id:restaurantId});
 if(error) throw new Error("Could not check restaurant availability. Please retry.");
 return data===true;
}
