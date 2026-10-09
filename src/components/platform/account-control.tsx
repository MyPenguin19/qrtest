"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { changeRestaurantAccount } from "@/app/actions/platform-controls";
import type { AccountControl } from "@/lib/platform-controls";
const messages:Record<string,string>={changed:"Account status updated. The change was recorded in Audit Logs.",unchanged:"The account already has that status.",recent_mfa_required:"Verify your authenticator again, then reopen this restaurant and retry.",unresolved_activity:"Suspension was refused. Resolve open visits, unfinished work and unsettled balances through the existing restaurant workflow, then refresh.",stale_state:"Another administrator changed this account. Refresh and review before retrying.",invalid_request:"Choose a reason and explicitly confirm the change.",request_conflict:"This request reference was already used. Refresh before retrying.",denied:"This action is not authorized.",operation_failed:"The operation failed; no account change was saved. Retry or contact your platform operator.",unavailable:"The result could not be confirmed. Retry the same request or refresh to check the account and audit log."};
export function AccountControlForm({id,control,requestId}:{id:string;control:AccountControl;requestId:string}) {
 const router=useRouter();const [pending,setPending]=useState(false);const [message,setMessage]=useState("");
 const blocked=!control.suspended&&Object.values(control.blockers).some(n=>n>0);
 return <section className="space-y-3 rounded border p-4"><h2 className="font-semibold">Account management</h2>
 <p>Account: <strong>{control.suspended?"Suspended":"Active"}</strong>. Billing not configured.</p>
 <p>Setup readiness: {control.setup_ready?"Ready to receive orders":"Setup incomplete"}. Account access and restaurant operating settings remain separate.</p>
 {control.changed_at&&<p className="break-all text-sm">Last change: {new Date(control.changed_at).toISOString()} · Administrator {control.changed_by} · Reason: {control.reason?.replaceAll("_"," ")}</p>}
 <p className="text-sm">Suspension blocks new orders, visits and operational requests. History and configuration remain accessible. It cannot proceed with unresolved activity; it never closes visits or records payments. Reactivation does not change hours or menu readiness.</p>
 <ul className="list-inside list-disc text-sm">{Object.entries(control.blockers).map(([key,n])=><li key={key}>{key.replaceAll("_"," ")}: {n}</li>)}</ul>
 <p><Link className="underline" href="/platform/mfa">Verify MFA again</Link> within 10 minutes before changing this account, then return here.</p>
 {!control.recent_mfa&&<p>Fresh MFA verification is required.</p>}
 <form className="space-y-3" onSubmit={async e=>{e.preventDefault();const form=new FormData(e.currentTarget);setPending(true);setMessage("");try{const r=await changeRestaurantAccount({restaurantId:id,suspend:!control.suspended,reason:String(form.get("reason")??""),confirmed:form.get("confirm")==="on",version:control.version,requestId});setMessage(messages[r.code]??messages.unavailable);router.refresh();}catch{setMessage(messages.unavailable);}finally{setPending(false);}}}>
 <label className="block">Mandatory reason<select name="reason" required defaultValue="" className="ml-2 rounded border p-2"><option value="" disabled>Choose reason</option><option value="security_review">Security review</option><option value="operational_request">Operational request</option><option value="review_resolved">Review resolved</option></select></label>
 <label className="flex items-start gap-2"><input type="checkbox" name="confirm" required/><span>I confirm {control.suspended?"reactivation":"suspension"} of this restaurant account.</span></label>
 <button disabled={pending||blocked||!control.recent_mfa} className="rounded border p-3 disabled:opacity-50">{pending?"Saving…":control.suspended?"Reactivate restaurant":"Suspend restaurant"}</button>
 </form>{message&&<p role="status">{message}</p>}
 </section>;
}
