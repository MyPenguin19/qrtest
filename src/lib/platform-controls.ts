import "server-only";
import { requirePlatformAdmin } from "@/lib/platform-admin";
import { createClient } from "@/lib/supabase/server";
export type AccountControl = {suspended:boolean;version:number;changed_at:string|null;changed_by:string|null;reason:string|null;recent_mfa:boolean;historical_orders:number;setup_ready:boolean;blockers:Record<string,number>};
export type AuditRow = {id:string;created_at:string;actor_user_id:string|null;action:string;target_type:string;target_id:string|null;result:string;request_id:string;previous_state:unknown;new_state:unknown;reason:string|null;code:string|null};
export type AuditPage = {total:number;page:number;size:number;rows:AuditRow[]};
export const REASONS = {security_review:"Security review",operational_request:"Operational request",review_resolved:"Review resolved"};
export async function getRestaurantControl(id:string) {
  await requirePlatformAdmin();
  const {data,error}=await (await createClient()).rpc("platform_restaurant_control",{p_id:id});
  if(error) throw new Error("Account controls are unavailable. Please retry.");
  return data as AccountControl|null;
}
export async function getControlsSummary() {
  await requirePlatformAdmin();
  const {data,error}=await (await createClient()).rpc("platform_controls_summary");
  if(error) throw new Error("Platform controls are unavailable. Please retry.");
  return data as {active_admins:number;suspended_accounts:number;recent_mfa:boolean};
}
export async function getAudit(params:Record<string,unknown>) {
  await requirePlatformAdmin();
  const {data,error}=await (await createClient()).rpc("platform_audit",params);
  if(error) throw new Error("Audit records are unavailable. Check your filters and retry.");
  return data as AuditPage;
}
