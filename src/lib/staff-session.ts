import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";

export type StaffSession = {
  staffId: string;
  restaurantId: string;
  branchId: string | null;
  role: "owner" | "manager" | "waiter" | "kitchen" | "cashier";
  name: string;
};

export const STAFF_SESSION_COOKIE = "thaliq_staff_session";

function secret(): string {
  const value = process.env.STAFF_SESSION_SECRET;
  if (!value) {
    throw new Error("STAFF_SESSION_SECRET is not configured");
  }
  return value;
}

/** Signs a staff session into an opaque cookie value: base64(payload).hmac */
export function signStaffSession(session: StaffSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

/** Verifies and decodes a staff session cookie value. Returns null if invalid. */
export function verifyStaffSession(token: string | undefined): StaffSession | null {
  if (!token) return null;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;

  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

/** A missing role requirement allows order operations, never owner/admin access. */
export async function requireStaffSession(
  expectedRole?: "waiter" | "kitchen" | "cashier",
): Promise<StaffSession> {
  const cookieStore = await cookies();
  const session = verifyStaffSession(cookieStore.get(STAFF_SESSION_COOKIE)?.value);

  if (!session || !["waiter", "kitchen", "cashier"].includes(session.role) ||
      (expectedRole && session.role !== expectedRole)) {
    redirect("/staff");
  }

  // A signed cookie must not outlive a disabled account or a changed assignment.
  const admin = createAdminClient();
  const { data: staff } = await admin.from("staff")
    .select("id, role, branch_id")
    .eq("id", session.staffId)
    .eq("restaurant_id", session.restaurantId)
    .eq("is_active", true)
    .maybeSingle();
  if (!staff || staff.role !== session.role || staff.branch_id !== session.branchId) {
    redirect("/staff");
  }

  return session;
}
