"use client";
import { useActionState, useEffect, useState, useTransition } from "react";
import { lookupRestaurant, staffLogin } from "@/app/actions/staff-auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
type Restaurant = {slug:string;name:string;staff:{id:string;name:string}[]};
const KEY="thaliq_staff_restaurant_slug";
export function StaffLoginForm({defaultRestaurantSlug}:{defaultRestaurantSlug?:string}) {
  const [state,action,pending]=useActionState(staffLogin,{error:null});
  const [restaurant,setRestaurant]=useState<Restaurant|null>(null);
  const [code,setCode]=useState(defaultRestaurantSlug ?? "");
  const [error,setError]=useState<string|null>(null);
  const [looking,start]=useTransition();
  useEffect(()=>{
    let cancelled=false;
    const slug=defaultRestaurantSlug || localStorage.getItem(KEY);
    if(slug) start(async()=>{
      const result=await lookupRestaurant(slug);
      if(cancelled) return;
      if("error" in result) setError(result.error ?? "Staff access unavailable."); else setRestaurant(result);
    });
    return ()=>{cancelled=true;};
  },[defaultRestaurantSlug]);
  function lookup() {
    setError(null);
    start(async()=>{
      const result=await lookupRestaurant(code);
      if("error" in result) setError(result.error ?? "Staff access unavailable.");
      else {localStorage.setItem(KEY,result.slug);setRestaurant(result);}
    });
  }
  return <Card className="w-full max-w-sm">
    <CardHeader><CardTitle>{restaurant?.name ?? "Staff Access"}</CardTitle><CardDescription>{restaurant ? "Select your name and enter your PIN." : "Enter your restaurant code."}</CardDescription></CardHeader>
    <CardContent>
      {!restaurant ? <div className="flex flex-col gap-3">
        <Label htmlFor="code">Restaurant code</Label><Input id="code" value={code} onChange={e=>setCode(e.target.value)} autoCapitalize="none" onKeyDown={e=>{if(e.key==="Enter")lookup();}}/>
        <Button disabled={looking || !code.trim()} onClick={lookup}>{looking?"Checking…":"Continue"}</Button>
      </div> : <form action={action} className="flex flex-col gap-3">
        <input type="hidden" name="restaurantSlug" value={restaurant.slug}/>
        <Label htmlFor="staffId">Staff member</Label>
        <select id="staffId" name="staffId" required disabled={pending} className="h-10 rounded border px-3" defaultValue="">
          <option value="" disabled>Select your name</option>{restaurant.staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {!restaurant.staff.length && <p>No active staff. Ask your manager to add you.</p>}
        <Label htmlFor="staffPin">PIN</Label><Input id="staffPin" name="pin" type="password" inputMode="numeric" pattern="[0-9]{4,8}" minLength={4} maxLength={8} required autoComplete="off" disabled={pending}/>
        <Button disabled={pending || !restaurant.staff.length}>{pending?"Signing in…":"Sign In"}</Button>
        {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        <Button type="button" variant="ghost" onClick={()=>{setRestaurant(null);localStorage.removeItem(KEY);}}>Change restaurant</Button>
        <a href="/login" className="text-sm underline">Owner / Manager sign in</a>
      </form>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </CardContent>
  </Card>;
}
