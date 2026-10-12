"use client";

import { useEffect, useState } from "react";

import { useCart } from "@/components/menu/cart-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Variant = { id: string; name: string; price: number; is_default: boolean };
type Addon = { id: string; name: string; price: number };

export type MenuItemForCart = {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  base_price: number;
  is_veg: boolean;
  is_bestseller: boolean;
  is_available: boolean;
  menu_variants: Variant[];
  menu_addons: Addon[];
};

export function AddToCartDialog({
  item,
  open,
  onOpenChange,
}: {
  item: MenuItemForCart;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { addLine } = useCart();
  const defaultVariant = item.menu_variants.find((v) => v.is_default) ?? item.menu_variants[0];
  const [variantId, setVariantId] = useState<string | null>(defaultVariant?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [instructions, setInstructions] = useState("");

  const activeVariant = item.menu_variants.find((v) => v.id === variantId) ?? null;
  const unitPrice = activeVariant ? activeVariant.price : item.base_price;
  const selectedAddons = item.menu_addons.filter((a) => addonIds.includes(a.id));
  const total = (unitPrice + selectedAddons.reduce((s, a) => s + a.price, 0)) * quantity;

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

  function toggleAddon(id: string) {
    setAddonIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function handleAdd() {
    addLine({
      itemId: item.id,
      itemName: item.name,
      isVeg: item.is_veg,
      variantId: activeVariant?.id ?? null,
      variantName: activeVariant?.name ?? null,
      unitPrice,
      addons: selectedAddons,
      quantity,
      specialInstructions: instructions.trim(),
    });
    onOpenChange(false);
    setQuantity(1);
    setAddonIds([]);
    setInstructions("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 [&>button]:top-2 [&>button]:right-2 [&>button]:flex [&>button]:size-11 [&>button]:items-center [&>button]:justify-center"
        style={viewport ? { top: viewport.top + viewport.height / 2, maxHeight: viewport.height - 16 } : undefined}
      >
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4 pt-14 [overflow-wrap:anywhere]">
        <div className="flex flex-col gap-4">
        {item.image_url ? (
          // A plain block with its own rounding — an earlier negative-margin
          // bleed pushed the image past the dialog's rounded corners and its
          // overflow-y-auto clip, which read as the photo being cut off.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.image_url}
            alt={item.name}
            className="aspect-[4/3] w-full rounded-lg border object-cover"
          />
        ) : null}

        <DialogHeader className="text-left">
          <DialogTitle className="leading-snug">{item.name}</DialogTitle>
          <DialogDescription>Choose your options. Adding to your cart does not place an order.</DialogDescription>
        </DialogHeader>

        {item.description ? <p className="text-sm text-muted-foreground">{item.description}</p> : null}

        {item.menu_variants.length > 0 && (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 font-medium">Size / variant · choose one</legend>
            <div className="flex flex-wrap gap-2">
              {item.menu_variants.map((variant) => (
                <label key={variant.id} className={cn(
                  "flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-3 rounded-md border p-3 text-sm",
                  variantId === variant.id ? "border-foreground bg-accent font-semibold" : "hover:bg-accent",
                )}>
                  <input type="radio" name="item-variant" value={variant.id} checked={variantId === variant.id}
                    onChange={() => setVariantId(variant.id)} className="size-5 shrink-0" />
                  <span>{variant.name} · ₹{variant.price}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {item.menu_addons.length > 0 && (
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="mb-2 font-medium">Add-ons · optional</legend>
            <div className="flex flex-col gap-1.5">
              {item.menu_addons.map((addon) => (
                <label key={addon.id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-md border p-3 text-sm", addonIds.includes(addon.id) && "border-foreground bg-accent font-semibold")}>
                  <input
                    type="checkbox"
                    className="size-5 shrink-0"
                    checked={addonIds.includes(addon.id)}
                    onChange={() => toggleAddon(addon.id)}
                  />
                  {addon.name} (+₹{addon.price})
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="instructions">Special instructions</Label>
          <Input
            className="min-h-11 text-base md:text-base"
            id="instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Less spicy, no onions…"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Quantity</span>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            >
              −
            </Button>
            <span className="w-6 text-center">{quantity}</span>
            <Button type="button" variant="outline" size="icon" className="size-11" aria-label="Increase quantity" onClick={() => setQuantity((q) => q + 1)}>
              +
            </Button>
          </div>
        </div>

        </div>
        </div>
        <DialogFooter className="shrink-0 border-t bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <Button onClick={handleAdd} className="min-h-11 w-full whitespace-normal">
            Add to cart · ₹{total}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
