import { redirect } from "next/navigation";
import { requireStaffSession } from "@/lib/staff-session";
export default async function LegacyStaffPage() {
  await requireStaffSession();
  redirect("/staff/orders");
}
