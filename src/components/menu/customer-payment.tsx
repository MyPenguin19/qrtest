"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseCounterPayment } from "@/app/actions/dining";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function CustomerPayment({ restaurant, branch, table, token, total, counterIntent, menuUrl }: {
  restaurant: string; branch: string; table: string; token: string;
  total: number; counterIntent: boolean; menuUrl: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function payAtCounter() {
    setError(null);
    start(async () => {
      try {
        const result = await chooseCounterPayment(restaurant, branch, table, token);
        if (result.error) setError(result.error);
        else { setOpen(false); router.refresh(); }
      } catch { setError("Could not save your payment choice. Please try again."); }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {counterIntent && <div role="status" className="rounded-lg border p-4">
        <h2 className="font-medium">Pay at Counter</h2>
        <p>Your current total: ₹{total.toFixed(2)}</p>
        <p className="text-sm">Please pay directly with restaurant staff. Your table is still open.</p>
      </div>}
      <Button variant="outline" onClick={() => { setError(null); setOpen(true); }}>Pay Now</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ready to pay?</DialogTitle>
            <DialogDescription>Choose how you&apos;d like to pay. Current total: ₹{total.toFixed(2)}</DialogDescription>
          </DialogHeader>
          <Button disabled aria-describedby="card-unavailable">Pay by Card</Button>
          <p id="card-unavailable" className="text-sm text-muted-foreground">Online card payment is unavailable. You can pay directly with restaurant staff.</p>
          <Button disabled={pending} onClick={payAtCounter}>{pending ? "Saving…" : "Pay at Counter"}</Button>
          <Button asChild variant="outline"><Link href={menuUrl}>Keep Ordering</Link></Button>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
