import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CustomerMenu } from "@/components/menu/customer-menu";
import { getMenuData, resolveTable } from "@/lib/menu-data";
import { customerTabUrl, findActiveTableSession, signCustomerTab, validateCustomerTab } from "@/lib/customer-tab";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function TableMenuPage(
  props: PageProps<"/menu/[restaurant]/[branch]/[table]">,
) {
  const { restaurant: restaurantSlug, branch: branchSlug, table: tableId } = await props.params;
  const data = await getMenuData(restaurantSlug, branchSlug);

  if (!data) notFound();

  const table = await resolveTable(data.branch.id, tableId);

  if (!table) notFound();

  const { session: token } = await props.searchParams;
  const admin = createAdminClient();
  const identity = { restaurantId: data.restaurant.id, branchId: data.branch.id, tableId: table.id };
  if (token !== undefined) {
    if (typeof token !== "string" || !await validateCustomerTab(admin, token, identity)) notFound();
  } else {
    const session = await findActiveTableSession(admin, table.id);
    if (session) {
      const signed = signCustomerTab({ ...identity, sessionId: session.id });
      redirect(`/menu/${encodeURIComponent(restaurantSlug)}/${encodeURIComponent(branchSlug)}/${encodeURIComponent(table.id)}?session=${encodeURIComponent(signed)}`);
    }
  }

  return (
    <>
    {typeof token === "string" && (
      <div className="mx-auto max-w-xl p-4">
        <Link className="text-sm font-medium underline" href={customerTabUrl(restaurantSlug, branchSlug, table.id, token)}>View Your Tab · Table {table.label}</Link>
      </div>
    )}
    <CustomerMenu
      restaurant={data.restaurant}
      categories={data.categories}
      tableLabel={table.label}
      branchId={data.branch.id}
      tableId={table.id}
      theme={data.theme}
    />
    </>
  );
}
