"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { joinDiningTable } from "@/app/actions/dining";
import { Button } from "@/components/ui/button";

export function JoinTable({
  restaurant,
  branch,
  table,
}: {
  restaurant: string;
  branch: string;
  table: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    async function join() {
      try {
        const key = "qrcr_browser";
        const device = localStorage.getItem(key) || crypto.randomUUID();
        localStorage.setItem(key, device);
        const result = await joinDiningTable(restaurant, branch, table, device);
        if (!active) return;
        if (result.error) setError(result.error);
        else
          router.replace(
            `/menu/${encodeURIComponent(restaurant)}/${encodeURIComponent(branch)}/${encodeURIComponent(table)}?session=${encodeURIComponent(result.token!)}`,
          );
      } catch {
        if (active) setError("Could not open this table. Please try again.");
      }
    }
    void join();
    return () => {
      active = false;
    };
  }, [restaurant, branch, table, router, retry]);
  return (
    <div className="mx-auto max-w-xl p-6">
      <p role="status">{error || "Opening your table…"}</p>
      {error && (
        <Button
          onClick={() => {
            setError(null);
            setRetry((n) => n + 1);
          }}
        >
          Try again
        </Button>
      )}
    </div>
  );
}
