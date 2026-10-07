"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestTabBill } from "@/app/actions/waiter-requests";
import { Button } from "@/components/ui/button";

export function TabBillButton({ restaurant, branch, table, token, requested }: {
  restaurant: string; branch: string; table: string; token: string; requested: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function requestBill() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestTabBill(restaurant, branch, table, token);
        if (result.error) setError(result.error);
        else router.refresh();
      } catch {
        setError("Could not request your bill. Please try again.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      {requested && <p role="status" className="text-sm">Bill requested. You can still order more; new orders update this bill.</p>}
      <Button onClick={requestBill} disabled={pending} variant="outline">
        {pending ? "Requesting…" : requested ? "Update requested bill" : "Pay / Request Bill"}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
