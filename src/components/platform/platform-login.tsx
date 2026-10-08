"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
export function PlatformLogin() {
  const router = useRouter();
  const [error,setError] = useState("");
  const [pending,setPending] = useState(false);
  return <form className="space-y-4" onSubmit={async e => {
    e.preventDefault(); setPending(true); setError("");
    const form = new FormData(e.currentTarget);
    try {
      const {error} = await createClient().auth.signInWithPassword({email:String(form.get("email")),password:String(form.get("password"))});
      if(error) setError("Sign-in failed. Check your credentials and try again.");
      else { router.replace("/platform"); router.refresh(); }
    } catch { setError("Sign-in is unavailable. Please try again."); }
    finally { setPending(false); }
  }}>
    <label className="block">Email<input className="block w-full rounded border p-3" name="email" type="email" autoComplete="username" required /></label>
    <label className="block">Password<input className="block w-full rounded border p-3" name="password" type="password" autoComplete="current-password" required /></label>
    <button className="rounded border p-3" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
