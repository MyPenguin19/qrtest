import { createClient } from "@/lib/supabase/server";
import { businessDayWindow, receiptSummary, type Receipt } from "@/lib/operations-view";

import { readAllRows } from "@/lib/query-pages";
export async function getDashboardMetrics(restaurantId:string,now=new Date()) {
  const client=await createClient(),window=businessDayWindow(now);
  const [today,visits,pending,confirmed,legacy]=await Promise.all([
    client.from("orders").select("id",{count:"exact",head:true}).eq("restaurant_id",restaurantId).gte("created_at",window.start).lt("created_at",window.end),
    client.from("table_sessions").select("id,restaurant_tables!inner(branches!inner(restaurant_id))",{count:"exact",head:true})
      .eq("restaurant_tables.branches.restaurant_id",restaurantId).neq("status","closed"),
    readAllRows<{id:string;table_session_id:string|null;table_sessions:{status:string}|{status:string}[]|null}>((from,to)=>client.from("orders").select("id,table_session_id,table_sessions(status)")
      .eq("restaurant_id",restaurantId).in("status",["pending","accepted","preparing"]).order("id").range(from,to)),
    readAllRows<Receipt>((from,to)=>client.from("payments").select("id,status,amount,confirmed_at,created_at")
      .eq("restaurant_id",restaurantId).eq("status","paid").gte("confirmed_at",window.start).lt("confirmed_at",window.end).order("id").range(from,to)),
    readAllRows<Receipt>((from,to)=>client.from("payments").select("id,status,amount,confirmed_at,created_at")
      .eq("restaurant_id",restaurantId).eq("status","paid").is("confirmed_at",null).gte("created_at",window.start).lt("created_at",window.end).order("id").range(from,to)),
  ]);
  if(today.error||visits.error||today.count===null||visits.count===null)throw new Error("Could not load dashboard totals. Please refresh.");
  return {todayOrders:today.count,activeTables:visits.count,
    pendingOrders:pending.filter(o=>!o.table_session_id||(Array.isArray(o.table_sessions)?o.table_sessions[0]?.status:o.table_sessions?.status)!=="closed").length,
    ...receiptSummary([...confirmed,...legacy],window),window};
}
