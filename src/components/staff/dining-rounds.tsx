"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { advanceOrderStatus, markOrderServed } from "@/app/actions/staff-ops";
import { fulfillmentGroup, type DiningRound } from "@/lib/dining-view";
import { Button } from "@/components/ui/button";

export function DiningRounds({orders, canFulfill = false, expanded = false}: {orders: DiningRound[]; canFulfill?: boolean; expanded?: boolean}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const groups = {
    new: orders.filter(o=>fulfillmentGroup(o.status)==="new"),
    ready: orders.filter(o=>fulfillmentGroup(o.status)==="ready"),
    completed: orders.filter(o=>fulfillmentGroup(o.status)==="completed"),
    cancelled: orders.filter(o=>fulfillmentGroup(o.status)==="cancelled"),
  };
  function renderRound(order: DiningRound) {
    const group = fulfillmentGroup(order.status);
    return <div key={order.id} className="flex flex-col gap-2 rounded border p-3" data-order-id={order.id}>
      <p className="text-xs text-muted-foreground">Round {order.round} · Order #{order.order_number} · <time dateTime={order.created_at}>{new Date(order.created_at).toISOString().slice(11,16)} UTC</time></p>
      <ul className="text-sm">{order.order_items.map(item=><li key={item.id}>
        <span>{item.item_name}{item.variant_name ? ` (${item.variant_name})` : ""} × {item.quantity}</span>
        {item.special_instructions && <p className="text-xs text-muted-foreground">{item.special_instructions}</p>}
      </li>)}</ul>
      {canFulfill && ["new","ready"].includes(group) && <Button disabled={pending} size="sm" onClick={()=>{
        setError(null);
        start(async()=>{
          try {
            if(group === "ready") await markOrderServed(order.id);
            else await advanceOrderStatus(order.id,order.status);
            router.refresh();
          } catch {setError("Could not update this round. Refresh and try again.");}
        });
      }}>{group === "new" ? "Mark Round Ready" : "Mark Round Served"}</Button>}
    </div>;
  }
  return <div className="flex flex-col gap-4">
    {groups.new.length > 0 && <section className="flex flex-col gap-2" aria-label="New rounds"><h3 className="font-semibold">NEW · {groups.new.length} {groups.new.length===1?"round":"rounds"}</h3>{groups.new.map(renderRound)}</section>}
    {groups.ready.length > 0 && <section className="flex flex-col gap-2" aria-label="Ready rounds"><h3 className="font-semibold">READY</h3>{groups.ready.map(renderRound)}</section>}
    {groups.completed.length > 0 && <details open={expanded || undefined}><summary className="cursor-pointer text-sm">Completed ({groups.completed.length} {groups.completed.length===1?"round":"rounds"})</summary><div className="mt-2 flex flex-col gap-2">{groups.completed.map(renderRound)}</div></details>}
    {groups.cancelled.length > 0 && <details><summary className="cursor-pointer text-sm">Cancelled ({groups.cancelled.length}) · excluded from total</summary><div className="mt-2 flex flex-col gap-2">{groups.cancelled.map(renderRound)}</div></details>}
    {orders.length===0 && <p className="text-sm text-muted-foreground">No submitted items yet.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
