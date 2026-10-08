import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/platform-admin";

export default async function LegacyAdminPage() {
  await requirePlatformAdmin();
  redirect("/platform");
}
