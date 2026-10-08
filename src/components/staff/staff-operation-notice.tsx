"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
/** Stays mounted when a paid table moves from Active to Available. */
export function StaffOperationNotice() {
  const [table,setTable]=useState<string|null>(null);
  useEffect(()=>{
    const recorded=(event:Event)=>setTable(String((event as CustomEvent<{label:string}>).detail.label));
    window.addEventListener("staff-payment-recorded",recorded);
    return ()=>window.removeEventListener("staff-payment-recorded",recorded);
  },[]);
  return table===null ? null : <div role="status" className="flex items-center justify-between gap-3 rounded border p-3">
    <p>Table {table}: external payment recorded. That visit has ended.</p>
    <Button variant="outline" onClick={()=>setTable(null)}>Dismiss</Button>
  </div>;
}
