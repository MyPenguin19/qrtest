"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
export function PlatformMfa() {
  const router = useRouter();
  const [factor,setFactor] = useState("");
  const [qr,setQr] = useState("");
  const [secret,setSecret] = useState("");
  const [code,setCode] = useState("");
  const [error,setError] = useState("");
  const [pending,setPending] = useState(false);
  async function prepare() {
    setPending(true); setError("");
    try {
      const client = createClient();
      const result = await client.auth.mfa.listFactors();
      if(result.error) throw result.error;
      const verified = result.data.totp.find(f=>f.status === "verified");
      if(verified) setFactor(verified.id);
      else {
        const enrolled = await client.auth.mfa.enroll({factorType:"totp",friendlyName:`QR.CR ${new Date().toISOString()}`});
        if(enrolled.error) throw enrolled.error;
        setFactor(enrolled.data.id); setQr(enrolled.data.totp.qr_code); setSecret(enrolled.data.totp.secret);
      }
    } catch { setError("Could not prepare your authenticator. Retry or contact your account administrator."); }
    finally { setPending(false); }
  }
  return <div className="space-y-4">
    {!factor && <button className="rounded border p-3" disabled={pending} onClick={prepare}>{pending ? "Loading…" : "Set up or use authenticator"}</button>}
    {qr && <div><p>Scan this private QR with your authenticator. Do not share it.</p>
      {/* Supabase-issued enrollment QR stays in component memory only. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="Private authenticator enrollment QR" width={240} height={240} />
      <details><summary>Manual setup key</summary><code className="break-all">{secret}</code></details></div>}
    {factor && <form className="space-y-4" onSubmit={async e=>{
      e.preventDefault();setPending(true);setError("");
      try {
        const {error} = await createClient().auth.mfa.challengeAndVerify({factorId:factor,code});
        if(error) {setCode("");setError("Verification failed. Enter a fresh authenticator code.");}
        else {setSecret("");setQr("");setCode("");router.replace("/platform");router.refresh();}
      } catch {setError("Verification is unavailable. Please retry.");}
      finally {setPending(false);}
    }}><label className="block">Authenticator code<input className="block w-full rounded border p-3" value={code} onChange={e=>setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="rounded border p-3" disabled={pending}>{pending ? "Verifying…" : "Verify MFA"}</button></form>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
