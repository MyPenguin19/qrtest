"use client";
import { Button } from "@/components/ui/button";
export default function LoadError({retry}:{retry:()=>void}) {
  return <div role="alert" className="flex flex-col items-start gap-3 p-6">
    <h2 className="font-semibold">Could not load the dashboard.</h2>
    <p>Current data is unavailable. Check your connection and retry before acting on a table.</p>
    <Button onClick={retry}>Try again</Button>
  </div>;
}
