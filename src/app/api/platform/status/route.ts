import { platformAccess } from "@/lib/platform-admin";
export async function GET() {
  const access = await platformAccess();
  const status = access.status === "allowed" ? 200 : access.status === "unauthenticated" ? 401 : access.status === "unavailable" ? 503 : 403;
  return Response.json({ authorized: access.status === "allowed" }, { status, headers: { "Cache-Control": "private, no-store" } });
}
