"use client";
import { useActionState, useState } from "react";
import { manageStaff } from "@/app/actions/staff";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
export type StaffMember = {id:string;name:string;role:string;branch_id:string|null;is_active:boolean};
export function AddStaffForm({branches,owner=false,member}:{branches:{id:string;name:string}[];owner?:boolean;member?:StaffMember}) {
  const [state,action,pending]=useActionState(manageStaff,{error:null});
  const [access,setAccess]=useState(member?.role==="manager"?"manager":"staff");
  const suffix=member?.id ?? "new";
  return <form action={action} className="flex flex-wrap items-end gap-3">
    <input type="hidden" name="staffId" value={member?.id ?? ""}/>
    <div><Label htmlFor={`name-${suffix}`}>Name</Label><Input id={`name-${suffix}`} name="name" defaultValue={member?.name} maxLength={80} required className="w-40"/></div>
    <div><Label htmlFor={`access-${suffix}`}>Access</Label><select id={`access-${suffix}`} name="access" value={access} onChange={e=>setAccess(e.target.value)} className="h-9 rounded border px-3">
      <option value="staff">Staff</option>{owner && <option value="manager">Manager</option>}
    </select></div>
    <div><Label htmlFor={`branch-${suffix}`}>Branch</Label><select id={`branch-${suffix}`} name="branchId" defaultValue={member?.branch_id ?? branches[0]?.id} className="h-9 rounded border px-3">
      <option value="">All branches</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
    </select></div>
    {access==="manager" ? <div><Label htmlFor={`email-${suffix}`}>Verified manager account email</Label><Input id={`email-${suffix}`} name="email" type="email" required placeholder="Existing account email"/><p className="text-xs">Manager uses email/password, never a staff PIN.</p></div> : <div><Label htmlFor={`pin-${suffix}`}>{member?"New PIN (optional)":"PIN"}</Label><Input id={`pin-${suffix}`} name="pin" type="password" inputMode="numeric" minLength={6} maxLength={8} pattern="[0-9]{6,8}" autoComplete="new-password" placeholder="6–8 digits" required={!member} className="w-36"/></div>}
    <Button name="action" value={member?"edit":"add"} disabled={pending}>{pending?"Saving…":member?"Save":"Add staff member"}</Button>
    {member && <>
      {access!=="manager" && <Button name="action" value="reset_pin" variant="outline" disabled={pending}>Reset PIN</Button>}
      <Button name="action" value={member.is_active?"deactivate":"activate"} variant="outline" formNoValidate disabled={pending}>{member.is_active?"Deactivate":"Activate"}</Button>
      {member.role!=="manager" && <Button name="action" value="revoke" variant="outline" formNoValidate disabled={pending}>Revoke sessions</Button>}
    </>}
    {state.error && <p role="alert" className="w-full text-sm text-destructive">{state.error}</p>}
    {state.success && !state.error && <p role="status" className="w-full text-sm">Saved.</p>}
  </form>;
}
