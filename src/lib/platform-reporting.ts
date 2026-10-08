import "server-only";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createClient } from "@/lib/supabase/server";
import { reportOptions, type SearchValues } from "@/lib/platform-report-options";

export type Trend = {day:string;signups:number;orders:number;active_restaurants:number;total_restaurants:number};
export type RestaurantFact = {
  id:string;name:string;slug:string;owner_email:string|null;created_at:string;status:string;
  branches:number;active_branches:number;tables:number;dine_in_tables:number;categories:number;
  menu_items:number;available_items:number;staff_accounts:number;orders:number;cancelled_orders:number;
  qualifying_orders:number;previous_orders:number;first_order:string|null;last_order:string|null;
  order_value:number;ready:boolean;readiness:string;
};
export type Period = {start:string;end:string;inactivity_days:number};
export type Overview = Period & {
  total_restaurants:number;active_restaurants:number;new_restaurants:number;orders:number;cancelled_orders:number;
  needs_setup:number;active_visits:number;inactive_restaurants:number;repeat_active:number;activated_restaurants:number;
  first_activations:number;new_cohort_activated:number;activation_rate:number|null;average_activation_hours:number|null;
  invalid_activation_timestamps:number;tables:number;menu_items:number;staff_accounts:number;average_orders_per_active:number|null;
  recent_restaurants:Pick<RestaurantFact,"id"|"name"|"slug"|"created_at"|"readiness">[];trend:Trend[];
};
export type Directory = Period & {total:number;page:number;size:number;rows:RestaurantFact[]};
export type Detail = RestaurantFact & Period & {
  currency:null;timezone:null;active_visits:number;staff_recorded_amount:number;staff_recorded_count:number;legacy_paid_count:number;
  fallback_timestamp_count:number;last_recorded_payment:string|null;last_visit:string|null;last_completed_order:string|null;
  last_menu_update:string|null;trend:Trend[];
};
async function report<T>(name:string,parameters:Record<string,unknown>):Promise<T> {
  // Each data operation checks the existing guard; each RPC checks it again in
  // the database. No service client, user-supplied table or SQL query is exposed.
  await requirePlatformAdmin();
  try {
    const client=await createClient();
    const {data,error}=await client.rpc(name,parameters);
    if(error) throw new Error("report unavailable");
    return data as T;
  } catch { throw new Error("Platform reporting is unavailable. Please retry."); }
}
export function getPlatformOverview(search:SearchValues) {
  return report<Overview>("platform_overview",{p_days:reportOptions(search).days});
}
export function getPlatformRestaurants(search:SearchValues) {
  const o=reportOptions(search);
  return report<Directory>("platform_restaurants",{p_days:o.days,p_page:o.page,p_size:o.size,p_search:o.search,p_filter:o.filter,p_sort:o.sort});
}
export async function getPlatformRestaurant(id:string,search:SearchValues) {
  // Validate identifiers after authorization, including malformed direct URLs.
  await requirePlatformAdmin();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return report<Detail|null>("platform_restaurant_detail",{p_id:id,p_days:reportOptions(search).days});
}
