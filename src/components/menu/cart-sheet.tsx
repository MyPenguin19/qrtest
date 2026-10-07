"use client";

import { useState, useTransition } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { placeOrder } from "@/app/actions/orders";
import { useCart } from "@/components/menu/cart-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { lineTotal } from "@/lib/cart-types";

export function CartSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { lines, updateQuantity, removeLine, subtotal, clear, beginSubmission, submissionFailed, pendingSubmission } = useCart();
  const params = useParams<{ restaurant: string; branch: string; table?: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [couponCode, setCouponCode] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handlePlaceOrder() {
    setError(null);
    startTransition(async () => {
      try {
      const submission = beginSubmission({couponCode:couponCode.trim()||undefined,customerName:customerName.trim()||undefined,customerPhone:customerPhone.trim()||undefined});
      const result = await placeOrder({
        submissionKey: submission.key,
        ...submission.fields,
        restaurantSlug: params.restaurant,
        branchSlug: params.branch,
        tableId: params.table,
        tableSessionToken: searchParams.get("session") || undefined,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          variantId: l.variantId,
          addonIds: l.addons.map((a) => a.id),
          quantity: l.quantity,
          specialInstructions: l.specialInstructions,
        })),
      });

      if ("error" in result) {
        submissionFailed();
        setError(result.error);
        return;
      }

      clear();
      onOpenChange(false);
      router.push(result.tabUrl ?? `/menu/${params.restaurant}/${params.branch}/order/${result.orderId}`);
      } catch { setError("Connection interrupted. Retry this same order; it will not be submitted twice."); }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your order</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {lines.map((line) => (
            <div key={line.key} className="flex items-start justify-between gap-2 border-b pb-3 last:border-0">
              <div className="flex-1">
                <p className="font-medium">{line.itemName}</p>
                {line.variantName ? (
                  <p className="text-xs text-muted-foreground">{line.variantName}</p>
                ) : null}
                {line.addons.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {line.addons.map((a) => a.name).join(", ")}
                  </p>
                ) : null}
                {line.specialInstructions ? (
                  <p className="text-xs text-muted-foreground italic">&ldquo;{line.specialInstructions}&rdquo;</p>
                ) : null}
                <div className="mt-1 flex items-center gap-2">
                  <Button
                    disabled={pendingSubmission}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-6"
                    onClick={() => updateQuantity(line.key, line.quantity - 1)}
                  >
                    −
                  </Button>
                  <span className="w-4 text-center text-sm">{line.quantity}</span>
                  <Button
                    disabled={pendingSubmission}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-6"
                    onClick={() => updateQuantity(line.key, line.quantity + 1)}
                  >
                    +
                  </Button>
                  <button
                    type="button"
                    disabled={pendingSubmission}
                    onClick={() => removeLine(line.key)}
                    className="ml-2 text-xs text-muted-foreground underline"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="font-medium">₹{lineTotal(line)}</p>
            </div>
          ))}
          {lines.length === 0 && <p className="text-sm text-muted-foreground">Your cart is empty.</p>}
        </div>

        {lines.length > 0 && (
          <>
            <div className="flex items-center justify-between border-t pt-3 font-medium">
              <span>Subtotal</span>
              <span>₹{subtotal}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Tax, service charge and any coupon discount are applied when you place the order.
            </p>

            <div className="flex flex-col gap-3 border-t pt-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="couponCode">Coupon code (optional)</Label>
                <Input
                  id="couponCode"
                  disabled={pendingSubmission}
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="WEEKEND20"
                />
              </div>
              <div className="flex gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="customerName">Name (optional)</Label>
                  <Input disabled={pendingSubmission} id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="customerPhone">Mobile (optional)</Label>
                  <Input
                    disabled={pendingSubmission}
                    id="customerPhone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    inputMode="tel"
                  />
                </div>
              </div>
            </div>

            {pendingSubmission && <p className="text-sm">Retry the unchanged order after a connection error. The same submission will only be saved once.</p>}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button onClick={handlePlaceOrder} disabled={isPending} className="w-full">
              {isPending ? "Placing order…" : "Place order"}
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
