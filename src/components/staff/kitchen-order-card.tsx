"use client";

import { useState, useTransition } from "react";

import { advanceOrderStatus, markOrderServed } from "@/app/actions/staff-ops";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ACTION_LABEL: Record<string, string> = {
  pending: "Start preparing",
  accepted: "Start preparing",
  preparing: "Mark ready",
  ready: "Mark served",
};

const STATUS_LABEL: Record<string, string> = { pending: "New", accepted: "New", preparing: "Preparing", ready: "Ready", served: "Served" };

type OrderItem = { id: string; item_name: string; quantity: number };

export function KitchenOrderCard({
  order,
}: {
  order: { id: string; order_number: number; status: string; createdAt: string; order_items: OrderItem[]; tableLabel: string | null };
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actionLabel = ACTION_LABEL[order.status];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          {order.tableLabel ? `Table ${order.tableLabel}` : `Order #${order.order_number}`}
        </CardTitle>
        <Badge>{STATUS_LABEL[order.status] ?? order.status}</Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-xs text-muted-foreground">
          Order #{order.order_number} · <time dateTime={order.createdAt}>{new Date(order.createdAt).toISOString().slice(11, 16)} UTC</time>
        </p>
        <ul className="text-sm">
          {order.order_items.map((item) => (
            <li key={item.id}>
              {item.item_name} × {item.quantity}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {actionLabel ? (
          <Button
            disabled={isPending}
            onClick={() => startTransition(async () => {
              setError(null);
              try {
                if (order.status === "ready") await markOrderServed(order.id);
                else await advanceOrderStatus(order.id, order.status);
              } catch {
                setError("Could not update the order. Refresh and try again.");
              }
            })}
          >
            {isPending ? "Updating…" : actionLabel}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
