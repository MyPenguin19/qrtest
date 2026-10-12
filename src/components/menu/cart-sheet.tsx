"use client";

import { useEffect, useState, useTransition } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { placeOrder } from "@/app/actions/orders";
import { useCart } from "@/components/menu/cart-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

  const [viewport, setViewport] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    if (!open || !window.visualViewport) return;
    const visual = window.visualViewport;
    const update = () => setViewport({ height: visual.height, top: visual.offsetTop });
    // Follow the visible area when a mobile keyboard opens or pans the page.
    const frame = requestAnimationFrame(update);
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      cancelAnimationFrame(frame);
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  }, [open]);

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
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 [&>button]:top-2 [&>button]:right-2 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
        style={viewport ? { top: viewport.top + viewport.height / 2, maxHeight: viewport.height - 16 } : undefined}
      >
        <DialogHeader className="shrink-0 p-4 pr-16 text-left">
          <DialogTitle>Your cart</DialogTitle>
          <DialogDescription>Unsubmitted items on this device. The shared table bill contains orders already placed.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4 [overflow-wrap:anywhere]">
        <div className="flex flex-col gap-3">
          {lines.map((line) => (
            <div key={line.key} className="flex flex-col gap-2 border-b pb-3 last:border-0">
              <div className="min-w-0 flex-1">
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
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button
                    disabled={pendingSubmission}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Decrease quantity of ${line.itemName}`}
                    onClick={() => updateQuantity(line.key, line.quantity - 1)}
                  >
                    −
                  </Button>
                  <span aria-label={`Quantity: ${line.quantity}`} className="min-w-6 text-center tabular-nums">{line.quantity}</span>
                  <Button
                    disabled={pendingSubmission}
                    type="button"
                    variant="outline"
                    size="icon"
                    className="size-11 shrink-0"
                    aria-label={`Increase quantity of ${line.itemName}`}
                    onClick={() => updateQuantity(line.key, line.quantity + 1)}
                  >
                    +
                  </Button>
                  <button
                    type="button"
                    disabled={pendingSubmission}
                    onClick={() => removeLine(line.key)}
                    aria-label={`Remove ${line.itemName} from cart`}
                    className="min-h-11 min-w-11 rounded px-2 text-sm underline focus-visible:outline-2 focus-visible:outline-offset-2"
                  >
                    Remove
                  </button>
                </div>
              </div>
              <p className="font-medium tabular-nums">Line total: ₹{lineTotal(line)}</p>
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
                  className="min-h-11 text-base md:text-base"
                  id="couponCode"
                  disabled={pendingSubmission}
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  placeholder="WEEKEND20"
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="customerName">Name (optional)</Label>
                  <Input className="min-h-11 text-base md:text-base" disabled={pendingSubmission} id="customerName" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="customerPhone">Mobile (optional)</Label>
                  <Input
                  className="min-h-11 text-base md:text-base"
                    disabled={pendingSubmission}
                    id="customerPhone"
                    value={customerPhone}
                    onChange={(e) => setCustomerPhone(e.target.value)}
                    inputMode="tel"
                  />
                </div>
              </div>
            </div>

          </>
        )}
        </div>
        {lines.length > 0 && <div className="shrink-0 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <p role="status" className="mb-2 text-sm">{isPending ? "Submitting your order…" : pendingSubmission ? "Retry the unchanged order after a connection error. It will only be saved once." : "Your items have not been ordered yet."}</p>
          {error ? <p role="alert" className="mb-2 max-h-20 overflow-y-auto text-sm text-destructive">{error}</p> : null}
          <Button onClick={handlePlaceOrder} disabled={isPending} className="min-h-11 w-full whitespace-normal">
            {isPending ? "Placing order…" : "Place order"}
          </Button>
        </div>}
      </DialogContent>
    </Dialog>
  );
}
