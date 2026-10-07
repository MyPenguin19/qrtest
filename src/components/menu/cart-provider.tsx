"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { type CartLine, lineTotal } from "@/lib/cart-types";

type Fields = {
  couponCode?: string;
  customerName?: string;
  customerPhone?: string;
};
type Snapshot = {
  lines: CartLine[];
  submissionKey: string;
  pending?: boolean;
  fields?: Fields;
};
type CartContextValue = {
  lines: CartLine[];
  addLine: (line: Omit<CartLine, "key">) => void;
  updateQuantity: (key: string, quantity: number) => void;
  removeLine: (key: string) => void;
  clear: () => void;
  beginSubmission: (fields: Fields) => { key: string; fields: Fields };
  submissionFailed: () => void;
  pendingSubmission: boolean;
  itemCount: number;
  subtotal: number;
};
const CartContext = createContext<CartContextValue | null>(null);
export function CartProvider({ children }: { children: React.ReactNode }) {
  const params = useParams<{
    restaurant: string;
    branch: string;
    table?: string;
  }>();
  const token = useSearchParams().get("session") ?? "general";
  // Signed reference is used only as a storage namespace here; the server verifies it.
  const storageKey = `qrcr_cart_v3:${params.restaurant}:${params.branch}:${params.table ?? "general"}:${token}`;
  return (
    <BrowserCart key={storageKey} storageKey={storageKey}>
      {children}
    </BrowserCart>
  );
}
function BrowserCart({
  children,
  storageKey,
}: {
  children: React.ReactNode;
  storageKey: string;
}) {
  const [cart, setCart] = useState<Snapshot>({ lines: [], submissionKey: "" });
  useEffect(() => {
    let saved: Snapshot = { lines: [], submissionKey: crypto.randomUUID() };
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.lines) && parsed.submissionKey) saved = parsed;
      }
    } catch {
      /* Start empty if storage was corrupted. */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate this browser's visit-specific cart.
    setCart(saved);
  }, [storageKey]);
  const value = useMemo<CartContextValue>(() => {
    function save(next: Snapshot) {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setCart(next);
    }
    function edit(lines: CartLine[]) {
      if (!cart.pending) save({ lines, submissionKey: crypto.randomUUID() });
    }
    return {
      lines: cart.lines,
      pendingSubmission: !!cart.pending,
      addLine: (line) =>
        edit([...cart.lines, { ...line, key: crypto.randomUUID() }]),
      updateQuantity: (key, quantity) =>
        edit(
          quantity <= 0
            ? cart.lines.filter((l) => l.key !== key)
            : cart.lines.map((l) => (l.key === key ? { ...l, quantity } : l)),
        ),
      removeLine: (key) => edit(cart.lines.filter((l) => l.key !== key)),
      clear: () => save({ lines: [], submissionKey: crypto.randomUUID() }),
      beginSubmission: (fields) => {
        const key = cart.submissionKey || crypto.randomUUID();
        const stored = cart.pending ? (cart.fields ?? fields) : fields;
        save({ ...cart, fields: stored, submissionKey: key, pending: true });
        return { key, fields: stored };
      },
      submissionFailed: () => save({ ...cart, pending: false }),
      itemCount: cart.lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: cart.lines.reduce((n, l) => n + lineTotal(l), 0),
    };
  }, [cart, storageKey]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("Cart provider missing");
  return ctx;
}
