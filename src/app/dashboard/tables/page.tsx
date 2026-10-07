import { AutoRefresh } from "@/components/auto-refresh";
import { DiningTableCard } from "@/components/staff/dining-table-card";
import { getDiningTables } from "@/lib/dining-tables";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddTableForm } from "@/components/dashboard/add-table-form";
import { requireCurrentRestaurant } from "@/lib/restaurant";
import { createClient } from "@/lib/supabase/server";

export default async function TablesPage() {
  const restaurant = await requireCurrentRestaurant();
  const supabase = await createClient();

  const { data: branches } = await supabase
    .from("branches")
    .select("id, name")
    .eq("restaurant_id", restaurant.restaurantId)
    .order("name");

  const tables = await getDiningTables(restaurant.restaurantId);

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh intervalMs={8000} />
      <div>
        <h1 className="text-2xl font-semibold">Tables</h1>
        <p className="text-muted-foreground">Manage tables across your branches.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a table</CardTitle>
        </CardHeader>
        <CardContent>
          {branches && branches.length > 0 ? (
            <AddTableForm branches={branches} />
          ) : (
            <p className="text-sm text-muted-foreground">Create a branch first.</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(tables ?? []).map((table) => (
          <DiningTableCard key={table.id} table={table} owner canPay />
        ))}
        {(!tables || tables.length === 0) && (
          <p className="text-sm text-muted-foreground">No tables yet.</p>
        )}
      </div>
    </div>
  );
}
