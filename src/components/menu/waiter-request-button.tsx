"use client";

import { useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Bell } from "lucide-react";

import { requestWaiterAssistance } from "@/app/actions/waiter-requests";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const OPTIONS = [
  { value: "call_waiter", label: "Call waiter" },
  { value: "water", label: "Water" },
  { value: "cutlery", label: "Cutlery" },
  { value: "bill", label: "Request bill" },
  { value: "other", label: "Other" },
];

export function WaiterRequestButton({ branchId, tableId }: { branchId: string; tableId: string }) {
  const token = useSearchParams().get("session") ?? undefined;
  const [error,setError] = useState<string|null>(null);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function send(type: string) {
    setError(null);
    startTransition(async () => {
      try {
      const result = await requestWaiterAssistance(branchId, tableId, type, token);
      if(result.error) setError(result.error);
      if (!result.error) {
        setSent(type);
        setTimeout(() => {
          setOpen(false);
          setSent(null);
        }, 1200);
      }
      } catch {setError("Could not send your request. Please try again.");}
    });
  }

  return (
    <>
      <div className="fixed bottom-24 right-4 z-40">
        <Button variant="outline" size="icon" aria-label="Request staff assistance" className="size-12 rounded-full shadow-lg" onClick={() => setOpen(true)}>
          <Bell className="size-5" />
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Need something?</DialogTitle>
          </DialogHeader>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {sent ? (
            <p className="text-sm text-brand">Request sent — staff have been notified.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant="outline"
                  disabled={isPending}
                  onClick={() => send(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
