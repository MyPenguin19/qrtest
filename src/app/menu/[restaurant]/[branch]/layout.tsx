import { Suspense } from "react";

import { CartProvider } from "@/components/menu/cart-provider";

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<p className="p-4">Loading menu…</p>}><CartProvider>{children}</CartProvider></Suspense>;
}
