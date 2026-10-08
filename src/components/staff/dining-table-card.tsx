"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeDiningSession } from "@/app/actions/dining";
import { tableAttention, type DiningTable } from "@/lib/dining-view";
import { DiningRounds } from "@/components/staff/dining-rounds";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
export function DiningTableCard({
  table,
  owner = false,
  canPay = false,
  canFulfill = false,
}: {
  table: DiningTable;
  owner?: boolean;
  canPay?: boolean;
  canFulfill?: boolean;
}) {
  const router = useRouter(),
    [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null),
    [method, setMethod] = useState("cash");
  const [notice,setNotice] = useState<string|null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [closureReason, setClosureReason] = useState<"external_manual" | "manual_unsettled">("external_manual");
  async function act(action: string) {
    setError(null);
    setNotice(null);
    start(async () => {
      try {
        const key = `qrcr_payment:${table.sessionId}`;
        let attempt = table.attemptKey;
        if (action === "start_payment") {
          attempt = sessionStorage.getItem(key) || crypto.randomUUID();
          sessionStorage.setItem(key, attempt);
        }
        const result = await changeDiningSession({
          tableId: table.id,
          sessionId: table.sessionId!,
          action,
          owner,
          closureReason,
          attemptKey: attempt ?? undefined,
          method: action === "start_payment" ? method : table.method,
        });
        if (result.error) {
          if (action === "start_payment") sessionStorage.removeItem(key);
          setError(result.error);
        } else {
          if (
            action === "fail_payment" ||
            action === "confirm_payment" ||
            action === "close"
          )
            sessionStorage.removeItem(key);
          if(action === "confirm_payment") {setNotice("External payment recorded. Table session ended.");window.dispatchEvent(new CustomEvent("staff-payment-recorded",{detail:{label:table.label}}));}
          if(action === "fail_payment") setNotice("Payment not received. The table remains open; retry when ready.");
          setManualOpen(false);
          router.refresh();
        }
      } catch {
        setError("Could not save this action. Retry safely.");
      }
    });
  }
  return (
    <Card data-table-id={table.id} data-session-id={table.sessionId ?? undefined}>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex justify-between">
          <p className="font-medium">Table {table.label}</p>
          <p className="font-medium">{tableAttention(table)}</p>
        </div>
        <p className="text-xs text-muted-foreground">{table.branchName}{table.sessionId ? ` · Open ${table.ageMinutes} min` : ""}</p>
        {table.sessionId && (
          <>
            {table.paymentIntent === "counter" && <p className="rounded border p-2 text-sm font-semibold" role="status">PAY AT COUNTER</p>}
            {table.paymentState === "failed" && <p role="status" className="text-sm">Payment was not received. This table is still open; use Record Payment to retry.</p>}
            <DiningRounds orders={table.orders} canFulfill={canFulfill}/>
            <p className="flex justify-between border-t pt-3 font-semibold"><span>Running total</span><span>₹{table.total.toFixed(2)}</span></p>
            <Button variant="outline" onClick={()=>setDetailOpen(true)}>View Tab</Button>
            <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Table {table.label} · {tableAttention(table)}</DialogTitle><DialogDescription>{table.branchName} · Open {table.ageMinutes} minutes · Actions apply to a whole order round.</DialogDescription></DialogHeader>
                <DiningRounds orders={table.orders} canFulfill={canFulfill} expanded/>
                <p className="font-semibold">Running total: ₹{table.total.toFixed(2)}</p>
                <p>Payment: {table.paymentIntent === "counter" ? "Pay at Counter" : table.sessionStatus === "payment_pending" ? "Pending with staff" : table.sessionStatus === "paid" ? "Recorded by staff" : "No customer payment choice"}</p>
                {owner && canPay && ["open","bill_requested"].includes(table.sessionStatus ?? "") && <Button onClick={()=>{setDetailOpen(false);setManualOpen(true);}}>Close Tab</Button>}
              </DialogContent>
            </Dialog>
            {table.sessionStatus === "open" && table.orderCount === 0 && (
              <Button
                disabled={pending}
                variant="outline"
                onClick={() => act("reset_empty")}
              >
                Reset empty table
              </Button>
            )}
            {canPay && ["open","bill_requested"].includes(table.sessionStatus ?? "") && (
              <>
                <label className="text-sm">
                  Counter payment method
                  <select
                    className="ml-2 rounded border p-2"
                    value={method}
                    disabled={pending}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="cash">Cash — counter</option>
                    <option value="card">Card — external terminal</option>
                    <option value="upi">UPI — external transfer</option>
                  </select>
                </label>
                <Button disabled={pending} onClick={() => act("start_payment")}>
                  Record Payment
                </Button>
              </>
            )}
            {canPay && table.sessionStatus === "payment_pending" && (
              <>
                <p className="text-sm">
                  Confirm only after the full payment has actually been
                  received. {table.method === "card" ? "Card payment is handled by your external terminal, not QR.CR." : table.method === "upi" ? "Verify the transfer in your external payment app." : "Confirm the cash has been received."} This will also end the table session.
                </p>
                <Button
                  disabled={pending}
                  onClick={() => act("confirm_payment")}
                >
                  Record external payment received
                </Button>
                <Button
                  disabled={pending}
                  variant="outline"
                  onClick={() => act("fail_payment")}
                >
                  Payment not received / Retry
                </Button>
              </>
            )}
            {canPay && (table.sessionStatus === "paid" || (owner && ["open", "bill_requested"].includes(table.sessionStatus ?? ""))) && (
              <>
                <Button disabled={pending} variant="outline" onClick={() => {setError(null);setManualOpen(true);}}>Close Tab</Button>
                <Dialog open={manualOpen} onOpenChange={setManualOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Close Table {table.label}?</DialogTitle>
                      <DialogDescription>This ends the visit and locks further ordering. The orders and final tab are kept. QR.CR does not verify an external payment.</DialogDescription>
                    </DialogHeader>
                    <p>Current total: ₹{table.total.toFixed(2)}</p>
                    {table.sessionStatus !== "paid" && <label className="text-sm">Closure reason
                      <select className="ml-2 rounded border p-2" value={closureReason} disabled={pending} onChange={e=>setClosureReason(e.target.value as typeof closureReason)}>
                        <option value="external_manual">Payment handled outside QR.CR</option>
                        <option value="manual_unsettled">Clear table without recording payment</option>
                      </select>
                    </label>}
                    <Button disabled={pending} onClick={()=>act(table.sessionStatus === "paid" ? "close" : "manual_close")}>{table.sessionStatus === "paid" ? "Confirm closure" : "Confirm manual closure"}</Button>
                    <Button variant="outline" disabled={pending} onClick={()=>setManualOpen(false)}>Keep table open</Button>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  </DialogContent>
                </Dialog>
              </>
            )}

          </>
        )}
        {notice && <p role="status" className="text-sm">{notice}</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
