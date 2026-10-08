import React from "react";
import { createRoot } from "react-dom/client";
import Overview from "../../src/app/platform/page";
import Directory from "../../src/app/platform/restaurants/page";
import Detail from "../../src/app/platform/restaurants/[restaurantId]/page";
import Analytics from "../../src/app/platform/analytics/page";
import ErrorState from "../../src/app/platform/error";
import Loading from "../../src/app/platform/loading";
const root=createRoot(document.getElementById("root")!);
if(location.pathname==="/error") root.render(<ErrorState retry={()=>root.render(<p>Retry requested</p>)}/>);
else if(location.pathname==="/loading") root.render(<Loading/>);
else {
  const page=location.pathname==="/platform/restaurants"?Directory:location.pathname.startsWith("/platform/restaurants/")?Detail:location.pathname==="/platform/analytics"?Analytics:Overview;
  // Browser fixture passes route-specific props to real server page functions;
  // the reporting adapter provides local synthetic data, never hosted access.
  const render=page as unknown as (props:{params:Promise<{restaurantId:string}>;searchParams:Promise<Record<string,string>>})=>Promise<React.ReactNode>;
  render({params:Promise.resolve({restaurantId:"00000000-0000-0000-0000-000000000001"}),searchParams:Promise.resolve(Object.fromEntries(new URLSearchParams(location.search)))}).then(content=>root.render(content));
}
