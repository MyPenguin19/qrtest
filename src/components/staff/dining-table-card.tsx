"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeDiningSession } from "@/app/actions/dining";
import type { DiningTable } from "@/lib/dining-tables";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
                  Confirm payment received
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
