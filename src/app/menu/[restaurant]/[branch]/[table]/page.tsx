import { accountAvailable } from "@/lib/account-availability";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { CustomerMenu } from "@/components/menu/customer-menu";
import { JoinTable } from "@/components/menu/join-table";
import { getMenuData, resolveTable } from "@/lib/menu-data";
import {
  customerTabUrl,
  getCustomerTab,
  verifyCustomerTab,
} from "@/lib/customer-tab";

export default async function TableMenuPage(
  props: PageProps<"/menu/[restaurant]/[branch]/[table]">,
) {
  const { restaurant, branch, table: tableId } = await props.params;
  const { session: token } = await props.searchParams;
  if (token !== undefined && typeof token !== "string") notFound();
  const tab = token ? await getCustomerTab(restaurant, branch, tableId, token) : null;
  if (token && !tab) notFound();
  if (tab?.session.status === "closed")
    return <div className="p-6"><h1>Thank you</h1><p>Your table session has ended.</p></div>;
  const data = await getMenuData(restaurant, branch);
  if (!data) notFound();
  if (!await accountAvailable(data.restaurant.id)) return <p className="p-6">Ordering is temporarily unavailable. Please contact restaurant staff.</p>;
  const table = await resolveTable(data.branch.id, tableId);
  if (!table) notFound();
  if (token === undefined) return <JoinTable restaurant={restaurant} branch={branch} table={tableId} />;
  if (!token || !tab) notFound();
  if (!verifyCustomerTab(token)?.customerSessionId)
    return (
      <JoinTable restaurant={restaurant} branch={branch} table={tableId} existingToken={token} />
    );
  if (["payment_pending", "paid"].includes(tab.session.status))
    return (
      <div className="p-6">
        <AutoRefresh intervalMs={4000} />
        <p>Ordering is paused while your bill is being settled.</p>
        <Link
          className="underline"
          href={customerTabUrl(restaurant, branch, tableId, token)}
        >
          View Your Tab
        </Link>
      </div>
    );
  return (
    <>
      <AutoRefresh intervalMs={4000} />
      <div className="mx-auto max-w-xl p-4">
        <Link
          className="text-sm font-medium underline"
          href={customerTabUrl(restaurant, branch, tableId, token)}
        >
          View Your Tab · Table {table.label}
        </Link>
      </div>
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
