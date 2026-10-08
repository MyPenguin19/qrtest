import { requirePlatformAdmin } from "@/lib/platform-admin";
import { signOutOwner } from "@/app/actions/auth";
export default async function PlatformPage() {
  const admin = await requirePlatformAdmin();
  return <main className="mx-auto max-w-2xl space-y-5 p-6">
    <h1 className="text-2xl font-semibold">THALIQ — Platform Administration</h1>
    <p>Signed in as: {admin.email}</p><p>Administrator status: Active</p><p>Security: MFA verified</p>
    <ul className="space-y-2"><li>Platform Overview — Coming in 3.5.2</li><li>Restaurants — Coming in 3.5.2</li><li>Analytics — Coming in 3.5.2</li><li>Platform Controls — Coming in 3.5.3</li><li>Audit Logs — Coming in 3.5.3</li></ul>
    <form action={signOutOwner}><button className="rounded border p-3">Sign out</button></form>
  </main>;
}
