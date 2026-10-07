import Link from "next/link";
import { notFound } from "next/navigation";
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
  const data = await getMenuData(restaurant, branch);
  if (!data) notFound();
  const table = await resolveTable(data.branch.id, tableId);
  if (!table) notFound();
  const { session: token } = await props.searchParams;
  if (token === undefined)
    return (
      <JoinTable restaurant={restaurant} branch={branch} table={tableId} />
    );
  if (typeof token !== "string") notFound();
  const tab = await getCustomerTab(restaurant, branch, tableId, token);
  if (!tab) notFound();
  if (tab.session.status === "closed")
    return (
      <div className="p-6">
        <h1>This visit has ended</h1>
        <p>Please scan the table QR to start a new visit.</p>
      </div>
    );
  if (!verifyCustomerTab(token)?.customerSessionId)
    return (
      <JoinTable restaurant={restaurant} branch={branch} table={tableId} />
    );
  if (["payment_pending", "paid"].includes(tab.session.status))
    return (
      <div className="p-6">
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
