import Link from "next/link";
import { PlatformShell,Metrics } from "@/components/platform/report-ui";
import { getControlsSummary } from "@/lib/platform-controls";
export const dynamic="force-dynamic";
export default async function ControlsPage() {
 const data=await getControlsSummary();
 return <PlatformShell title="Platform Controls"><Metrics items={[["Active provisioned administrators",data.active_admins],["Suspended platform accounts",data.suspended_accounts]]}/>
 <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Security and operational safeguards</h2>
 <p>This request passed the current administrator and verified MFA checks. Sensitive account changes additionally require TOTP verification within 10 minutes: {data.recent_mfa?"recent verification present":"verify again before a change"}.</p>
 <p>Suspension requires no unresolved visits, orders or balances. It never settles a payment, closes an unpaid table, deletes data or changes opening hours. Legacy unresolved balances require a separately reviewed reconciliation.</p>
 <p>Administrator provisioning and recovery remain restricted to the trusted database operator. Account email alone grants no platform access.</p>
 <p>Leaked-password protection: not verified enabled. The trusted Supabase project operator must review Auth password security settings and plan availability. Infrastructure health and runtime monitoring are not measured here.</p>
 <p>Billing not configured. No billing, impersonation, deletion or global feature override controls are available.</p>
 <div className="flex flex-wrap gap-4"><Link className="underline" href="/platform/restaurants">Manage restaurant accounts</Link><Link className="underline" href="/platform/audit">Audit Logs</Link><Link className="underline" href="/platform/mfa">Verify MFA again</Link></div>
 </section></PlatformShell>;
}
