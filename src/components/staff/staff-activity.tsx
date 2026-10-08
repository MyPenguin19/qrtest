"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { staffActivity } from "@/app/actions/staff-auth";

/** Polling must not keep an unattended shared tablet authenticated. */
export function StaffActivity() {
  const router=useRouter();
  useEffect(()=>{
    let lastSent=0;
    const active=(event:Event)=>{
      if(!event.isTrusted || document.visibilityState!=="visible" || Date.now()-lastSent<60_000) return;
      lastSent=Date.now();
      void staffActivity().then(result=>{if(result.expired) router.replace("/staff");}).catch(()=>{});
    };
    window.addEventListener("pointerdown",active,{passive:true});
    window.addEventListener("keydown",active);
    return ()=>{window.removeEventListener("pointerdown",active);window.removeEventListener("keydown",active);};
  },[router]);
  return null;
}
