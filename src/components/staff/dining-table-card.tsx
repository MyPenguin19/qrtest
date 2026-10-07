"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeDiningSession } from "@/app/actions/dining";
import type { DiningTable } from "@/lib/dining-tables";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
const LABELS: Record<string, string> = {
  available: "Available",
  occupied: "Open",
  order_pending: "Ordering",
  preparing: "Ordering",
  ready: "Ordering",
  bill_requested: "Bill Requested",
  payment_pending: "Payment Pending",
  paid: "Paid / Closing",
  cleaning: "Cleaning",
};
export function DiningTableCard({
  table,
  owner = false,
  canPay = false,
}: {
  table: DiningTable;
  owner?: boolean;
  canPay?: boolean;
}) {
  const router = useRouter(),
    [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null),
    [method, setMethod] = useState("cash");
  const [manualOpen, setManualOpen] = useState(false);
  const [closureReason, setClosureReason] = useState<"external_manual" | "manual_unsettled">("external_manual");
  async function act(action: string) {
    setError(null);
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
          setManualOpen(false);
          router.refresh();
        }
      } catch {
        setError("Could not save this action. Retry safely.");
      }
    });
  }
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex justify-between">
          <p className="font-medium">Table {table.label}</p>
          <p>{LABELS[table.status] ?? table.status}</p>
        </div>
        {table.sessionId && (
          <>
            <p className="text-sm">
              {table.orderCount} submitted orders · ₹{table.total.toFixed(2)}
            </p>
            {table.paymentIntent === "counter" && <p className="text-sm font-medium">Customer intends to pay at counter</p>}
            {table.orders.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm">
                  View orders
                </summary>
                {table.orders.map((o) => (
                  <p key={o.number} className="text-sm">
                    Order #{o.number} · {o.status}
                  </p>
                ))}
              </details>
            )}
            {table.sessionStatus === "open" && (
              <Button
                disabled={pending}
                variant="outline"
                onClick={() => act("request_bill")}
              >
                Request bill
              </Button>
            )}
            {table.sessionStatus === "open" && table.orderCount === 0 && (
              <Button
                disabled={pending}
                variant="outline"
                onClick={() => act("reset_empty")}
              >
                Reset empty table
              </Button>
            )}
            {canPay && table.sessionStatus === "bill_requested" && (
              <>
                <label className="text-sm">
                  Counter payment method
                  <select
                    className="ml-2 rounded border p-2"
                    value={method}
                    disabled={pending}
                    onChange={(e) => setMethod(e.target.value)}
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="upi">UPI</option>
                  </select>
                </label>
                <Button disabled={pending} onClick={() => act("start_payment")}>
                  Start payment
                </Button>
              </>
            )}
            {canPay && table.sessionStatus === "payment_pending" && (
              <>
                <p className="text-sm">
                  Confirm only after the full payment has actually been
                  received.
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
            {canPay && ["open", "bill_requested"].includes(table.sessionStatus ?? "") && (
              <>
                <Button disabled={pending} variant="outline" onClick={() => {setError(null);setManualOpen(true);}}>Close table manually</Button>
                <Dialog open={manualOpen} onOpenChange={setManualOpen}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Close Table {table.label}?</DialogTitle>
                      <DialogDescription>This ends the visit and locks further ordering. The orders and final tab are kept. QR.CR does not verify an external payment.</DialogDescription>
                    </DialogHeader>
                    <p>Current total: ₹{table.total.toFixed(2)}</p>
                    <label className="text-sm">Closure reason
                      <select className="ml-2 rounded border p-2" value={closureReason} disabled={pending} onChange={e=>setClosureReason(e.target.value as typeof closureReason)}>
                        <option value="external_manual">Payment handled outside QR.CR</option>
                        <option value="manual_unsettled">Clear table without recording payment</option>
                      </select>
                    </label>
                    <Button disabled={pending} onClick={()=>act("manual_close")}>Confirm manual closure</Button>
                    <Button variant="outline" disabled={pending} onClick={()=>setManualOpen(false)}>Keep table open</Button>
                    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                  </DialogContent>
                </Dialog>
              </>
            )}
            {canPay && table.sessionStatus === "paid" && (
              <Button disabled={pending} onClick={() => act("close")}>
                Close paid table
              </Button>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
