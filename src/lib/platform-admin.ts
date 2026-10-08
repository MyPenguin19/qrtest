import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type PlatformAccess =
  | { status: "allowed"; userId: string; email: string }
  | { status: "unauthenticated" | "denied" | "mfa_required" | "unavailable" };

/** Fresh Auth and database checks on every request; no layout/cookie role trust. */
export async function platformAccess(): Promise<PlatformAccess> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return { status: "unauthenticated" };
    if (data.user.is_anonymous || !data.user.email_confirmed_at || !data.user.email) return { status: "denied" };
    // The RPC independently verifies the caller's JWT, live session, active
    // authorization and AAL2. It accepts no client-supplied user or role.
    const result = await supabase.rpc("platform_admin_status");
    if (result.error) return { status: "unavailable" };
    if (result.data === "allowed") return { status: "allowed", userId: data.user.id, email: data.user.email };
    return { status: result.data === "mfa_required" ? "mfa_required" : "denied" };
  } catch { return { status: "unavailable" }; }
}

export async function requirePlatformAdmin() {
  const access = await platformAccess();
  if (access.status === "allowed") return access;
  if (access.status === "unauthenticated") redirect("/platform/login");
  if (access.status === "mfa_required") redirect("/platform/mfa");
  redirect("/platform/access-denied");
}
