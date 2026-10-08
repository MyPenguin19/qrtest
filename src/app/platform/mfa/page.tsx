import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlatformMfa } from "@/components/platform/platform-mfa";
export default async function PlatformMfaPage() {
  const client = await createClient();
  const {data,error} = await client.auth.getUser();
  if(error || !data.user) redirect("/platform/login");
  if(data.user.is_anonymous || !data.user.email_confirmed_at) redirect("/platform/access-denied");
  return <main className="mx-auto max-w-md space-y-4 p-6"><h1 className="text-2xl font-semibold">Verify MFA</h1><p>Verify your authenticator before accessing platform administration. Enrollment secures your own account; it does not grant platform access.</p><PlatformMfa /></main>;
}
