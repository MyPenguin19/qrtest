import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export type StaffSession = {
  staffId: string;
  restaurantId: string;
  branchId: string | null;
  role: "staff";
  name: string;
  restaurantName: string;
  restaurantSlug: string;
};
export const STAFF_SESSION_COOKIE = "thaliq_staff_session";
export function staffTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export async function currentStaffTokenHash(): Promise<string | null> {
  const value = (await cookies()).get(STAFF_SESSION_COOKIE)?.value;
  // Legacy signed cookies intentionally require one fresh PIN sign-in.
  return value && /^[a-f0-9]{64}$/.test(value) ? staffTokenHash(value) : null;
}
/** Legacy route arguments no longer split operational permissions. */
export async function requireStaffSession(_legacyRole?: "waiter" | "kitchen" | "cashier"): Promise<StaffSession> {
  void _legacyRole;
  const token = await currentStaffTokenHash();
  if (!token) redirect("/staff");
  const { data, error } = await createAdminClient().rpc("staff_session_check", { p_token_hash: token });
  if (error || !data) redirect("/staff");
  return data as StaffSession;
}
