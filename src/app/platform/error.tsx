"use client";
export default function PlatformError({retry}:{retry:()=>void}) {
  return <main className="space-y-4 p-6"><h1 className="text-xl font-semibold">Platform data is unavailable</h1><p>No partial totals are shown. Check your access and try again.</p><button className="rounded border p-3" onClick={retry}>Try again</button></main>;
}
